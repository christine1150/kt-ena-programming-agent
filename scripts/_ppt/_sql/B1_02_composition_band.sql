-- B1-02: 성연령 10개 세그먼트 rating 구성비(연도별) + 연령대 밴드/성별 집계 (전체월 및 1~9월 정렬 2종)
with base as (
  select target_label, year, month, rating, avg_time_spent_seconds
  from olife_reference_metrics
  where granularity = 'monthly'
    and dimension  = 'age_gender'
    and target_label <> '유료방송가구'
),
ya_full as (
  select target_label, year, avg(rating) as avg_rating
  from base group by target_label, year
),
tot_full as (select year, sum(avg_rating) as sum_rating from ya_full group by year),
ya_js as (
  select target_label, year, avg(rating) as avg_rating
  from base where month between 1 and 9 group by target_label, year
),
tot_js as (select year, sum(avg_rating) as sum_rating from ya_js group by year)
select 'comp_full' as k, json_agg(t) as v from (
  select y.target_label, y.year,
         round(y.avg_rating::numeric, 5)                      as avg_rating,
         round((100 * y.avg_rating / p.sum_rating)::numeric, 1) as pct_share,
         round(p.sum_rating::numeric, 5)                      as sum_rating
  from ya_full y join tot_full p on p.year = y.year
  order by y.year, y.target_label
) t
union all
select 'comp_js', json_agg(t) from (
  select y.target_label, y.year,
         round(y.avg_rating::numeric, 5)                      as avg_rating,
         round((100 * y.avg_rating / p.sum_rating)::numeric, 1) as pct_share,
         round(p.sum_rating::numeric, 5)                      as sum_rating
  from ya_js y join tot_js p on p.year = y.year
  order by y.year, y.target_label
) t
union all
select 'band_full', json_agg(t) from (
  select yr, band,
         round(sum(avg_rating)::numeric, 5)                          as band_rating,
         round((100 * sum(avg_rating) / max(sum_rating))::numeric, 1) as band_pct
  from (
    select y.year as yr,
           case when y.target_label like '%20대' then 'A_20s'
                when y.target_label like '%30대' then 'B_30s'
                when y.target_label like '%40대' then 'C_40s'
                when y.target_label like '%50대' then 'D_50s'
                else 'E_60plus' end as band,
           y.avg_rating, p.sum_rating
    from ya_full y join tot_full p on p.year = y.year
  ) z
  group by yr, band
  order by yr, band
) t
union all
select 'gender_full', json_agg(t) from (
  select yr, sex,
         round(sum(avg_rating)::numeric, 5)                          as sex_rating,
         round((100 * sum(avg_rating) / max(sum_rating))::numeric, 1) as sex_pct
  from (
    select y.year as yr,
           case when y.target_label like '유료방송 남%' then 'M' else 'F' end as sex,
           y.avg_rating, p.sum_rating
    from ya_full y join tot_full p on p.year = y.year
  ) z
  group by yr, sex
  order by yr, sex
) t
