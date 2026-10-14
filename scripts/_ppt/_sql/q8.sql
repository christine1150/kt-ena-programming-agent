-- 편성 구조 변화: 월별 종수 / 집중도 / 신규·이탈 (전국 유료가구)
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구'),
b as (
  select date_trunc('month', r.broadcast_date)::date m, to_char(r.broadcast_date,'YY-MM') ym,
         p.canonical_name nm,
         case when r.broadcast_date < date '2026-01-01' then 2025 else 2026 end yr
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
),
pm as (select m, ym, count(distinct nm) uniq, count(*) slots from b group by 1,2),
rk as (
  select m, nm, count(*) c, row_number() over (partition by m order by count(*) desc) rn
  from b group by 1,2
),
conc as (
  select m,
    sum(c) filter (where rn <= 1) t1, sum(c) filter (where rn <= 3) t3,
    sum(c) filter (where rn <= 5) t5, sum(c) filter (where rn <= 10) t10, sum(c) tot
  from rk group by 1
),
yp as (select yr, nm, count(*) c from b group by 1,2)
select 'monthly' k, json_agg(x order by x.m) v from (
  select p.m, p.ym, p.uniq, p.slots,
    round(100.0 * c.t1 / c.tot, 1) top1, round(100.0 * c.t3 / c.tot, 1) top3,
    round(100.0 * c.t5 / c.tot, 1) top5, round(100.0 * c.t10 / c.tot, 1) top10
  from pm p join conc c using (m)) x
union all
select 'gone', json_agg(x order by x.c25 desc) from (
  select a.nm, a.c c25 from yp a
  where a.yr = 2025 and not exists (select 1 from yp z where z.yr = 2026 and z.nm = a.nm)
  order by 2 desc limit 12) x
union all
select 'new', json_agg(x order by x.c26 desc) from (
  select a.nm, a.c c26 from yp a
  where a.yr = 2026 and not exists (select 1 from yp z where z.yr = 2025 and z.nm = a.nm)
  order by 2 desc limit 12) x
union all
select 'year_summary', json_agg(x order by x.yr) from (
  select yr, count(distinct nm) uniq, count(*) slots from b group by 1) x
union all
select 'top5_by_month', json_agg(x order by x.m, x.rn) from (
  select m, nm, c, rn from rk where rn <= 5) x;
