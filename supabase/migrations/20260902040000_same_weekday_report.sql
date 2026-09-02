-- 사용자 지시(2026-09-02): "방송 편성 분석의 특성상 '동요일(Same Day of Week)' 시청률 비교가
-- 필수적" — 기존 DoD(전일)/WoW(트레일링 7일)와 달리, "최근 N주 동안의 같은 요일" 평균을 비교
-- 기준으로 쓰는 새 RPC. get_rating_trend_summary(전일/전주 등 고정 비교)와 같은 채널-일 롤업
-- 필터(source_type='nielsen_daily', program_id is null)를 그대로 쓰되, 날짜가 하나가 아니라
-- "요일이 일치하는 최근 N개 날짜"라 평균을 낸다.
create or replace function get_channel_same_weekday_report(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_dow int,        -- 0=일요일...6=토요일(Postgres extract(dow) 표준, JS Date.getDay()와 동일)
  p_weeks_back int   -- 최근 N주(그 요일이 몇 번 있었는지) — 1~24
)
returns table (
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  avg_time_spent_share numeric,
  sample_days int,
  earliest_date date,
  latest_date date
)
language sql
stable
as $$
  with v as (
    select c.id as channel_id, t.id as target_id
    from channels c, targets t
    where c.code = p_channel_code and t.label = p_target_label
  ),
  target_dates as (
    select d::date as dt
    from generate_series(p_as_of_date - (greatest(p_weeks_back, 1) * 7), p_as_of_date, interval '1 day') as d
    where extract(dow from d)::int = p_dow
    order by d desc
    limit greatest(p_weeks_back, 1)
  )
  select
    avg(r.rating), avg(r.share), avg(r.reach), avg(r.time_spent_seconds), avg(r.time_spent_share),
    count(r.rating)::int,
    min(td.dt), max(td.dt)
  from target_dates td
  join v on true
  left join ratings r on r.channel_id = v.channel_id and r.target_id = v.target_id
    and r.source_type = 'nielsen_daily' and r.program_id is null
    and r.broadcast_date = td.dt;
$$;
comment on function get_channel_same_weekday_report is '지정한 요일(p_dow, Postgres extract(dow) 표준)의 최근 p_weeks_back개 과거 날짜 평균 시청률·점유율·도달율·시청시간. 2026-09-02, "동요일 평균 분석(SDoW)" 드롭다운 기능용.';
