-- B1-03: 2024→2026 절대 증가폭 기여도 순위 + ATS 증감 순위 + 최근분기(2026 7~9월) 구조 + 60+/20대 배율
with base as (
  select target_label, year, month, rating, avg_time_spent_seconds
  from olife_reference_metrics
  where granularity = 'monthly' and dimension = 'age_gender'
),
seg as (select * from base where target_label <> '유료방송가구'),
ya as (
  select target_label, year,
         avg(rating) as avg_rating,
         avg(avg_time_spent_seconds) as avg_ats
  from seg group by target_label, year
),
p24 as (select target_label, avg_rating as r24, avg_ats as a24 from ya where year = 2024),
p25 as (select target_label, avg_rating as r25, avg_ats as a25 from ya where year = 2025),
p26 as (select target_label, avg_rating as r26, avg_ats as a26 from ya where year = 2026),
d as (
  select p24.target_label,
         p24.r24, p25.r25, p26.r26,
         p26.r26 - p24.r24 as d_abs,
         p26.r26 - p25.r25 as d_abs_yoy,
         p24.a24, p25.a25, p26.a26,
         p26.a26 - p24.a24 as d_ats
  from p24 join p25 using (target_label) join p26 using (target_label)
),
tot as (select sum(d_abs) as sum_d, sum(r26) as sum_r26, sum(r24) as sum_r24 from d)
select 'contrib' as k, json_agg(t) as v from (
  select d.target_label,
         round(d.r24::numeric, 5)      as r24,
         round(d.r26::numeric, 5)      as r26,
         round(d.d_abs::numeric, 5)    as delta_abs,
         round((100 * d.d_abs / (select sum_d from tot))::numeric, 1) as contrib_pct,
         round((100 * (d.r26 / d.r24 - 1))::numeric, 1)               as growth_pct,
         round(d.d_abs_yoy::numeric, 5) as delta_abs_yoy,
         round(d.d_ats::numeric, 0)     as delta_ats_sec,
         round((100 * (d.a26 / d.a24 - 1))::numeric, 1)               as ats_growth_pct,
         rank() over (order by d.d_abs desc)      as rank_abs,
         rank() over (order by d.r26 / d.r24 desc) as rank_growth,
         rank() over (order by d.d_ats desc)      as rank_ats
  from d
  order by d.d_abs desc
) t
union all
select 'totals', json_agg(t) from (
  select round(sum_r24::numeric, 5) as sum_r24,
         round(sum_r26::numeric, 5) as sum_r26,
         round(sum_d::numeric, 5)   as sum_delta
  from tot
) t
union all
select 'recent_q', json_agg(t) from (
  select target_label,
         round(avg(rating)::numeric, 5)                 as q3_2026_rating,
         round(avg(avg_time_spent_seconds)::numeric, 0) as q3_2026_ats,
         count(*)                                       as n_months
  from base
  where year = 2026 and month between 7 and 9
  group by target_label
  order by 2 desc
) t
union all
select 'multiple', json_agg(t) from (
  select yr,
         round(r60::numeric, 5)  as rating_60plus,
         round(r20::numeric, 5)  as rating_20s,
         round(r30::numeric, 5)  as rating_30s,
         round((r60 / r20)::numeric, 1) as x_60_over_20,
         round((r60 / r30)::numeric, 1) as x_60_over_30
  from (
    select year as yr,
           sum(avg_rating) filter (where target_label like '%60대이상') as r60,
           sum(avg_rating) filter (where target_label like '%20대')     as r20,
           sum(avg_rating) filter (where target_label like '%30대')     as r30
    from ya group by year
  ) z
  order by yr
) t
