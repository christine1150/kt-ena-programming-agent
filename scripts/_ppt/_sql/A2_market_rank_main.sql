-- A2: 시장 내 순위 (market_ytd_rank_snapshot 2026-01-01~2026-09-06 누적)
with base as (
  select target_label, channel_name, rank, rating, share,
         avg_time_spent_seconds, avg_time_spent_ratio, date_from, date_to
  from market_ytd_rank_snapshot
),
meta as (
  select target_label, count(*) as ch_cnt, min(date_from) as d_from, max(date_to) as d_to,
         min(rank) as min_rank, max(rank) as max_rank
  from base group by target_label
),
olife_hh as (
  select * from base where target_label = '유료방송가구' and channel_name ilike 'OLIFE'
),
olife_2049 as (
  select * from base where target_label = '수도권2049' and channel_name ilike 'OLIFE'
),
top20_hh as (
  select * from base where target_label = '유료방송가구' order by rank asc limit 20
),
top20_2049 as (
  select * from base where target_label = '수도권2049' order by rank asc limit 20
),
nb_hh as (
  select b.* from base b, olife_hh o
  where b.target_label = '유료방송가구' and b.rank between o.rank - 3 and o.rank + 3
  order by b.rank
),
nb_2049 as (
  select b.* from base b, olife_2049 o
  where b.target_label = '수도권2049' and b.rank between o.rank - 3 and o.rank + 3
  order by b.rank
)
select 'meta' as k, json_agg(x) as v from (select * from meta order by target_label) x
union all
select 'olife_hh', json_agg(x) from (select * from olife_hh) x
union all
select 'olife_2049', json_agg(x) from (select * from olife_2049) x
union all
select 'top20_hh', json_agg(x) from (select * from top20_hh order by rank) x
union all
select 'top20_2049', json_agg(x) from (select * from top20_2049 order by rank) x
union all
select 'nb_hh', json_agg(x) from (select * from nb_hh) x
union all
select 'nb_2049', json_agg(x) from (select * from nb_2049) x
;
