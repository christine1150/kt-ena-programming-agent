-- 사용자 지시(2026-09-19): "2주간 편성표(주간 편성표 엑셀)를 넣으면 실제 나온 시청률을
-- 편성표 안에 적어주고, 히트맵으로 그라데이션으로 보여주기도 하고, 엑셀로 다운받을 수도
-- 있는 기능" — 방송사 주간 편성표(요일×시간 병합 셀 그리드) 원본 구조를 그대로 저장하고,
-- 이미 적재된 ratings와 매칭해 실제 시청률을 채워 넣는다. DB/Mart가 유일한 시청률 출처라는
-- 원칙에 따라 matched_rating은 항상 ratings 테이블에서 그대로 복사한 값이며, 이 테이블
-- 자신이 수치를 계산하거나 추정하지 않는다.
create table program_schedule_grid (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  week_start date not null, -- 그 주 월요일
  week_end date not null, -- 그 주 일요일
  dow int not null check (dow between 1 and 7), -- 1=월 ... 7=일
  broadcast_date date not null, -- week_start + (dow-1)
  start_time time not null,
  end_time time, -- 다음 세그먼트 시작 시각으로 근사 — 그 날의 마지막 세그먼트는 다음이 없어 null(추정 금지)
  program_name_raw text not null, -- 편성표 원문 그대로(괄호·구두점 포함)
  tags text, -- 원문 태그 텍스트 그대로(예: "[재][H][15]") — 의미 해석하지 않고 그대로 표시용
  -- 매칭 결과(둘 다 ratings에서 그대로 복사 — 이 테이블이 직접 계산하지 않음). 매칭 실패 시 null로
  -- 남기며(임의 추정 금지), 화면에서는 "매칭 안 됨"으로 구분 표시한다.
  matched_program_id uuid references programs(id) on delete set null,
  matched_rating numeric,
  source_file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, broadcast_date, start_time)
);
comment on table program_schedule_grid is '방송사 주간 편성표 원본 그리드(요일×시간) + ratings 매칭 결과. 사용자 지시(2026-09-19)로 도입 — 편성표 자체를 저장하고 실제 시청률을 매칭해 히트맵/엑셀로 보여주는 용도.';
create index idx_program_schedule_grid_channel_week on program_schedule_grid (channel_id, week_start);

-- 업로드 직후 호출 — 그 주 편성표 행들에 대해 ratings 매칭을 (재)수행한다. epgMatch.ts의
-- canonicalizeEpgProgramName(괄호 제거+공백 제거)과 같은 원칙을 SQL에서도 적용하기 위해,
-- 프로그램명 부분일치(포함 관계) + 같은 채널·같은 날짜·시작시간 오차 이내에서 가장 가까운
-- ratings 행을 고른다. p_tolerance_minutes 기본 60분(EPG 매칭과 동일 — 편성표의 계획 시각과
-- 닐슨 실측 시각은 어긋날 수 있음, epgMatch.ts 주석 참고).
create or replace function match_schedule_grid_ratings(
  p_channel_id uuid,
  p_week_start date,
  p_tolerance_minutes int default 60
)
returns int
language plpgsql
as $$
declare
  v_matched int := 0;
begin
  with candidates as (
    select
      g.id as grid_id,
      r.program_id,
      r.rating,
      abs(extract(epoch from (
        (r.broadcast_date + r.start_time) - (g.broadcast_date + g.start_time)
      )) / 60.0) as diff_minutes,
      row_number() over (
        partition by g.id
        order by abs(extract(epoch from (
          (r.broadcast_date + r.start_time) - (g.broadcast_date + g.start_time)
        )) / 60.0)
      ) as rn
    from program_schedule_grid g
    join ratings r
      on r.channel_id = g.channel_id
      and r.broadcast_date = g.broadcast_date
      and r.source_type = 'nielsen_daily'
      and r.program_id is not null
      and r.rating is not null
    join programs p on p.id = r.program_id
    where g.channel_id = p_channel_id
      and g.week_start = p_week_start
      and (
        replace(regexp_replace(p.canonical_name, '\(.*?\)', '', 'g'), ' ', '')
          like '%' || nullif(replace(regexp_replace(g.program_name_raw, '\(.*?\)', '', 'g'), ' ', ''), '') || '%'
        or replace(regexp_replace(g.program_name_raw, '\(.*?\)', '', 'g'), ' ', '')
          like '%' || nullif(replace(regexp_replace(p.canonical_name, '\(.*?\)', '', 'g'), ' ', ''), '') || '%'
      )
  )
  update program_schedule_grid g
  set matched_program_id = c.program_id,
      matched_rating = c.rating,
      updated_at = now()
  from candidates c
  where c.grid_id = g.id and c.rn = 1 and c.diff_minutes <= p_tolerance_minutes;
  get diagnostics v_matched = row_count;
  return v_matched;
end;
$$;
comment on function match_schedule_grid_ratings is '주간 편성표 그리드(program_schedule_grid)에 실제 ratings를 매칭 — 프로그램명 부분일치(괄호·공백 제거) + 채널·날짜 동일 + 시작시간 오차 최소(기본 60분 이내)인 것만. 매칭 안 되면 null로 남김(추정 금지).';
