-- IPTV 활용 3단계 6순위 — skyUHD·UHD 벤치마크(D3)와 시간대 경쟁 지도(D1) 계산(2026-11-11 사용자 승인 "6순위 진행").
-- 원칙 1: 지표는 DB 에서 계산하고 화면은 읽기만 한다. IPTV 는 보조 자료(청약·공식 KPI 기준은 닐슨).
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 실행.
--
-- ① iptv_uhd_benchmark: skyUHD 와 UHD 5개 채널(가구)을 같은 기준으로 최근 p_weeks 주 · 직전 p_weeks 주 비교.
--    slot_band 'all' = 전체, 나머지는 방영 시작 시각의 8대 시간대. 시청률·도달률은 방영 길이 가중 평균,
--    minutes_per_reacher = 1분 시청자 × 방영 분 ÷ 도달자의 중앙값. 순위는 6개 채널 안(해당 시간대 방영 3회 이상인 채널끼리).
-- ② iptv_slot_rivals: 한 채널(IPTV 채널명)의 요일 묶음(평일·토·일) × 시간대에서 우리 시청률·관측 채널 안 순위·최강 경쟁 채널.
--    경쟁은 경쟁·UHD 채널만 센다(다른 자사 채널은 같은 회사라 경쟁에서 뺀다). 방영은 시작 시각이 속한 시간대·요일에 넣는다.
--    비중(share_of_observed)은 관측된 채널 합계 대비이며 시청 점유율이 아니다(IPTV 에 없는 채널이 있다).

create or replace function iptv_uhd_benchmark(p_to date, p_weeks int default 12)
returns table (
  channel_name text,
  is_sky boolean,
  slot_band text,
  window_from date,
  window_to date,
  airings int,
  avg_rating numeric,
  prev_avg_rating numeric,
  avg_reach_rate numeric,
  minutes_per_reacher numeric,
  rating_rank int,
  channels_ranked int
)
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select (p_to - (p_weeks * 7 - 1)) d0, p_to d1, (p_to - (p_weeks * 14 - 1)) pd0, (p_to - p_weeks * 7) pd1
  ), base as (
    select m.channel_name, (m.channel_name = 'skyUHD') is_sky, m.slot_band, m.broadcast_date, m.duration_min, m.rating, m.reach_rate,
      (m.avg_minute_viewers::numeric * m.duration_min / nullif(m.reach_viewers, 0)) mpr,
      (m.broadcast_date >= w.d0) cur
    from iptv_airing_metrics m, w
    where m.target_kind = 'household' and (m.channel_group = 'uhd' or m.channel_name = 'skyUHD')
      and m.broadcast_date between w.pd0 and w.d1 and m.duration_min > 0
  ), expanded as (
    select b.*, b.slot_band sb from base b
    union all
    select b.*, 'all' sb from base b
  ), agg as (
    select e.channel_name, e.is_sky, e.sb,
      (count(*) filter (where e.cur))::int n_cur,
      round(sum(e.rating * e.duration_min) filter (where e.cur) / nullif(sum(e.duration_min) filter (where e.cur and e.rating is not null), 0), 6) r_cur,
      round(sum(e.rating * e.duration_min) filter (where not e.cur) / nullif(sum(e.duration_min) filter (where not e.cur and e.rating is not null), 0), 6) r_prev,
      round(sum(e.reach_rate * e.duration_min) filter (where e.cur) / nullif(sum(e.duration_min) filter (where e.cur and e.reach_rate is not null), 0), 4) rr,
      round((percentile_cont(0.5) within group (order by e.mpr) filter (where e.cur and e.mpr is not null))::numeric, 1) mpr
    from expanded e
    group by e.channel_name, e.is_sky, e.sb
  ), ranked as (
    select a.*,
      case when a.n_cur >= 3 and a.r_cur is not null then rank() over (partition by a.sb order by a.r_cur desc) end rk,
      count(*) filter (where a.n_cur >= 3 and a.r_cur is not null) over (partition by a.sb) cr
    from agg a
  )
  select r.channel_name, r.is_sky, r.sb, w.d0, w.d1, r.n_cur, r.r_cur, r.r_prev, r.rr, r.mpr,
    r.rk::int, r.cr::int
  from ranked r cross join w
  where r.n_cur > 0;
$$;

revoke all on function iptv_uhd_benchmark(date, int) from public, anon, authenticated;

create or replace function iptv_slot_rivals(p_channel text, p_target text, p_to date, p_weeks int default 12)
returns table (
  dow_group text,
  slot_band text,
  window_from date,
  window_to date,
  own_airings int,
  own_rating numeric,
  observed_channels int,
  own_rank int,
  own_share numeric,
  top_rival_channel text,
  top_rival_group text,
  top_rival_rating numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select (p_to - (p_weeks * 7 - 1)) d0, p_to d1
  ), cells as (
    select m.channel_name, m.channel_group,
      case when m.dow <= 4 then 'weekday' when m.dow = 5 then 'sat' else 'sun' end dg,
      m.slot_band sb,
      count(*)::int n,
      sum(m.rating * m.duration_min) / nullif(sum(m.duration_min) filter (where m.rating is not null), 0) r
    from iptv_airing_metrics m, w
    where m.target_kind = p_target and m.broadcast_date between w.d0 and w.d1 and m.duration_min > 0
      and (m.channel_name = p_channel or m.channel_group in ('comp', 'uhd'))
    group by 1, 2, 3, 4
    having count(*) >= 3
  ), me as (
    select c.dg, c.sb, c.n, c.r from cells c where c.channel_name = p_channel
  ), rivals as (
    select c.dg, c.sb, c.channel_name, c.channel_group, c.r,
      row_number() over (partition by c.dg, c.sb order by c.r desc nulls last) rn
    from cells c where c.channel_name <> p_channel and c.r is not null
  ), obs as (
    select c.dg, c.sb,
      count(*) filter (where c.r is not null)::int n_obs,
      sum(c.r) sum_r,
      (count(*) filter (where c.r > (select me2.r from me me2 where me2.dg = c.dg and me2.sb = c.sb)))::int n_above
    from cells c
    group by c.dg, c.sb
  )
  select me.dg, me.sb, w.d0, w.d1, me.n, round(me.r, 6),
    o.n_obs, (o.n_above + 1)::int,
    round(me.r / nullif(o.sum_r, 0), 4),
    rv.channel_name, rv.channel_group, round(rv.r, 6)
  from me
  cross join w
  join obs o on o.dg = me.dg and o.sb = me.sb
  left join rivals rv on rv.dg = me.dg and rv.sb = me.sb and rv.rn = 1
  where me.r is not null;
$$;

revoke all on function iptv_slot_rivals(text, text, date, int) from public, anon, authenticated;
