-- A3-01: OLIFE nielsen_period_rank 커버리지 개요 (타깃 목록 · 기간 · 행수)
with ol as (
  select id from channels where name ilike 'OLIFE'
),
base as (
  select r.*, t.label as target_label
  from nielsen_period_rank r
  join targets t on t.id = r.target_id
  where r.channel_id = (select id from ol)
)
select 'coverage' as k,
       json_agg(x order by x.period_type, x.target_label) as v
from (
  select period_type,
         target_label,
         count(*) as n,
         min(date_from)::text as first_from,
         max(date_to)::text   as last_to,
         count(rank) as n_rank,
         count(rating) as n_rating,
         count(share) as n_share,
         count(reach) as n_reach,
         count(time_spent_seconds) as n_ats
  from base
  group by 1,2
) x
