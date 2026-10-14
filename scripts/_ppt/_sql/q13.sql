-- 동일 콘텐츠 · 다른 채널 비교 (OLIFE vs ONT, 2026-01-01~2026-02-28 동일 기간)
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구'),
mine as (
  select p.canonical_name nm, count(*) n, avg(r.rating) rating
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
    and r.broadcast_date between date '2026-01-01' and date '2026-02-28'
  group by 1
),
theirs as (
  select replace(replace(program_name,' ',''),'  ','') nm, count(*) n, avg(rating) rating
  from competitor_program_ratings
  where our_channel_id = (select id from ol) and competitor_name = 'ONT'
    and broadcast_date between date '2026-01-01' and date '2026-02-28'
  group by 1
),
mine_hr as (
  select case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time) + 24
              else extract(hour from r.start_time) end hh,
         avg(r.rating) rating, count(*) n
  from ratings r
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
    and r.broadcast_date between date '2026-01-01' and date '2026-02-28'
  group by 1
),
their_hr as (
  select case when extract(hour from start_time) < 2 then extract(hour from start_time) + 24
              else extract(hour from start_time) end hh,
         avg(rating) rating, count(*) n
  from competitor_program_ratings
  where our_channel_id = (select id from ol) and competitor_name = 'ONT'
    and broadcast_date between date '2026-01-01' and date '2026-02-28'
  group by 1
)
select 'same_program' k, json_agg(x order by x.olife_rating desc) v from (
  select m.nm, m.n olife_n, round(m.rating,5) olife_rating,
         t.n ont_n, round(t.rating,5) ont_rating,
         round((m.rating / nullif(t.rating,0))::numeric, 2) multiple
  from mine m join theirs t on t.nm = m.nm) x
union all
select 'hour_vs', json_agg(x order by x.hh) from (
  select a.hh::int hh, round(a.rating,5) olife, round(b.rating,5) ont, a.n olife_n, b.n ont_n
  from mine_hr a join their_hr b using (hh)) x
union all
select 'channel_avg', json_agg(x) from (
  select round(avg(m.rating),5) olife_avg from ratings m
  where m.channel_id = (select id from ol) and m.target_id = (select id from tg)
    and m.broadcast_date between date '2026-01-01' and date '2026-02-28') x
union all
select 'ont_avg', json_agg(x) from (
  select round(avg(rating),5) ont_avg, count(*) n from competitor_program_ratings
  where our_channel_id = (select id from ol) and competitor_name = 'ONT'
    and broadcast_date between date '2026-01-01' and date '2026-02-28') x
union all
select 'market_channels' k2, json_agg(x order by x.r26 desc nulls last) from (
  select c.competitor_name cn, t.label tl,
         round(avg(c.rating) filter (where c.broadcast_date < date '2026-01-01'),5) r25,
         round(avg(c.rating) filter (where c.broadcast_date >= date '2026-01-01'),5) r26,
         round(avg(c.time_spent_seconds) filter (where c.broadcast_date >= date '2026-01-01'),0) ats26
  from competitor_ratings c join targets t on t.id = c.target_id
  where t.label = '전국 유료가구'
  group by 1,2) x;
