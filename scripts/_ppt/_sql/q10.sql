-- 슬롯 간 흐름(Lead-out 대리지표) — 같은 날 인접 슬롯을 lead()로 연결
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구'),
b as (
  select r.broadcast_date bd, r.start_time st, r.rating, p.canonical_name nm,
         case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time) + 24
              else extract(hour from r.start_time) end as hh,
         case when r.broadcast_date < date '2026-01-01' then 2025 else 2026 end yr
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
),
seq as (
  select bd, hh, yr, nm cur_nm, rating cur_r,
         lead(nm) over (partition by bd order by hh, st) next_nm,
         lead(rating) over (partition by bd order by hh, st) next_r
  from b
),
pairs as (
  select *, next_r / nullif(cur_r, 0) ratio,
         case when cur_nm = next_nm then '같은 프로그램 연속' else '다른 프로그램 전환' end kind,
         case when hh between 2 and 8 then '새벽 02-08'
              when hh between 9 and 13 then '오전 09-13'
              when hh between 14 and 18 then '오후 14-18'
              else '저녁심야 19-25' end daypart
  from seq where next_r is not null and cur_r > 0
)
select 'by_kind' k, json_agg(x order by x.kind) v from (
  select kind, count(*) n, round(avg(ratio),3) avg_ratio,
         round(percentile_cont(0.5) within group (order by ratio)::numeric, 3) med_ratio
  from pairs group by 1) x
union all
select 'by_kind_year', json_agg(x order by x.kind, x.yr) from (
  select kind, yr, count(*) n, round(avg(ratio),3) avg_ratio,
         round(percentile_cont(0.5) within group (order by ratio)::numeric, 3) med_ratio
  from pairs group by 1,2) x
union all
select 'by_daypart', json_agg(x order by x.daypart) from (
  select daypart, count(*) n, round(avg(ratio),3) avg_ratio,
         round(percentile_cont(0.5) within group (order by ratio)::numeric, 3) med_ratio
  from pairs group by 1) x
union all
select 'best_pairs', json_agg(x order by x.avg_ratio desc) from (
  select cur_nm, next_nm, count(*) n, round(avg(ratio),3) avg_ratio
  from pairs where cur_nm <> next_nm group by 1,2 having count(*) >= 40 order by 4 desc limit 10) x
union all
select 'worst_pairs', json_agg(x order by x.avg_ratio) from (
  select cur_nm, next_nm, count(*) n, round(avg(ratio),3) avg_ratio
  from pairs where cur_nm <> next_nm group by 1,2 having count(*) >= 40 order by 4 asc limit 8) x;
