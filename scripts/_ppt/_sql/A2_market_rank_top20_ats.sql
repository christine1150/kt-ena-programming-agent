-- A2: 최신 스냅샷(date_to=2026-09-06)만 사용한 상위 20 순위표 + ATS 비교
with snap as (
  select target_label, channel_name, rank, rating, share,
         avg_time_spent_seconds as ats, avg_time_spent_ratio as ats_ratio
  from market_ytd_rank_snapshot
  where date_from = '2026-01-01' and date_to = '2026-09-06'
),
hh as (select * from snap where target_label = '유료방송가구'),
t2049 as (select * from snap where target_label = '수도권2049'),
top20_hh as (select channel_name, rank, rating, share, ats, ats_ratio from hh order by rank limit 20),
top20_2049 as (select channel_name, rank, rating, share, ats, ats_ratio from t2049 order by rank limit 20),
-- ATS 기준 재정렬: 유료방송가구 스냅샷 전체에서 ATS 순위
ats_rank as (
  select channel_name, rank as rating_rank, rating, ats,
         row_number() over (order by ats desc nulls last) as ats_rank
  from hh where ats is not null
),
olife_ats as (select * from ats_rank where channel_name ilike 'OLIFE'),
-- 상위 20채널(시청률 기준)의 ATS
top20_ats as (select channel_name, rating_rank, rating, ats, ats_rank from ats_rank where rating_rank <= 20 order by rating_rank),
-- ATS 상위 15채널
ats_top15 as (select channel_name, rating_rank, rating, ats, ats_rank from ats_rank order by ats_rank limit 15),
-- 요약: 전체 / 상위20 / 상위50 ATS 평균·중앙값
ats_summary as (
  select 'all_channels' as grp, count(*) as n, round(avg(ats)) as ats_avg,
         round(percentile_cont(0.5) within group (order by ats)) as ats_median
  from ats_rank
  union all
  select 'rating_top20', count(*), round(avg(ats)),
         round(percentile_cont(0.5) within group (order by ats))
  from ats_rank where rating_rank <= 20
  union all
  select 'rating_top50', count(*), round(avg(ats)),
         round(percentile_cont(0.5) within group (order by ats))
  from ats_rank where rating_rank <= 50
  union all
  select 'rating_31_40', count(*), round(avg(ats)),
         round(percentile_cont(0.5) within group (order by ats))
  from ats_rank where rating_rank between 31 and 40
)
select 'top20_hh' as k, json_agg(x) as v from (select * from top20_hh order by rank) x
union all
select 'top20_2049', json_agg(x) from (select * from top20_2049 order by rank) x
union all
select 'olife_ats', json_agg(x) from (select * from olife_ats) x
union all
select 'top20_ats', json_agg(x) from (select * from top20_ats) x
union all
select 'ats_top15', json_agg(x) from (select * from ats_top15) x
union all
select 'ats_summary', json_agg(x) from (select * from ats_summary) x
union all
select 'cnt', json_agg(x) from (select target_label, count(*) as n, min(rank) as mn, max(rank) as mx from snap group by target_label) x
;
