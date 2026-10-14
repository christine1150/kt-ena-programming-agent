with d as (
  select period_date, rating, share, reach, avg_time_spent_seconds ats
  from olife_reference_metrics
  where granularity='daily' and dimension='household'
),
yr as (
  select extract(year from period_date)::int y,
         count(*) n, avg(rating) rating, avg(share) share, avg(reach) reach, avg(ats) ats
  from d group by 1
),
mo as (
  select to_char(period_date,'YY-MM') ym, date_trunc('month',period_date)::date m,
         avg(rating) rating, avg(share) share, avg(reach) reach, avg(ats) ats, count(*) n
  from d group by 1,2
),
ma as (
  select period_date,
         avg(rating) over (order by period_date rows between 55 preceding and current row) ma56,
         count(*) over (order by period_date rows between 55 preceding and current row) cnt
  from d
)
select 'year' k, json_agg(x order by x.y) v from (select * from yr) x
union all
select 'month', json_agg(x order by x.m) from (select ym, m, round(rating,5) rating, round(share,5) share, round(reach,5) reach, round(ats,0) ats, n from mo) x
union all
select 'ma_peak', json_agg(x) from (select period_date, round(ma56,5) ma56 from ma where cnt=56 order by ma56 desc limit 5) x
union all
select 'ma_series', json_agg(x order by x.period_date) from (select period_date, round(ma56,5) ma56 from ma where cnt=56 and extract(dow from period_date)=1) x
union all
select 'daily_top', json_agg(x) from (select period_date, rating, reach, ats from d order by rating desc limit 15) x
union all
select 'coverage', json_agg(x) from (select min(period_date) d0, max(period_date) d1, count(*) n from d) x;
