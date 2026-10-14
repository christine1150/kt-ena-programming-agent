with m as (
  select target_label lb, period_date, year, month, rating, avg_time_spent_seconds ats, reach, share
  from olife_reference_metrics
  where granularity='monthly' and dimension='age_gender'
),
yr as (
  select lb, year, count(*) n, avg(rating) rating, avg(ats) ats, avg(reach) reach
  from m group by 1,2
)
select 'seg_year' k, json_agg(x order by x.lb, x.year) v from (
  select lb, year, n, round(rating,5) rating, round(ats,0) ats, round(reach,5) reach from yr) x
union all
select 'seg_series', json_agg(x order by x.lb, x.period_date) from (
  select lb, to_char(period_date,'YY-MM') ym, period_date, round(rating,5) rating, round(ats,0) ats from m) x
union all
select 'seg_delta', json_agg(x order by x.abs_delta desc) from (
  select a.lb,
         round(a.rating,5) r24, round(c.rating,5) r26,
         round(c.rating - a.rating,5) abs_delta,
         round(100*(c.rating - a.rating)/nullif(a.rating,0),1) pct_delta,
         round(a.ats,0) ats24, round(c.ats,0) ats26,
         round(100*(c.ats - a.ats)/nullif(a.ats,0),1) ats_pct
  from yr a join yr c on a.lb=c.lb and a.year=2024 and c.year=2026) x
union all
select 'seg_mix', json_agg(x order by x.year, x.lb) from (
  select year, lb, round(100*rating/nullif(sum(rating) filter (where lb<>'유료방송가구') over (partition by year),0),1) mix_pct
  from yr where lb<>'유료방송가구') x;
