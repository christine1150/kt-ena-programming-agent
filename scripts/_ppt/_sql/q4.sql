with latest as (
  select max(date_to) dt from market_ytd_rank_snapshot
),
s as (
  select target_label tl, channel_name cn, rank, rating, share,
         avg_time_spent_seconds ats, avg_time_spent_ratio atsr, date_from, date_to
  from market_ytd_rank_snapshot where date_to = (select dt from latest)
),
hh as (select * from s where tl='유료방송가구'),
ol as (select min(rank) r from hh where cn ilike '%OLIFE%'),
ats_rank as (select cn, rank, rating, ats, row_number() over (order by ats desc nulls last) ats_rn from hh where ats is not null)
select 'snapshots' k, json_agg(x order by x.date_to) v from (
  select target_label tl, date_from, date_to, count(*) n from market_ytd_rank_snapshot group by 1,2,3) x
union all
select 'olife', json_agg(x) from (select * from s where cn ilike '%OLIFE%') x
union all
select 'top20', json_agg(x order by x.rank) from (select cn, rank, round(rating,5) rating, round(share,5) share, round(ats,0) ats from hh where rank<=20) x
union all
select 'neighbors', json_agg(x order by x.rank) from (
  select cn, rank, round(rating,5) rating, round(ats,0) ats from hh
  where rank between (select r-5 from ol) and (select r+5 from ol)) x
union all
select 'ats_top15', json_agg(x order by x.ats_rn) from (select cn, rank, round(rating,5) rating, round(ats,0) ats, ats_rn from ats_rank where ats_rn<=15) x
union all
select 'olife_ats_rank', json_agg(x) from (select cn, rank rating_rank, ats_rn ats_rank, round(ats,0) ats from ats_rank where cn ilike '%OLIFE%') x
union all
select 'scatter40', json_agg(x order by x.rank) from (select cn, rank, round(rating,5) rating, round(ats,0) ats from hh where rank<=40 and ats is not null) x
union all
select 'universe', json_agg(x) from (select tl, count(*) n, max(rank) maxrank, min(date_from) d0, max(date_to) d1 from s group by tl) x
union all
select 'olife_2049', json_agg(x) from (select * from s where tl='수도권2049' and cn ilike '%OLIFE%') x;
