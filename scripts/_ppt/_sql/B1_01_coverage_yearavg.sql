-- B1-01: age_gender monthly 커버리지 + 연도평균(전체월 / 1~9월 정렬) 동시 산출
with base as (
  select target_label, year, month, rating, share, reach,
         avg_time_spent_seconds, avg_time_spent_ratio
  from olife_reference_metrics
  where granularity = 'monthly' and dimension = 'age_gender'
)
select 'coverage' as k, json_agg(t) as v from (
  select year,
         count(*)                       as rows_all,
         count(distinct month)          as months_n,
         min(month)                     as month_min,
         max(month)                     as month_max,
         count(distinct target_label)   as segments_n,
         count(rating)                  as rating_notnull,
         count(avg_time_spent_seconds)  as ats_notnull
  from base
  group by year
  order by year
) t
union all
select 'seg_list', json_agg(t) from (
  select target_label,
         count(*)                      as rows_all,
         count(rating)                 as rating_notnull,
         count(avg_time_spent_seconds) as ats_notnull,
         min(year)                     as y_min,
         max(year)                     as y_max
  from base
  group by target_label
  order by target_label
) t
union all
select 'yearavg_full', json_agg(t) from (
  select target_label, year,
         count(rating)                                     as n_rating,
         round(avg(rating)::numeric, 5)                    as avg_rating,
         count(avg_time_spent_seconds)                     as n_ats,
         round(avg(avg_time_spent_seconds)::numeric, 0)    as avg_ats_sec,
         round(avg(share)::numeric, 5)                     as avg_share,
         round(avg(reach)::numeric, 5)                     as avg_reach
  from base
  group by target_label, year
  order by target_label, year
) t
union all
select 'yearavg_jan_sep', json_agg(t) from (
  select target_label, year,
         count(rating)                                  as n_rating,
         round(avg(rating)::numeric, 5)                 as avg_rating,
         count(avg_time_spent_seconds)                  as n_ats,
         round(avg(avg_time_spent_seconds)::numeric, 0) as avg_ats_sec
  from base
  where month between 1 and 9
  group by target_label, year
  order by target_label, year
) t
