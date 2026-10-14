-- A3-02: OLIFE 월간(2026-01~08) / 주간(2026-01-26~09-06) 타깃별 rank·rating·share·reach·ATS 전체 시계열
with ol as (
  select id from channels where name ilike 'OLIFE'
),
base as (
  select r.period_type, r.date_from, r.date_to, t.label as target_label,
         r.rank, r.rating, r.share, r.reach, r.time_spent_seconds
  from nielsen_period_rank r
  join targets t on t.id = r.target_id
  where r.channel_id = (select id from ol)
)
select 'monthly' as k,
       json_agg(json_build_object(
         'ym', to_char(date_from,'YYYY-MM'),
         'tgt', target_label,
         'rank', rank,
         'rating', rating,
         'share', share,
         'reach', reach,
         'ats', time_spent_seconds
       ) order by target_label, date_from) as v
from base where period_type = 'monthly'
union all
select 'weekly' as k,
       json_agg(json_build_object(
         'wk', to_char(date_from,'MM-DD'),
         'df', date_from::text,
         'tgt', target_label,
         'rank', rank,
         'rating', rating,
         'share', share,
         'reach', reach,
         'ats', time_spent_seconds
       ) order by target_label, date_from) as v
from base where period_type = 'weekly'
