-- 본방/재방 구조 + 회차 신선도 (전국 유료가구)
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구'),
b as (
  select p.canonical_name nm, r.broadcast_date bd, r.start_time st, r.rating,
         r.time_spent_seconds ats, r.is_first_run fr, r.episode_number ep, r.program_id pid,
         case when r.broadcast_date < date '2026-01-01' then 2025 else 2026 end yr
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
),
rep as (
  select nm, bd, pid,
         exists (select 1 from b z where z.pid = b.pid and z.bd > b.bd and z.bd <= b.bd + 1) again
  from b
)
select 'firstrun' k, json_agg(x order by x.yr, x.fr) v from (
  select yr, coalesce(fr::text,'null') fr, count(*) slots, round(avg(rating),5) rating, round(avg(ats),0) ats
  from b group by 1,2) x
union all
select 'repeat24_by_pgm', json_agg(x order by x.pct desc) from (
  select nm, count(*) n, round(100.0 * count(*) filter (where again) / count(*), 1) pct
  from rep group by 1 having count(*) >= 60 order by 3 desc limit 14) x
union all
select 'repeat24_total', json_agg(x) from (
  select round(100.0 * count(*) filter (where again) / count(*), 1) pct, count(*) n from rep) x
union all
select 'ep_reuse', json_agg(x order by x.reuse desc) from (
  select nm, yr, count(*) slots, count(distinct ep) eps,
         round(count(*)::numeric / nullif(count(distinct ep),0), 2) reuse
  from b where ep is not null group by 1,2 having count(*) >= 60) x
union all
select 'ep_coverage', json_agg(x order by x.yr) from (
  select yr, count(*) slots, count(*) filter (where ep is not null) with_ep,
         round(100.0 * count(*) filter (where ep is not null) / count(*), 1) pct
  from b group by 1) x
union all
select 'catalog_country', json_agg(x order by x.n desc) from (
  select coalesce(country_guess,'미상') cty, count(*) n
  from olife_episode_catalog group by 1 order by 2 desc limit 16) x
union all
select 'catalog_series', json_agg(x order by x.n desc) from (
  select series_name sn, count(*) n, count(distinct country_guess) cty
  from olife_episode_catalog group by 1) x;
