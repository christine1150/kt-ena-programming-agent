-- 시간대 / 요일 분석 (ratings, 전국 유료가구)
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구'),
b as (
  select r.broadcast_date bd, r.start_time st, r.program_id pid, r.rating, r.reach,
         r.time_spent_seconds ats, r.time_spent_share tss,
         case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time) + 24
              else extract(hour from r.start_time) end as hh,
         extract(isodow from r.broadcast_date)::int dow,
         case when r.broadcast_date < date '2026-01-01' then 2025 else 2026 end yr
  from ratings r
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
),
dp as (
  select *, case when hh between 2 and 8 then '새벽 02-08'
                 when hh between 9 and 13 then '오전 09-13'
                 when hh between 14 and 18 then '오후 14-18'
                 else '저녁심야 19-25' end daypart
  from b
)
select 'daypart_year' k, json_agg(x order by x.daypart, x.yr) v from (
  select daypart, yr, count(*) slots, round(avg(rating),5) rating, round(avg(ats),0) ats,
         round(avg(reach),5) reach, round(avg(tss),5) tss
  from dp group by 1,2) x
union all
select 'hour_year', json_agg(x order by x.hh, x.yr) from (
  select hh::int hh, yr, count(*) slots, round(avg(rating),5) rating, round(avg(ats),0) ats
  from dp group by 1,2) x
union all
select 'dow_year', json_agg(x order by x.dow, x.yr) from (
  select dow, yr, count(*) slots, round(avg(rating),5) rating, round(avg(ats),0) ats
  from dp group by 1,2) x
union all
select 'heat26', json_agg(x order by x.dow, x.hh) from (
  select dow, hh::int hh, round(avg(rating),5) rating, count(*) n
  from dp where yr = 2026 group by 1,2) x
union all
select 'heat25', json_agg(x order by x.dow, x.hh) from (
  select dow, hh::int hh, round(avg(rating),5) rating, count(*) n
  from dp where yr = 2025 group by 1,2) x
union all
select 'dawn57', json_agg(x order by x.yr) from (
  select yr, count(*) slots, round(avg(rating),5) rating, round(avg(ats),0) ats
  from dp where hh between 5 and 7 group by 1) x
union all
select 'top_slots', json_agg(x) from (
  select dow, hh::int hh, round(avg(rating),5) rating, count(*) n
  from dp where yr = 2026 group by 1,2 having count(*) >= 20 order by 3 desc limit 10) x;
