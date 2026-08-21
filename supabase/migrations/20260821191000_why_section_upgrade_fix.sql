-- 직전 마이그레이션(20260821190000)의 두 버그를 고친다 — supabase db push는 이미 적용된
-- 마이그레이션 파일을 내용만 고쳐도 재적용하지 않아(파일명 기준 추적) 새 파일로 분리한다.
--
-- 1) get_daily_trend_highlight: RETURNS TABLE 컬럼명(rating/baseline_avg)과 CTE 컬럼명이
--    겹쳐 런타임에 "ambiguous column reference"(42702) 발생 — 실측으로 재현·확인(과거에도 여러
--    번 겪은 플랫 패턴, 메모리 기록). CTE 컬럼명을 raw_rating/raw_baseline로 바꿔 충돌을 피한다.
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

-- 2) get_competitor_schedule_changes: 실측 확인 결과 ENA 하루치만 73건이 잡혀 노이즈에 가까웠다
--    — 새벽 재방송 블록(<재>)은 원래 매주 다른 회차로 로테이션되는 게 정상이라 전부 걸러내고,
--    "최근 N주 과반"이 아니라 "최근 N주 전부 동일 프로그램"이었을 때만 "확립된 평소 편성"으로
--    인정해, 오늘 그것과 다를 때만 "편성 변화 가능성"으로 반환하도록 강화했다.
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
  where u.usual_program is not null
    and u.usual_weeks_seen >= p_lookback_weeks
    and t.program_name is distinct from u.usual_program
  order by t.competitor_name, t.hour_block;
$$;
comment on function get_competitor_schedule_changes is 'WHY? 편성 변화 참고 정보 — 등록 경쟁채널(competitor_program_ratings) 중 같은 요일·시간대에서 최근 N주 "전부" 동일했던 프로그램(재방송 제외)과 오늘 방영분이 다른 경우만 반환("편성 변화 가능성" 참고용, 인과관계 단정 아님). 20260821190000의 노이즈 문제(재방송 로테이션 오탐)를 고친 버전.';
