-- 시장 내 위치: 시청률 순위 vs 체류(1인당 시청시간) 순위
with latest as (select max(date_to) dt from market_ytd_rank_snapshot),
hh as (
  select channel_name cn, rank, rating, share, avg_time_spent_seconds ats, avg_time_spent_ratio atsr
  from market_ytd_rank_snapshot
  where date_to = (select dt from latest) and target_label = '유료방송가구'
),
r as (
  select cn, rank, rating, ats, atsr,
         row_number() over (order by ats desc nulls last) ats_rank
  from hh where ats is not null
),
ol as (select ats_rank from r where cn ilike '%OLIFE%')
select 'top40' k, json_agg(x order by x.rank) v from (
  select cn, rank, round(rating,5) rating, round(ats,0) ats, ats_rank from r where rank <= 40) x
union all
select 'ats_top12', json_agg(x order by x.ats_rank) from (
  select cn, rank, round(rating,5) rating, round(ats,0) ats, ats_rank from r where ats_rank <= 12) x
union all
select 'ats_near', json_agg(x order by x.ats_rank) from (
  select cn, rank, round(rating,5) rating, round(ats,0) ats, ats_rank
  from r where ats_rank between (select ats_rank - 4 from ol) and (select ats_rank + 4 from ol)) x
union all
select 'olife', json_agg(x) from (
  select cn, rank, round(rating,5) rating, round(ats,0) ats, ats_rank, round(atsr,4) atsr
  from r where cn ilike '%OLIFE%') x
union all
select 'universe', json_agg(x) from (
  select count(*) n_with_ats, max(rank) max_rank from r) x;
