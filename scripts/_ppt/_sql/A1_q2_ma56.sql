-- A1-2: 8주(56일) 이동평균 rating 시계열의 고점/저점/최근값
-- 원천: olife_reference_metrics (daily + household)
with d as (
  select period_date, rating
  from olife_reference_metrics
  where granularity = 'daily'
    and dimension   = 'household'
    and rating is not null
),
ma as (
  select period_date,
         rating,
         avg(rating) over (
           order by period_date
           range between interval '55 days' preceding and current row
         ) as ma56,
         count(*) over (
           order by period_date
           range between interval '55 days' preceding and current row
         )::int as n56
  from d
),
v as (
  select period_date, round(ma56::numeric, 5) as ma56, n56
  from ma
  where n56 >= 56
),
peak as (
  select period_date, ma56, n56 from v order by ma56 desc, period_date limit 5
),
trough as (
  select period_date, ma56, n56 from v order by ma56 asc, period_date limit 3
),
edges as (
  select 'first_valid' as tag, period_date, ma56 from v order by period_date limit 1
),
edges2 as (
  select 'latest' as tag, period_date, ma56 from v order by period_date desc limit 1
),
yearpeak as (
  select extract(year from period_date)::int as yr,
         max(ma56) as ma56_max,
         min(ma56) as ma56_min
  from v group by 1
)
select 'ma_peak'    as k, json_agg(p order by p.ma56 desc)    as v from peak p
union all
select 'ma_trough',      json_agg(t order by t.ma56 asc)            from trough t
union all
select 'ma_edges',       json_agg(e)                                from (select * from edges union all select * from edges2) e
union all
select 'ma_year',        json_agg(y order by y.yr)                  from yearpeak y;
