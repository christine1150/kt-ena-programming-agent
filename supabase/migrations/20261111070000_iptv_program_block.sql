-- IPTV 활용 3단계 3순위 — 프로그램 성과·주요 콘텐츠 리뷰의 "IPTV 셋톱 보조 지표" 블록 계산(2026-11-11 사용자 승인 "3순위 진행").
-- 원칙 1: 지표는 DB 에서 계산하고 화면은 읽기만 한다. IPTV 는 보조 자료(청약·공식 KPI 기준은 닐슨).
-- 한 작품(IPTV program_key 목록)의 최근 p_weeks 주 자사 방영을 채널 × 타깃별로 요약한다.
--  · minutes_per_reacher = 1분 시청자수 × 방영 분 ÷ 도달자 = 들어온 시청자 1인당 평균 시청 분(본방 방영 중앙값)
--  · channel_base_minutes = 같은 채널·타깃·같은 주 시간대(8대)에서 다른 프로그램 본방의 1인당 시청 분 중앙값(채널 평소)
--  · 동시간대 경쟁작 = 이 작품 본방과 같은 방송일에 30분 이상 겹친 경쟁·UHD 채널 본방(30분 이상) 프로그램 — 프로그램별로 평균한 뒤
--    이 작품보다 높은 경쟁작 수 + 1 = 순위(시청률·1인당 시청 분 각각). 경쟁작이 없으면 순위 null.
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 실행.

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
  top_peer_rating numeric
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
    -- 본방이 있으면 본방, 없으면 전체 방영으로 요약(재방 전용 편성 대비)
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
    t1.pch, t1.pname, t1.pr
  from summary sm
  cross join w
  left join slot sl using (channel_name, target_kind)
  left join cagg ca using (channel_name, target_kind)
  left join chbase cb using (channel_name, target_kind)
  left join ranks rk using (channel_name, target_kind)
  left join top1 t1 using (channel_name, target_kind)
  left join lastd ld using (channel_name, target_kind);
$$;

revoke all on function iptv_program_block(text[], date, int) from public, anon, authenticated;

-- 이름 대응용: 기간 안에 자사 채널에 방영된 IPTV 프로그램 키 목록
create or replace function iptv_own_program_keys(p_from date, p_to date)
returns table (program_key text)
language sql stable security definer set search_path = public
as $$
  select distinct a.program_key from iptv_tvindex_airings a
  where a.channel_group = 'own' and a.broadcast_date between p_from and p_to;
$$;
revoke all on function iptv_own_program_keys(date, date) from public, anon, authenticated;
