-- 프로그램 성과 + 성장 기여 분해 (ratings + programs, 전국 유료가구)
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구'),
b as (
  select p.canonical_name nm, r.broadcast_date bd, r.rating, r.time_spent_seconds ats, r.reach,
         case when r.broadcast_date < date '2026-01-01' then 2025 else 2026 end yr
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
),
tot as (select yr, count(*) slots, avg(rating) ch_rating from b group by yr),
pg as (
  select nm, yr, count(*) slots, avg(rating) rating, avg(ats) ats, avg(reach) reach
  from b group by 1,2
),
pg_all as (
  select nm, count(*) slots, round(avg(rating),5) rating, round(avg(ats),0) ats,
         round(avg(rating) * count(*), 3) contrib_mass
  from b group by 1
),
w as (
  select q.nm,
         coalesce(a.slots,0) s25, coalesce(c.slots,0) s26,
         a.rating r25, c.rating r26,
         coalesce(c.slots,0)::numeric / (select slots from tot where yr = 2026) w26,
         coalesce(a.slots,0)::numeric / (select slots from tot where yr = 2025) w25
  from (select distinct nm from b) q
  left join pg a on a.nm = q.nm and a.yr = 2025
  left join pg c on c.nm = q.nm and c.yr = 2026
)
select 'channel_year' k, json_agg(x order by x.yr) v from (
  select yr, slots, round(ch_rating,5) ch_rating from tot) x
union all
select 'top_rating', json_agg(x order by x.rating desc) from (
  select nm, slots, rating, ats from pg_all where slots >= 30 order by rating desc limit 18) x
union all
select 'top_mass', json_agg(x order by x.contrib_mass desc) from (
  select nm, slots, rating, contrib_mass from pg_all order by contrib_mass desc limit 12) x
union all
select 'pg_year', json_agg(x order by x.nm, x.yr) from (
  select nm, yr, slots, round(rating,5) rating, round(ats,0) ats from pg where slots >= 20) x
union all
select 'decomp', json_agg(x order by x.total_contrib desc) from (
  select nm, s25, s26, round(r25,5) r25, round(r26,5) r26,
         round(100 * w25, 2) w25p, round(100 * w26, 2) w26p,
         round((w26 * coalesce(r26,0) - w25 * coalesce(r25,0))::numeric, 6) total_contrib,
         round(((w26 - w25) * coalesce(r25, coalesce(r26,0)))::numeric, 6) mix_effect,
         round((w26 * (coalesce(r26,0) - coalesce(r25, coalesce(r26,0))))::numeric, 6) perf_effect
  from w) x
union all
select 'underused', json_agg(x order by x.rating desc) from (
  select nm, slots, rating, ats from pg_all
  where slots between 10 and 200 and rating > (select avg(rating) from b)
  order by rating desc limit 10) x;
