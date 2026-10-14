-- A3-03: 순위 모집단 규모 확인 + OLIFE 누적 스냅샷 순위 (rank 숫자의 해석 근거)
select 'ytd_universe' as k,
       json_agg(x order by x.target_label) as v
from (
  select target_label,
         count(*) as n_channels,
         max(rank) as max_rank,
         date_from::text as df, date_to::text as dt
  from market_ytd_rank_snapshot
  group by target_label, date_from, date_to
) x
union all
select 'ytd_olife' as k,
       json_agg(x order by x.target_label) as v
from (
  select target_label, channel_name, rank, rating, share,
         avg_time_spent_seconds, avg_time_spent_ratio
  from market_ytd_rank_snapshot
  where channel_name ilike '%OLIFE%'
) x
union all
select 'npr_channels' as k,
       json_agg(x order by x.name) as v
from (
  select c.name, count(*) as n
  from nielsen_period_rank r join channels c on c.id = r.channel_id
  group by c.name
) x
