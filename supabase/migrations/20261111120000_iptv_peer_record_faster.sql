-- IPTV 5순위 후속 — iptv_peer_record 속도 개선(2026-11-11). 같은 결과 형식, 평소(base) 계산만 가볍게 한다.
--  · 방영 3회 미만(화면에서 어차피 빼는 채널)은 평소를 계산하지 않는다.
--  · 평소는 이 작품이 그 채널에 방영된 기간(첫 방영일~마지막 방영일) 안의 같은 시간대 다른 프로그램 본방으로 본다 — 같은 시기 평소와 견주는 편이 더 공정하다.
-- 기존 함수 정의를 신규 마이그레이션에서 다시 정의하는 방식(기존 파일은 수정하지 않음, 멱등).

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
    join summary sm2 on sm2.channel_name = s.channel_name and sm2.target_kind = s.target_kind and sm2.n_all >= 3
    join iptv_airing_metrics o on o.channel_name = s.channel_name and o.target_kind = s.target_kind and o.slot_band = s.sb
    cross join w
    where o.broadcast_date between sm2.fd and sm2.ld and not o.is_rerun_tag and o.duration_min >= 30
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
