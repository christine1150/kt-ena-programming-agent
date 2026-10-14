-- OLIFE: 월별 온에어 Unique 프로그램 수 + TOP5 프로그램 편성 집중도 재검증
-- 슬롯은 (방송일, 시작시간, 프로그램) 중복 제거 기준으로 센다(타깃별 중복 제거).
with slot as (
  select distinct
         date_trunc('month', r.broadcast_date)::date as m,
         r.broadcast_date, r.start_time, r.program_id
  from ratings r
  join channels c on c.id = r.channel_id
  where c.name ilike 'OLIFE'
    and r.program_id is not null
    and r.broadcast_date >= date '2024-01-01'
),
per_month as (
  select m, count(distinct program_id) as uniq_pgm, count(*) as slots
  from slot group by m
),
ranked as (
  select m, program_id, count(*) as cnt,
         row_number() over (partition by m order by count(*) desc) as rn
  from slot group by m, program_id
),
top5 as (
  select m, sum(cnt) as top5_slots from ranked where rn <= 5 group by m
)
select p.m, p.uniq_pgm, p.slots, t.top5_slots,
       round(100.0 * t.top5_slots / nullif(p.slots, 0), 1) as top5_share_pct
from per_month p join top5 t using (m)
order by p.m;
