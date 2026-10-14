-- 최근 모멘텀 · 리스크 신호 (전국 유료가구)
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구'),
b as (
  select p.canonical_name nm, r.broadcast_date bd, r.rating, r.reach, r.time_spent_seconds ats,
         date_trunc('month', r.broadcast_date)::date m, to_char(r.broadcast_date,'YY-MM') ym,
         date_trunc('week', r.broadcast_date)::date wk
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
),
mo as (select m, ym, count(*) slots, avg(rating) rating, avg(reach) reach, avg(ats) ats from b group by 1,2),
rk as (select m, nm, count(*) c, avg(rating) r, row_number() over (partition by m order by count(*) desc) rn from b group by 1,2),
dep as (
  select m, round(100.0 * sum(c) filter (where rn = 1) / sum(c), 1) top1_slot_pct,
         round(100.0 * sum(c * r) filter (where rn = 1) / nullif(sum(c * r), 0), 1) top1_mass_pct
  from rk group by 1
),
recent as (
  select nm, count(*) n, avg(rating) r
  from b where bd >= date '2026-06-07' group by 1 having count(*) >= 25
),
prior as (
  select nm, count(*) n, avg(rating) r
  from b where bd >= date '2026-03-07' and bd < date '2026-06-07' group by 1 having count(*) >= 25
)
select 'month_all' k, json_agg(x order by x.m) v from (
  select ym, m, slots, round(rating,5) rating, round(reach,5) reach, round(ats,0) ats from mo) x
union all
select 'week_2026', json_agg(x order by x.wk) from (
  select wk, count(*) slots, round(avg(rating),5) rating from b
  where bd >= date '2026-01-01' group by 1 having count(*) >= 60) x
union all
select 'dependency', json_agg(x order by x.m) from (select * from dep) x
union all
select 'trend_pgm', json_agg(x order by x.delta) from (
  select p.nm, p.n n_prior, r.n n_recent, round(p.r,5) r_prior, round(r.r,5) r_recent,
         round((r.r - p.r)::numeric, 5) delta,
         round(100 * (r.r - p.r) / nullif(p.r, 0), 1) pct
  from prior p join recent r on r.nm = p.nm) x
union all
select 'daily_top15', json_agg(x order by x.rating desc) from (
  select bd, round(avg(rating),5) rating, count(*) slots from b group by 1 order by 2 desc limit 15) x
union all
select 'jul_vs_apr', json_agg(x order by x.m, x.c desc) from (
  select m, nm, count(*) c, round(avg(rating),5) r from b
  where m in (date '2026-04-01', date '2026-07-01') group by 1,2) x;
