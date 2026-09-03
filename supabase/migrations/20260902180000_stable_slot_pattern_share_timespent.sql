-- 사용자 지시(2026-09-02): "편성 안정성" 카드가 시청률만 보여주는데 "여기에 점유율이나
-- 시청시간도 함께 언급. 평균과 비교" — 20260902030000이 이미 계산해두던 streak_avg_rating vs
-- channel_avg_rating과 정확히 같은 패턴(같은 슬롯 조회 안에서 이미 rating을 avg()로 뽑던
-- slot_rows/channel_avg CTE에 share·time_spent_seconds도 나란히 추가하는 것뿐 — 새 계산 방식
-- 없음)으로 점유율·시청시간의 "스트릭 평균 vs 채널 평균"을 추가한다. 반환 타입이 바뀌어
-- DROP 후 재생성.
drop function if exists get_channel_stable_slot_patterns(text, text, date, text[], int, int);

create or replace function get_channel_stable_slot_patterns(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_demographic_labels text[],
  p_lookback_weeks int default 8,
  p_min_consecutive_weeks int default 3
)
returns table (
  dow int,
  dow_label text,
  hour_of_day int,
  canonical_name text,
  consecutive_weeks int,
  latest_date date,
  latest_rating numeric,
  first_rating numeric,        -- 스트릭 시작 시점 시청률(추세 계산용)
  streak_avg_rating numeric,   -- 스트릭 전체 평균 시청률
  channel_avg_rating numeric,  -- 같은 조회 기간 채널 전체(모든 슬롯) 평균 시청률 — 이 슬롯의 기여도 비교 기준
  streak_avg_share numeric,    -- 스트릭 전체 평균 점유율
  channel_avg_share numeric,   -- 같은 기간 채널 전체 평균 점유율
  streak_avg_time_spent numeric,   -- 스트릭 전체 평균 시청시간(초)
  channel_avg_time_spent numeric,  -- 같은 기간 채널 전체 평균 시청시간(초)
  dominant_demo_label text,    -- 이 슬롯에서 가장 시청률 높은 연령대
  dominant_demo_rating numeric
)
language sql
stable
as $$
  with v as (
    select c.id as channel_id, t.id as target_id
    from channels c, targets t
    where c.code = p_channel_code and t.label = p_program_target_label
  ),
  slot_rows as (
    select
      r.broadcast_date as bdate,
      extract(dow from r.broadcast_date)::int as dow_val,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hour_val,
      p.canonical_name as prog_name,
      avg(r.rating) as day_rating,
      avg(r.share) as day_share,
      avg(r.time_spent_seconds) as day_time_spent
    from ratings r
    join programs p on p.id = r.program_id
    join v on r.channel_id = v.channel_id and r.target_id = v.target_id
    where r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.is_first_run is distinct from false
      and r.broadcast_date between (p_as_of_date - (p_lookback_weeks * 7)) and p_as_of_date
    group by r.broadcast_date, extract(dow from r.broadcast_date),
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end),
      p.canonical_name
  ),
  ranked as (
    select sr.*,
      lag(bdate) over (partition by dow_val, hour_val order by bdate desc) as prev_bdate,
      lag(prog_name) over (partition by dow_val, hour_val order by bdate desc) as prev_prog_name
    from slot_rows sr
  ),
  grp as (
    select rk.*,
      sum(case when prev_bdate is not null and prev_prog_name = prog_name and prev_bdate = bdate + 7 then 0 else 1 end)
        over (partition by dow_val, hour_val order by bdate desc rows unbounded preceding) as grp_id
    from ranked rk
  ),
  streaks as (
    select dow_val, hour_val, prog_name, grp_id,
      count(*)::int as consecutive_weeks,
      max(bdate) as latest_date,
      (array_agg(day_rating order by bdate desc))[1] as latest_rating,
      (array_agg(day_rating order by bdate asc))[1] as first_rating,
      avg(day_rating) as streak_avg_rating,
      avg(day_share) as streak_avg_share,
      avg(day_time_spent) as streak_avg_time_spent,
      row_number() over (partition by dow_val, hour_val order by max(bdate) desc) as recency_rank
    from grp
    group by dow_val, hour_val, prog_name, grp_id
  ),
  qualifying as (
    select * from streaks where recency_rank = 1 and consecutive_weeks >= p_min_consecutive_weeks
  ),
  channel_avg as (
    select avg(r.rating) as avg_rating, avg(r.share) as avg_share, avg(r.time_spent_seconds) as avg_time_spent
    from ratings r join v on r.channel_id = v.channel_id and r.target_id = v.target_id
    where r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date between (p_as_of_date - (p_lookback_weeks * 7)) and p_as_of_date
  ),
  -- 각 스트릭이 실제로 방영된 날짜들(주간 간격이라 latest_date에서 7일씩 거슬러 올라간
  -- consecutive_weeks개)에서, 그 시간대·연령대별 평균 시청률을 구해 가장 높은 연령대 1개를 고른다.
  demo_perf as (
    select q.dow_val, q.hour_val, q.prog_name, t.label as demo_label, avg(r.rating) as avg_rating
    from qualifying q
    join generate_series(0, q.consecutive_weeks - 1) as wk on true
    join v on true
    join targets t on t.label = any(p_demographic_labels)
    join ratings r on r.channel_id = v.channel_id and r.target_id = t.id
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date = q.latest_date - (wk * 7)
      and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) = q.hour_val
    group by q.dow_val, q.hour_val, q.prog_name, t.label
  ),
  demo_top as (
    select distinct on (dow_val, hour_val, prog_name) dow_val, hour_val, prog_name, demo_label, avg_rating
    from demo_perf
    where avg_rating is not null
    order by dow_val, hour_val, prog_name, avg_rating desc
  )
  select
    q.dow_val,
    (array['일','월','화','수','목','금','토'])[q.dow_val + 1],
    q.hour_val,
    q.prog_name,
    q.consecutive_weeks,
    q.latest_date,
    q.latest_rating,
    q.first_rating,
    q.streak_avg_rating,
    (select avg_rating from channel_avg),
    q.streak_avg_share,
    (select avg_share from channel_avg),
    q.streak_avg_time_spent,
    (select avg_time_spent from channel_avg),
    dt.demo_label,
    dt.avg_rating
  from qualifying q
  left join demo_top dt on dt.dow_val = q.dow_val and dt.hour_val = q.hour_val and dt.prog_name = q.prog_name
  order by q.consecutive_weeks desc, q.latest_date desc;
$$;
comment on function get_channel_stable_slot_patterns is '최근 N주 동안 같은 요일·시각에 같은 프로그램(본방)이 3주 이상 연속 편성된 슬롯을 찾고, 그 슬롯이 채널에 미친 영향(시청률 추세=first_rating→latest_rating, 채널 평균 대비 기여=streak_avg_rating/share/time_spent vs channel_avg_*, 주 시청 연령대=dominant_demo_label)까지 함께 반환한다(2026-09-02, 점유율·시청시간 비교 추가).';
