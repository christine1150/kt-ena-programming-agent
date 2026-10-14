-- C1: 플랫폼별 연도 집계 (커버리지 + 전체연도평균 + 1~8월 동일기간 평균)
select 'coverage' as k, json_agg(x) as v from (
  select target_label,
         count(*) as n_rows,
         min(year * 100 + month) as min_ym,
         max(year * 100 + month) as max_ym,
         count(rating) as n_rating,
         count(avg_time_spent_seconds) as n_ats,
         count(share) as n_share,
         count(reach) as n_reach,
         count(avg_time_spent_ratio) as n_ats_ratio
  from olife_reference_metrics
  where granularity = 'monthly' and dimension = 'platform'
  group by target_label
  order by target_label
) x
union all
select 'yearly_all', json_agg(x) from (
  select target_label,
         year,
         count(rating) as months_rating,
         round(avg(rating)::numeric, 5) as avg_rating,
         round(avg(avg_time_spent_seconds)::numeric, 0) as avg_ats,
         round(avg(share)::numeric, 5) as avg_share,
         round(avg(reach)::numeric, 5) as avg_reach,
         round(min(rating)::numeric, 5) as min_rating,
         round(max(rating)::numeric, 5) as max_rating
  from olife_reference_metrics
  where granularity = 'monthly' and dimension = 'platform'
  group by target_label, year
  order by target_label, year
) x
union all
select 'yearly_jan_aug', json_agg(x) from (
  select target_label,
         year,
         count(rating) as months_rating,
         round(avg(rating)::numeric, 5) as avg_rating,
         round(avg(avg_time_spent_seconds)::numeric, 0) as avg_ats,
         round(avg(share)::numeric, 5) as avg_share,
         round(avg(reach)::numeric, 5) as avg_reach
  from olife_reference_metrics
  where granularity = 'monthly' and dimension = 'platform' and month between 1 and 8
  group by target_label, year
  order by target_label, year
) x;
