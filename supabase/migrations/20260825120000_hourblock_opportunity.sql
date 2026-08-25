-- 사용자 지시(2026-08-25, 원 명세 감사 후속: 9번 "Slot Intelligence — 8 Blocks") — OPPORTUNITY?는
-- 지금 4구간(새벽/오전/오후/저녁_심야, get_channel_daypart_opportunity)만 판단한다. 이미 다른 곳
-- (get_channel_dow_hourblock_pattern, 최근 12주 요일×시간대 히트맵)에 3시간 단위 8구간이 있지만
-- 거긴 "우리 채널 자기 자신"만 볼 뿐 경쟁채널 격차가 없어 PROTECT/DEFEND/IMPROVE/OPPORTUNITY
-- 판정에 못 쓴다. get_channel_daypart_opportunity(4구간, WHY?/OPPORTUNITY?/WHAT TO SCHEDULE?
-- 핵심 로직 여러 곳에서 이미 쓰는 중)는 절대 건드리지 않고, 같은 로직을 8구간(02,05,08,...,23시
-- 시작)으로 그대로 미러링한 별도 함수를 추가한다 — Page 2에 "8구간 상세"로 추가 표시만 하고,
-- 기존 4구간 판정/서술 로직(WHY?/Executive Insight 등)은 그대로 둔다(Delta-Only).
create or replace function get_channel_hourblock_opportunity(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_full_window_days int default 365,
  p_recent_days int default 7
)
returns table (
  hour_block int, -- 그 3시간 구간의 시작 시각(2,5,8,11,14,17,20,23)
  our_full_avg numeric,
  our_recent_avg numeric,
  competitor_full_avg numeric,
  competitor_recent_avg numeric,
  gap_full numeric,
  gap_recent numeric,
  gap_change numeric
)
language sql
stable
as $$
  with hb_expr as (
    select
      r.rating, r.broadcast_date,
      (2 + 3 * floor((
        (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) - 2
      ) / 3.0))::int as hour_block
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_full_window_days) and p_as_of_date
  ),
  cp_expr as (
    select
      cp.rating, cp.broadcast_date,
      (2 + 3 * floor((
        (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) - 2
      ) / 3.0))::int as hour_block
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id
    where c.code = p_channel_code and cp.rating is not null
      and cp.broadcast_date between (p_as_of_date - p_full_window_days) and p_as_of_date
  ),
  our_agg as (
    select hour_block,
      avg(rating) filter (where broadcast_date <= p_as_of_date - p_recent_days) as full_avg,
      avg(rating) filter (where broadcast_date > p_as_of_date - p_recent_days) as recent_avg
    from hb_expr
    group by hour_block
  ),
  comp_agg as (
    select hour_block,
      avg(rating) filter (where broadcast_date <= p_as_of_date - p_recent_days) as full_avg,
      avg(rating) filter (where broadcast_date > p_as_of_date - p_recent_days) as recent_avg
    from cp_expr
    group by hour_block
  ),
  blocks as (select unnest(array[2, 5, 8, 11, 14, 17, 20, 23]) as hour_block)
  select
    b.hour_block,
    round(o.full_avg::numeric, 5) as our_full_avg,
    round(o.recent_avg::numeric, 5) as our_recent_avg,
    round(cm.full_avg::numeric, 5) as competitor_full_avg,
    round(cm.recent_avg::numeric, 5) as competitor_recent_avg,
    round((cm.full_avg - o.full_avg)::numeric, 5) as gap_full,
    round((cm.recent_avg - o.recent_avg)::numeric, 5) as gap_recent,
    round(((cm.full_avg - o.full_avg) - (cm.recent_avg - o.recent_avg))::numeric, 5) as gap_change
  from blocks b
  left join our_agg o on o.hour_block = b.hour_block
  left join comp_agg cm on cm.hour_block = b.hour_block
  order by b.hour_block;
$$;
comment on function get_channel_hourblock_opportunity is 'Page 2 OPPORTUNITY? "8구간 상세" 전용(3시간 단위, 02~04시부터 23~25시까지). get_channel_daypart_opportunity(4구간, WHY?/Executive Insight 등 핵심 서술 로직이 이미 쓰는 중)는 그대로 두고 별도로 추가함 — 원 명세 9번(Slot Intelligence 8 Blocks) 보강.';
