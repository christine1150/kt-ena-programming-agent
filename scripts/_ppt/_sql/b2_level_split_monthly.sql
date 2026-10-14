-- B2: (1) 채널단위 일별행 vs 프로그램단위 슬롯행 분리 집계, (2) 4대 세그먼트 월별 ATS 시계열
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
-- 채널단위 일별 행 (program_id is null): 하루 1행/타깃
chan_daily as (
  select
    label,
    extract(year from broadcast_date)::int as yr,
    count(*) as n_days,
    count(rating) as n_rating,
    count(reach) as n_reach,
    count(time_spent_seconds) as n_ats,
    count(time_spent_share) as n_ats_share,
    round(avg(rating)::numeric, 6) as avg_rating,
    round(avg(share)::numeric, 6) as avg_share,
    round(avg(reach)::numeric, 6) as avg_reach,
    round(avg(time_spent_seconds)::numeric, 1) as avg_ats_sec,
    round(avg(time_spent_share)::numeric, 4) as avg_ats_share
  from base
  where program_id is null
  group by 1, 2
),
-- 프로그램단위 슬롯 행 (중복제거: broadcast_date, start_time, program_id)
prog_dedup as (
  select distinct on (label, broadcast_date, start_time, program_id)
    label, broadcast_date, start_time, program_id, rating, share, reach, time_spent_seconds, time_spent_share
  from base
  where program_id is not null
  order by label, broadcast_date, start_time, program_id, id
),
prog_slot as (
  select
    label,
    extract(year from broadcast_date)::int as yr,
    count(*) as n_slots,
    count(rating) as n_rating,
    count(time_spent_seconds) as n_ats,
    round(avg(rating)::numeric, 6) as avg_rating,
    round(avg(share)::numeric, 6) as avg_share,
    round(avg(reach)::numeric, 6) as avg_reach,
    round(avg(time_spent_seconds)::numeric, 1) as avg_ats_sec,
    round(avg(time_spent_share)::numeric, 4) as avg_ats_share
  from prog_dedup
  group by 1, 2
),
-- 4대 핵심 세그먼트 월별 ATS (채널단위 일별행 기준)
monthly_core as (
  select
    label,
    to_char(broadcast_date, 'YYYY-MM') as ym,
    count(*) as n_days,
    round(avg(time_spent_seconds)::numeric, 0) as avg_ats_sec,
    round(avg(rating)::numeric, 6) as avg_rating,
    round(avg(reach)::numeric, 6) as avg_reach
  from base
  where program_id is null
    and label in ('전국 남60대+','전국 여60대+','전국 남50대','전국 여50대')
  group by 1, 2
)
select 'chan_daily' as k, json_agg(chan_daily order by chan_daily.label, chan_daily.yr) as v from chan_daily
union all
select 'prog_slot' as k, json_agg(prog_slot order by prog_slot.label, prog_slot.yr) as v from prog_slot
union all
select 'monthly_core' as k, json_agg(monthly_core order by monthly_core.label, monthly_core.ym) as v from monthly_core;
