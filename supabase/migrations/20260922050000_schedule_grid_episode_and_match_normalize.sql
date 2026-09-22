-- 사용자 지시(2026-09-22): "편성표를 올린것과 DB 기반이 많이 상이하고, 매칭이 안되는
-- 문제를 비교해서 맞춰줘. 프로그램이 아예 다른게 아니면 맞출 수 있도록 해줘." — ENA Play
-- 2026-09-07 주차를 직접 조회해 실제 원인 두 가지를 확인했다.
--
--   1) 문장부호 미제거: match_schedule_grid_ratings가 괄호 내용과 공백만 제거하고 비교한다.
--      업로드 원문 "신병4 : 사보타주 (오픈)"는 콜론이 남아 "신병4:사보타주"가 되는데, DB
--      canonical_name은 "신병4사보타주"(콜론 없음)라 부분일치(LIKE)가 실패했다 — 같은 프로그램인데
--      문장부호 하나 때문에 "매칭 안 됨"으로 남아 있던 것. 콜론·쉼표·하이픈·가운뎃점도 괄호와
--      함께 제거하도록 정규화 함수를 만들어 공유한다(양쪽에서 같은 기준 사용).
--   2) 부제/회차 컬럼 신설: 업로드 파싱(scheduleGridParse.ts)이 지금까지 제목 다음에 오는
--      회차/부제 값("6(자오족, 여인의 길)" 형식, OLIFE 주간 편성표와 동일 구조)을 버리고
--      있었다. 이제부터는 파서가 이 값을 저장할 수 있도록 컬럼을 마련한다(과거분은 원본
--      엑셀을 다시 올려야 채워짐 — 이 마이그레이션만으로 소급 채워지지 않음).
alter table program_schedule_grid
  add column if not exists episode_number int,
  add column if not exists episode_subtitle text;
comment on column program_schedule_grid.episode_number is '업로드 편성표 원문에서 제목 다음에 오는 회차 번호(있으면). 화면에서 "(자)/(오픈)" 같은 자막 표기 대신 이 값을 우선 보여준다.';
comment on column program_schedule_grid.episode_subtitle is '업로드 편성표 원문에서 제목 다음에 오는 부제(있으면). OLIFE 주간 편성표(olifeWeeklySchedule.ts)와 같은 "회차(부제)" 형식에서 추출.';

-- 프로그램명 정규화 — match_schedule_grid_ratings 안에서 두 번(그리드 쪽·DB 쪽) 반복되던
-- regexp_replace 체인을 함수 하나로 모아, 앞으로 정규화 기준을 바꿀 때 한 곳만 고치면 되게 한다.
create or replace function schedule_grid_normalize_title(p_title text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(p_title, '\(.*?\)', '', 'g'), -- 괄호와 그 안 내용(예: "(자)", "(오픈)") 제거
    '[[:space:]:,·\-]', '', 'g' -- 공백·콜론·쉼표·가운뎃점·하이픈 제거(문장부호 차이로 인한 매칭 실패 방지)
  )
$$;
comment on function schedule_grid_normalize_title is '편성표 프로그램명 매칭용 정규화 — 괄호·공백·콜론·쉼표·가운뎃점·하이픈 제거. match_schedule_grid_ratings에서 그리드 원문과 DB canonical_name 양쪽에 동일하게 적용한다.';

drop function if exists match_schedule_grid_ratings(uuid, date, int);

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
        schedule_grid_normalize_title(p.canonical_name) like '%' || nullif(schedule_grid_normalize_title(g.program_name_raw), '') || '%'
        or schedule_grid_normalize_title(g.program_name_raw) like '%' || nullif(schedule_grid_normalize_title(p.canonical_name), '') || '%'
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
comment on function match_schedule_grid_ratings is '주간 편성표 그리드(program_schedule_grid)에 실제 ratings를 매칭 — 프로그램명 부분일치(schedule_grid_normalize_title로 괄호·공백·문장부호 제거 후 비교) + 채널·날짜 동일 + 시작시간 오차 최소(기본 60분 이내)인 것만. 매칭 안 되면 null로 남김(추정 금지). 조회할 때마다(getScheduleGridRows) 재호출되어, 업로드 당시엔 없었던 시청률이 나중에 들어와도 다음 조회에서 매칭된다(2026-09-22).';
