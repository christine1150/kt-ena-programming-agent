-- A1-1: OLIFE 채널 총괄 — 연도별/월별/동일기간(YTD) 평균 지표
-- 원천: olife_reference_metrics (granularity='daily', dimension='household', 유료방송가구)
with d as (
  select period_date,
         extract(year from period_date)::int as yr,
         to_char(period_date, 'YYYY-MM')     as ym,
         rating,
         share,
         reach,
         avg_time_spent_seconds::numeric     as ats
  from olife_reference_metrics
  where granularity = 'daily'
    and dimension   = 'household'
),
cover as (
  select count(*)::int         as n_rows,
         min(period_date)      as d_min,
         max(period_date)      as d_max,
         count(rating)::int    as n_rating,
         count(share)::int     as n_share,
         count(reach)::int     as n_reach,
         count(avg_time_spent_seconds)::int as n_ats,
         count(distinct target_label) as n_target,
         min(target_label)     as sample_target
  from olife_reference_metrics
  where granularity = 'daily' and dimension = 'household'
),
yearly as (
  select yr,
         count(*)::int      as n_days,
         count(rating)::int as n_rating,
         count(ats)::int    as n_ats,
         round(avg(rating)::numeric, 5) as avg_rating,
         round(avg(share)::numeric, 5)  as avg_share,
         round(avg(reach)::numeric, 5)  as avg_reach,
         round(avg(ats)::numeric, 1)    as avg_ats
  from d
  group by yr
),
ytd as (
  select yr,
         count(*)::int as n_days,
         round(avg(rating)::numeric, 5) as avg_rating,
         round(avg(share)::numeric, 5)  as avg_share,
         round(avg(reach)::numeric, 5)  as avg_reach,
         round(avg(ats)::numeric, 1)    as avg_ats
  from d
  where to_char(period_date, 'MMDD') <= '0906'
  group by yr
),
monthly as (
  select ym,
         count(*)::int      as n_days,
         count(rating)::int as n_rating,
         count(ats)::int    as n_ats,
         round(avg(rating)::numeric, 5) as avg_rating,
         round(avg(share)::numeric, 5)  as avg_share,
         round(avg(reach)::numeric, 5)  as avg_reach,
         round(avg(ats)::numeric, 0)    as avg_ats
  from d
  group by ym
)
select 'cover'   as k, to_json(c)                  as v from cover c
union all
select 'yearly',      json_agg(y order by y.yr)         from yearly y
union all
select 'ytd',         json_agg(t order by t.yr)         from ytd t
union all
select 'monthly',     json_agg(m order by m.ym)         from monthly m;
