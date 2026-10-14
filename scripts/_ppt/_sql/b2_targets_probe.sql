-- B2: 전국 성/연령 타깃 목록 및 연도별 데이터 커버리지 확인
with ch as (
  select id from channels where name ilike 'OLIFE'
)
select
  t.id as target_id,
  t.label,
  count(*) filter (where r.broadcast_date between date '2025-01-01' and date '2025-12-31') as rows_2025,
  count(*) filter (where r.broadcast_date between date '2026-01-01' and date '2026-09-06') as rows_2026,
  count(r.time_spent_seconds) filter (where r.broadcast_date between date '2025-01-01' and date '2025-12-31') as ats_rows_2025,
  count(r.time_spent_seconds) filter (where r.broadcast_date between date '2026-01-01' and date '2026-09-06') as ats_rows_2026,
  min(r.broadcast_date) as d_min,
  max(r.broadcast_date) as d_max
from ratings r
join targets t on t.id = r.target_id
where r.channel_id = (select id from ch)
  and r.source_type = 'nielsen_daily'
group by t.id, t.label
order by t.label;
