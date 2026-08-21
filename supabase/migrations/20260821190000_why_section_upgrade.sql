-- 사용자 지시(2026-08-21, WHY? 원인 추적 섹션 고도화): 기존 get_root_cause_alert(하락 3일 연속만
-- 트리거)를 유지하되, 두 가지를 보강한다.
--
-- 1) get_daily_trend_highlight: 하락/상승 트리거 조건을 충족하지 못해도(짧은 1~2일짜리 변동 등)
--    최근 7일 중 채널 평균(28일) 대비 가장 뚜렷하게 움직인 하루를 항상 짚어준다 — "이상 패턴이
--    감지되지 않았습니다"라는 기계적 문구 대신, 데이터에서 실제로 가장 눈에 띄는 변화를 보여주기
--    위함(트리거 여부와 무관하게 매번 계산 가능, WHY? 화면에서 하락/상승 둘 다 트리거 안 됐을
--    때만 폴백으로 사용).
--
-- 2) get_competitor_schedule_changes: PRD의 "편성 변화 감지"(신규 편성·시간 이동·프로그램 교체)를
--    원본 데이터로 실제 구현 — 개발 단위 16번 문서화 당시엔 "경쟁채널 프로그램 단위 데이터가
--    채널당 1개뿐"이라 판단했었는데, 이후 §1.2 시트 파서 버그를 고치며 실제로는 8~9개 경쟁채널
--    전부의 프로그램 단위 데이터가 있다는 걸 확인했다(CLAUDE.md 기록, competitor_program_ratings
--    실측 재확인: ENA 기준 하루 9개 경쟁채널·채널당 18~33행). 그래서 이제는 "채널 단위 시청률
--    변동"이 아니라 진짜 "그 시간대 프로그램이 평소와 다른가"를 등록 경쟁채널별로 확인할 수 있다.
--    같은 요일·시간대(hour_block)에서 최근 N주간 가장 흔했던 프로그램명(최빈값)과 오늘 프로그램명이
--    다르면 "편성 변화 가능성"으로 참고 표시한다(그래도 인과관계 단정은 하지 않음, PRD 원칙 유지).
create or replace function get_daily_trend_highlight(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_lookback_days int default 7,
  p_baseline_days int default 28
)
returns table (
  highlight_date date,
  rating numeric,
  baseline_avg numeric,
  change_pct numeric,
  direction text
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  select id into v_target_id from targets where label = p_target_label;
  if v_channel_id is null or v_target_id is null then
    return;
  end if;

  -- plpgsql RETURNS TABLE 컬럼명(rating/baseline_avg)과 CTE 컬럼명이 겹치면 런타임에만
  -- "ambiguous column reference"가 나는 함정이 있어(과거에도 여러 번 겪은 패턴, 메모리 기록됨),
  -- CTE 컬럼명을 raw_rating/raw_baseline로 다르게 둬서 아예 충돌을 피한다.
  return query
  with days as (
    select d::date as the_date
    from generate_series(p_as_of_date - (p_lookback_days - 1), p_as_of_date, interval '1 day') as d
  ),
  per_day as (
    select
      days.the_date,
      (select r.rating from ratings r
        where r.channel_id = v_channel_id and r.target_id = v_target_id
          and r.source_type = 'nielsen_daily' and r.program_id is null
          and r.broadcast_date = days.the_date
        limit 1) as raw_rating,
      (select avg(r.rating) from ratings r
        where r.channel_id = v_channel_id and r.target_id = v_target_id
          and r.source_type = 'nielsen_daily' and r.program_id is null
          and r.broadcast_date between days.the_date - p_baseline_days and days.the_date - 1) as raw_baseline
    from days
  )
  select
    per_day.the_date,
    round(per_day.raw_rating::numeric, 5),
    round(per_day.raw_baseline::numeric, 5),
    pct_change(per_day.raw_rating, per_day.raw_baseline),
    case when pct_change(per_day.raw_rating, per_day.raw_baseline) >= 0 then '상승' else '하락' end
  from per_day
  where per_day.raw_rating is not null and per_day.raw_baseline is not null and per_day.raw_baseline <> 0
  order by abs(pct_change(per_day.raw_rating, per_day.raw_baseline)) desc
  limit 1;
end;
$$;
comment on function get_daily_trend_highlight is 'WHY? 폴백 — 하락/상승 트리거 조건을 못 채워도 최근 7일 중 채널 평균(28일) 대비 가장 뚜렷하게 움직인 하루를 항상 반환. "이상 패턴 없음" 대신 실제로 가장 눈에 띈 변화를 보여주기 위함.';

create or replace function get_competitor_schedule_changes(
  p_channel_code text,
  p_as_of_date date,
  p_lookback_weeks int default 4
)
returns table (
  competitor_name text,
  hour_block int,
  today_program text,
  today_rating numeric,
  usual_program text,
  usual_weeks_seen int
)
language sql
stable
as $$
  with our_channel as (
    select id from channels where code = p_channel_code
  ),
  today_rows as (
    -- 사용자 지시(2026-08-21) 재현 확인: 새벽 재방송 블록(<재> 태그)은 원래 매주 다른 회차가
    -- 로테이션 돌아서 "평소와 다름"이 항상 대량으로 잡히는 노이즈였다 — 실측(73건/day) 후 재방송을
    -- 제외해 "진짜 편성 변화"만 남긴다.
    select
      cp.competitor_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hour_block,
      cp.program_name,
      cp.rating
    from competitor_program_ratings cp, our_channel
    where cp.our_channel_id = our_channel.id and cp.broadcast_date = p_as_of_date
      and cp.program_name not like '%<재>%'
  ),
  history_rows as (
    -- 같은 요일(오늘과 동일 dow)만 비교해야 "평소 이 시간대 편성"이 의미 있다(요일마다 편성이
    -- 다른 게 정상이므로 요일을 섞으면 오탐이 남).
    select
      cp.competitor_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hour_block,
      cp.program_name,
      cp.broadcast_date
    from competitor_program_ratings cp, our_channel
    where cp.our_channel_id = our_channel.id
      and cp.broadcast_date between p_as_of_date - (p_lookback_weeks * 7) and p_as_of_date - 1
      and extract(isodow from cp.broadcast_date) = extract(isodow from p_as_of_date)
      and cp.program_name not like '%<재>%'
  ),
  usual as (
    -- 같은 요일·시간대에서 최근 N주 중 가장 흔했던 프로그램명(최빈값)과 그 등장 주 수.
    select distinct on (competitor_name, hour_block)
      competitor_name, hour_block, program_name as usual_program, count(distinct broadcast_date) as usual_weeks_seen
    from history_rows
    group by competitor_name, hour_block, program_name
    order by competitor_name, hour_block, count(distinct broadcast_date) desc
  )
  select
    t.competitor_name,
    t.hour_block,
    t.program_name as today_program,
    round(t.rating::numeric, 5) as today_rating,
    u.usual_program,
    coalesce(u.usual_weeks_seen, 0)::int as usual_weeks_seen
  from today_rows t
  left join usual u on u.competitor_name = t.competitor_name and u.hour_block = t.hour_block
  -- 사용자 지시 재현 확인 후 강화: "과반"이 아니라 "최근 N주 전부" 같은 프로그램이었을 때만
  -- "확립된 평소 편성"으로 인정한다 — 그래야 정말 안정적으로 고정 편성되던 시간대가 오늘 달라진
  -- 경우만 남고, 자연스럽게 로테이션되는 코너/스페셜은 애초에 "평소 편성"으로 잡히지 않아 걸러진다.
  where u.usual_program is not null
    and u.usual_weeks_seen >= p_lookback_weeks
    and t.program_name is distinct from u.usual_program
  order by t.competitor_name, t.hour_block;
$$;
comment on function get_competitor_schedule_changes is 'WHY? 편성 변화 참고 정보 — 등록 경쟁채널(competitor_program_ratings, §1.2 시트 전체 채널) 중 같은 요일·시간대에서 최근 N주 과반 이상 반복되던 프로그램과 오늘 방영분이 다른 경우를 반환("편성 변화 가능성" 참고용, 인과관계 단정 아님).';
