-- iptv_program_block 시간 초과 근본 해소(2026-11-20). 앞선 20261120010000 색인만으로는 부족했다.
-- 원인: SQL 함수는 매개변수(p_keys 등) 값을 모른 채 하나의 일반 계획으로 실행돼 같은 질의가 값을 넣으면 1.8초인데 함수로는 28.8초 걸렸다(API 역할 제한 20초 초과).
-- 조치: 본문은 그대로 두고 plpgsql 로 감싸 호출마다 실제 값으로 계획을 세우게 한다(plan_cache_mode = force_custom_plan).
--       #variable_conflict use_column 은 반환 열 이름과 CTE 열 이름의 충돌을 막는다. 반환 열·순서·권한은 그대로(create or replace).

create or replace function iptv_program_block(p_keys text[], p_to date, p_weeks int default 12)
returns table (
  channel_name text,
  target_kind text,
  window_from date,
  window_to date,
  iptv_last_date date,
  airings int,
  first_run_airings int,
  main_slot_band text,
  avg_rating numeric,
  avg_reach_rate numeric,
  minutes_per_reacher numeric,
  channel_base_minutes numeric,
  channel_base_n int,
  peer_n int,
  rating_rank int,
  minutes_rank int,
  top_peer_channel text,
  top_peer_program text,
  top_peer_rating numeric,
  channel_avg_rating numeric,
  vs_channel numeric
)
language plpgsql
stable
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
with w as (
    select (p_to - (p_weeks * 7 - 1)) d0, p_to d1
  ), mine as (
    select m.*, (m.avg_minute_viewers::numeric * m.duration_min / nullif(m.reach_viewers, 0)) mpr
    from iptv_airing_metrics m, w
    where m.channel_group = 'own' and m.program_key = any (p_keys)
      and m.broadcast_date between w.d0 and w.d1
  ), base_rows as (
    select mi.*,
      bool_or(not mi.is_rerun_tag) over (partition by mi.channel_name, mi.target_kind) has_first
    from mine mi
  ), core as (
    select b.* from base_rows b where (not b.has_first) or (not b.is_rerun_tag)
  ), slot as (
    select c.channel_name, c.target_kind, mode() within group (order by c.slot_band) sb
    from core c group by c.channel_name, c.target_kind
  ), summary as (
    select b.channel_name, b.target_kind,
      count(*)::int n_all,
      (count(*) filter (where not b.is_rerun_tag))::int n_first
    from base_rows b group by b.channel_name, b.target_kind
  ), cagg as (
    select c.channel_name, c.target_kind,
      round(sum(c.rating * c.duration_min) / nullif(sum(c.duration_min) filter (where c.rating is not null), 0), 5) r,
      round(sum(c.reach_rate * c.duration_min) / nullif(sum(c.duration_min) filter (where c.reach_rate is not null), 0), 4) rr,
      round((percentile_cont(0.5) within group (order by c.mpr) filter (where c.mpr is not null))::numeric, 1) mpr
    from core c group by c.channel_name, c.target_kind
  ), chbase as (
    select s.channel_name, s.target_kind,
      round((percentile_cont(0.5) within group (order by (o.avg_minute_viewers::numeric * o.duration_min / nullif(o.reach_viewers, 0))))::numeric, 1) mpr,
      count(*)::int n
    from slot s
    join iptv_airing_metrics o on o.channel_name = s.channel_name and o.target_kind = s.target_kind and o.slot_band = s.sb
    cross join w
    where o.broadcast_date between w.d0 and w.d1 and not o.is_rerun_tag and o.duration_min >= 30
      and o.reach_viewers > 0 and not (o.program_key = any (p_keys))
    group by s.channel_name, s.target_kind
  ), chavg as (
    select s.channel_name, s.target_kind,
      round(sum(o.rating * o.duration_min) / nullif(sum(o.duration_min) filter (where o.rating is not null), 0), 5) r
    from summary s
    join iptv_airing_metrics o on o.channel_name = s.channel_name and o.target_kind = s.target_kind
    cross join w
    where o.broadcast_date between w.d0 and w.d1
    group by s.channel_name, s.target_kind
  ), peers_raw as (
    select c.channel_name, c.target_kind, o.channel_name pch, o.program_key pkey, min(o.program_name) pname,
      avg(o.rating) pr,
      percentile_cont(0.5) within group (order by (o.avg_minute_viewers::numeric * o.duration_min / nullif(o.reach_viewers, 0))) pm
    from core c
    join iptv_airing_metrics o on o.target_kind = c.target_kind and o.broadcast_date = c.broadcast_date
      and o.channel_group in ('comp', 'uhd') and not o.is_rerun_tag and o.duration_min >= 30
      and least(o.end_minute, c.end_minute) - greatest(o.start_minute, c.start_minute) >= 30
    where not c.is_rerun_tag
    group by c.channel_name, c.target_kind, o.channel_name, o.program_key
  ), myavg as (
    select c.channel_name, c.target_kind, avg(c.rating) r,
      percentile_cont(0.5) within group (order by c.mpr) m
    from core c where not c.is_rerun_tag
    group by c.channel_name, c.target_kind
  ), ranks as (
    select pr.channel_name, pr.target_kind, count(*)::int n,
      (1 + count(*) filter (where pr.pr > ma.r))::int rr,
      (1 + count(*) filter (where pr.pm > ma.m))::int mr
    from peers_raw pr join myavg ma using (channel_name, target_kind)
    group by pr.channel_name, pr.target_kind
  ), top1 as (
    select distinct on (pr.channel_name, pr.target_kind) pr.channel_name, pr.target_kind, pr.pch, pr.pname, round(pr.pr::numeric, 5) pr
    from peers_raw pr
    order by pr.channel_name, pr.target_kind, pr.pr desc nulls last
  ), lastd as (
    select a.channel_name, a.target_kind, max(a.broadcast_date) d
    from iptv_tvindex_airings a
    where a.channel_group = 'own'
    group by a.channel_name, a.target_kind
  )
  select sm.channel_name, sm.target_kind, w.d0, w.d1, ld.d,
    sm.n_all, sm.n_first, sl.sb,
    ca.r, ca.rr, ca.mpr,
    cb.mpr, coalesce(cb.n, 0),
    coalesce(rk.n, 0), rk.rr, rk.mr,
    t1.pch, t1.pname, t1.pr,
    cv.r,
    case when cv.r > 0 and ca.r is not null then round(ca.r / cv.r, 3) end
  from summary sm
  cross join w
  left join slot sl using (channel_name, target_kind)
  left join cagg ca using (channel_name, target_kind)
  left join chbase cb using (channel_name, target_kind)
  left join chavg cv using (channel_name, target_kind)
  left join ranks rk using (channel_name, target_kind)
  left join top1 t1 using (channel_name, target_kind)
  left join lastd ld using (channel_name, target_kind);
end;
$$;
