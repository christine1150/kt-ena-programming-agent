-- IPTV 셋톱 블록에 '채널 평균 대비' 추가(2026-11-11 사용자 지시: 일반 프로그램 성과처럼 채널 평균 대비 %와 색깔).
-- 원칙 1: 비율은 DB 에서 계산하고 화면은 읽기만 한다. IPTV 는 보조 자료(청약·공식 KPI 기준은 닐슨).
--  · channel_avg_rating = 같은 기간 그 채널·타깃의 전체 방영(본방·재방 모든 프로그램)의 시청률을 방영 길이로 가중한 평균
--    (프로그램 성과의 '채널 평균'과 같은 취지 — 닐슨은 채널 하루 시청률 일평균, IPTV 는 방영 건 기준)
--  · vs_channel = 작품 평균 시청률 ÷ channel_avg_rating (1 = 채널 평균과 같음)
--  · iptv_program_block: 기간 = 조회 창(p_weeks 주) 전체. iptv_peer_record: 기간 = 그 채널에서 이 작품이 방영된 첫~마지막 방영일(방영 3회 이상 채널만).
-- 반환 열이 늘어 함수를 지우고 다시 만든다(기존 열·순서는 그대로, 끝에 열 추가). 기존 파일은 수정하지 않는다. service_role 만 실행.

drop function if exists iptv_program_block(text[], date, int);
create function iptv_program_block(p_keys text[], p_to date, p_weeks int default 12)
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
language sql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function iptv_program_block(text[], date, int) from public, anon, authenticated;

drop function if exists iptv_peer_record(text[], date, int);
create function iptv_peer_record(p_keys text[], p_to date, p_weeks int default 52)
returns table (
  channel_name text,
  channel_group text,
  target_kind text,
  window_from date,
  window_to date,
  first_date date,
  last_date date,
  airings int,
  first_run_airings int,
  main_slot_band text,
  avg_rating numeric,
  avg_reach_rate numeric,
  minutes_per_reacher numeric,
  base_rating numeric,
  base_n int,
  ratio numeric,
  channel_avg_rating numeric,
  vs_channel numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select (p_to - (p_weeks * 7 - 1)) d0, p_to d1
  ), mine as (
    select m.*, (m.avg_minute_viewers::numeric * m.duration_min / nullif(m.reach_viewers, 0)) mpr
    from iptv_airing_metrics m, w
    where m.channel_group in ('comp', 'uhd') and m.program_key = any (p_keys)
      and m.broadcast_date between w.d0 and w.d1
  ), base_rows as (
    select mi.*, bool_or(not mi.is_rerun_tag) over (partition by mi.channel_name, mi.target_kind) has_first
    from mine mi
  ), core as (
    select b.* from base_rows b where (not b.has_first) or (not b.is_rerun_tag)
  ), summary as (
    select b.channel_name, b.channel_group, b.target_kind,
      count(*)::int n_all,
      (count(*) filter (where not b.is_rerun_tag))::int n_first,
      min(b.broadcast_date) fd, max(b.broadcast_date) ld
    from base_rows b group by b.channel_name, b.channel_group, b.target_kind
  ), slot as (
    select c.channel_name, c.target_kind, mode() within group (order by c.slot_band) sb
    from core c group by c.channel_name, c.target_kind
  ), cagg as (
    select c.channel_name, c.target_kind,
      round(sum(c.rating * c.duration_min) / nullif(sum(c.duration_min) filter (where c.rating is not null), 0), 5) r,
      round(sum(c.reach_rate * c.duration_min) / nullif(sum(c.duration_min) filter (where c.reach_rate is not null), 0), 4) rr,
      round((percentile_cont(0.5) within group (order by c.mpr) filter (where c.mpr is not null))::numeric, 1) mpr
    from core c group by c.channel_name, c.target_kind
  ), chbase as (
    select s.channel_name, s.target_kind,
      round(sum(o.rating * o.duration_min) / nullif(sum(o.duration_min) filter (where o.rating is not null), 0), 5) br,
      (count(*) filter (where o.rating is not null))::int n
    from slot s
    join summary sm2 on sm2.channel_name = s.channel_name and sm2.target_kind = s.target_kind and sm2.n_all >= 3
    join iptv_airing_metrics o on o.channel_name = s.channel_name and o.target_kind = s.target_kind and o.slot_band = s.sb
    cross join w
    where o.broadcast_date between sm2.fd and sm2.ld and not o.is_rerun_tag and o.duration_min >= 30
      and not (o.program_key = any (p_keys))
    group by s.channel_name, s.target_kind
  ), chavg as (
    select sm2.channel_name, sm2.target_kind,
      round(sum(o.rating * o.duration_min) / nullif(sum(o.duration_min) filter (where o.rating is not null), 0), 5) r
    from summary sm2
    join iptv_airing_metrics o on o.channel_name = sm2.channel_name and o.target_kind = sm2.target_kind
    where sm2.n_all >= 3 and o.broadcast_date between sm2.fd and sm2.ld
    group by sm2.channel_name, sm2.target_kind
  )
  select sm.channel_name, sm.channel_group, sm.target_kind, w.d0, w.d1, sm.fd, sm.ld,
    sm.n_all, sm.n_first, sl.sb,
    ca.r, ca.rr, ca.mpr,
    cb.br, coalesce(cb.n, 0),
    case when cb.br > 0 and ca.r is not null then round(ca.r / cb.br, 3) end,
    cv.r,
    case when cv.r > 0 and ca.r is not null then round(ca.r / cv.r, 3) end
  from summary sm
  cross join w
  left join slot sl using (channel_name, target_kind)
  left join cagg ca using (channel_name, target_kind)
  left join chbase cb using (channel_name, target_kind)
  left join chavg cv using (channel_name, target_kind);
$$;

revoke all on function iptv_peer_record(text[], date, int) from public, anon, authenticated;
