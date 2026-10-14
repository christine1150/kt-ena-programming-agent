with p as (
  select target_label lb, period_date, year, rating, avg_time_spent_seconds ats, reach
  from olife_reference_metrics where granularity='monthly' and dimension='platform'
),
w as (
  select target_label lb, period_date, year, rating, avg_time_spent_seconds ats, reach
  from olife_reference_metrics where granularity='monthly' and dimension='weekday_weekend'
)
select 'plat_year' k, json_agg(x order by x.lb, x.year) v from (
  select lb, year, count(*) n, round(avg(rating),5) rating, round(avg(ats),0) ats, round(avg(reach),5) reach
  from p group by 1,2) x
union all
select 'plat_series', json_agg(x order by x.lb, x.period_date) from (
  select lb, to_char(period_date,'YY-MM') ym, period_date, round(rating,5) rating from p) x
union all
select 'wk_year', json_agg(x order by x.lb, x.year) from (
  select lb, year, round(avg(rating),5) rating, round(avg(ats),0) ats, round(avg(reach),5) reach
  from w group by 1,2) x
union all
select 'wk_series', json_agg(x order by x.lb, x.period_date) from (
  select lb, to_char(period_date,'YY-MM') ym, period_date, round(rating,5) rating from w) x;
