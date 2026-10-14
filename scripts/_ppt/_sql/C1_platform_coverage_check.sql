-- C1: 2026-09 부분월 여부 확인 + 플랫폼 월행 period_date 확인 + 아날로그 결측월 목록
select 'daily_days_per_month_2026' as k, json_agg(x) as v from (
  select year, month, count(distinct period_date) as days,
         min(period_date) as first_d, max(period_date) as last_d
  from olife_reference_metrics
  where granularity = 'daily' and dimension = 'household' and year = 2026
  group by year, month
  order by year, month
) x
union all
select 'platform_period_date_sample', json_agg(x) from (
  select target_label, year, month, period_date
  from olife_reference_metrics
  where granularity = 'monthly' and dimension = 'platform' and year = 2026 and month >= 8
  order by target_label, month
) x
union all
select 'analog_missing_months', json_agg(x) from (
  select ym.year, ym.month
  from (
    select distinct year, month
    from olife_reference_metrics
    where granularity = 'monthly' and dimension = 'platform'
  ) ym
  where not exists (
    select 1 from olife_reference_metrics a
    where a.granularity = 'monthly' and a.dimension = 'platform'
      and a.target_label = '케이블아날로그가구'
      and a.year = ym.year and a.month = ym.month
  )
  order by ym.year, ym.month
) x
union all
select 'analog_nonzero_rows', json_agg(x) from (
  select year, month, round(rating::numeric, 5) as rating,
         round(avg_time_spent_seconds::numeric, 0) as ats,
         round(reach::numeric, 5) as reach
  from olife_reference_metrics
  where granularity = 'monthly' and dimension = 'platform'
    and target_label = '케이블아날로그가구' and rating > 0
  order by year, month
) x;
