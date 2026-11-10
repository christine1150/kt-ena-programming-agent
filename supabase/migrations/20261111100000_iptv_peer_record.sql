-- IPTV 활용 3단계 5순위 — 구매 검토의 "다른 채널 IPTV 성적" 블록 계산(2026-11-11 사용자 승인 "5순위 진행").
-- 원칙 1: 지표는 DB 에서 계산하고 화면은 읽기만 한다. IPTV 는 보조 자료(청약·공식 KPI 기준은 닐슨).
-- 한 작품(IPTV program_key 목록)이 최근 p_weeks 주 동안 다른 채널(경쟁·UHD)에서 거둔 성적을 채널 × 타깃별로 요약하고,
-- 같은 채널·타깃·같은 주 시간대(8대)에서 다른 프로그램 본방의 평소 시청률과 견준 배수를 함께 낸다(슬롯 대비 성과).
--  · 본방이 있으면 본방만, 재방뿐이면 전체 방영으로 요약한다(has_first).
--  · base_rating = 같은 채널·타깃·시간대 다른 프로그램 본방(30분 이상) 방영 길이 가중 평균 시청률, base_n = 그 방영 건수.
--  · ratio = avg_rating / base_rating (base_n 이 작으면 화면에서 '표본 적음'으로 보조 표기).
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 실행.

create or replace function iptv_peer_record(p_keys text[], p_to date, p_weeks int default 52)
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
  ratio numeric
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
    join iptv_airing_metrics o on o.channel_name = s.channel_name and o.target_kind = s.target_kind and o.slot_band = s.sb
    cross join w
    where o.broadcast_date between w.d0 and w.d1 and not o.is_rerun_tag and o.duration_min >= 30
      and not (o.program_key = any (p_keys))
    group by s.channel_name, s.target_kind
  )
  select sm.channel_name, sm.channel_group, sm.target_kind, w.d0, w.d1, sm.fd, sm.ld,
    sm.n_all, sm.n_first, sl.sb,
    ca.r, ca.rr, ca.mpr,
    cb.br, coalesce(cb.n, 0),
    case when cb.br > 0 and ca.r is not null then round(ca.r / cb.br, 3) end
  from summary sm
  cross join w
  left join slot sl using (channel_name, target_kind)
  left join cagg ca using (channel_name, target_kind)
  left join chbase cb using (channel_name, target_kind);
$$;

revoke all on function iptv_peer_record(text[], date, int) from public, anon, authenticated;

-- 이름 대응용: 기간 안에 다른 채널(경쟁·UHD)에 방영된 IPTV 프로그램 키 목록
create or replace function iptv_peer_program_keys(p_from date, p_to date)
returns table (program_key text)
language sql stable security definer set search_path = public
as $$
  select distinct a.program_key from iptv_tvindex_airings a
  where a.channel_group in ('comp', 'uhd') and a.broadcast_date between p_from and p_to;
$$;
revoke all on function iptv_peer_program_keys(date, date) from public, anon, authenticated;
