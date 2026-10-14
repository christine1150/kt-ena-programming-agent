-- B2: 구조 확인 + 타깃별 2025 vs 2026 평균 지표 (전국 성/연령 16종)
with ch as (
  select id from channels where name ilike 'OLIFE'
),
base as (
  select r.*, t.label
  from ratings r
  join targets t on t.id = r.target_id
  where r.channel_id = (select id from ch)
    and r.source_type = 'nielsen_daily'
    and t.label in (
      '전국 남0409','전국 남10대','전국 남20대','전국 남30대','전국 남40대','전국 남50대','전국 남60대+',
      '전국 여0409','전국 여10대','전국 여20대','전국 여30대','전국 여40대','전국 여50대','전국 여60대+',
      '전국 5064','전국 유료가구'
    )
    and r.broadcast_date between date '2025-01-01' and date '2026-09-06'
),
structure_x as (
  select
    extract(year from broadcast_date)::int as yr,
    count(*) as rows_all,
    count(*) filter (where program_id is null) as rows_null_program,
    count(distinct broadcast_date) as days,
    count(distinct start_time) as distinct_start_times,
    count(distinct program_id) as distinct_programs,
    count(distinct (broadcast_date::text || '|' || start_time::text || '|' || coalesce(program_id::text,'NA'))) as distinct_slots,
    count(distinct label) as n_targets
  from base
  group by 1
),
summary_x as (
  select
    label,
    extract(year from broadcast_date)::int as yr,
    count(*) as n_rows,
    count(rating) as n_rating,
    count(reach) as n_reach,
    count(time_spent_seconds) as n_ats,
    count(time_spent_share) as n_ats_share,
    round(avg(rating)::numeric, 6) as avg_rating,
    round(avg(reach)::numeric, 6) as avg_reach,
    round(avg(time_spent_seconds)::numeric, 1) as avg_ats_sec,
    round(avg(time_spent_share)::numeric, 6) as avg_ats_share,
    round(avg(share)::numeric, 6) as avg_share
  from base
  group by 1, 2
)
select 'structure' as k, json_agg(structure_x order by structure_x.yr) as v from structure_x
union all
select 'summary' as k, json_agg(summary_x order by summary_x.label, summary_x.yr) as v from summary_x;
