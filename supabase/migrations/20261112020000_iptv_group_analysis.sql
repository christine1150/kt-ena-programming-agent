-- 자사×비교군 분석 드라마군 단계(docs/iptv/ALL_CHANNELS_ANALYSIS_PLAN.md) — 사용자 지시 2026-11-10 "드라마군 분석".
-- skyUHD P1~P5 연구용 SQL 을 군 정의표(iptv_peer_groups)를 받는 DB 함수로 옮긴다(원칙 1). IPTV 는 보조 자료.
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 실행.
--
-- ① iptv_group_period: 채널 × 기간(월·연) 시청률·도달률·방영 분과 군 안 순위(P5). 순위는 방영 3회 이상 채널끼리.
-- ② iptv_group_slotmap: 채널 × 요일(0=월…6=일) × 8대 시간대 평균 시청률, 군 안 순위, 채널 평균 대비 지수, 칸 1위 작품(시청 규모)(P3).
-- ③ iptv_group_scorecard: 채널 안 프로그램 성적표(P1)·재방 내성(P2).
--    평균 대비 = 그 작품이 나간 칸(같은 채널·요일·시간대)의 다른 작품 시청률 가중 평균 대비 배수(작품 자신은 기준에서 뺀다).
--    보정 = (배수 × 방영 수 + 1 × 5) ÷ (방영 수 + 5): 표본이 적으면 1(평균)쪽으로 당긴다.
--    본방·재방은 TV INDEX 의 재방 표기(is_rerun_tag) 기준이며 채널 첫 방송을 뜻하지 않는다.

create or replace function iptv_group_period(p_group text, p_target text, p_from date, p_to date, p_unit text default 'month')
returns table (
  channel_name text, role text, period text, airings int, airing_minutes bigint,
  avg_rating numeric, avg_reach_rate numeric, rating_rank int, channels_ranked int
)
language sql stable security definer set search_path = public
as $$
  with b as (
    select m.channel_name cn, g.role rl,
      case when p_unit = 'year' then to_char(m.broadcast_date, 'YYYY') else to_char(m.broadcast_date, 'YYYY-MM') end per,
      m.duration_min dm, m.rating, m.reach_rate
    from iptv_airing_metrics m
    join iptv_peer_groups g on g.group_key = p_group and g.iptv_channel_name = m.channel_name
    where m.target_kind = p_target and m.broadcast_date between p_from and p_to and m.duration_min > 0
  ), a as (
    select cn, rl, per, count(*)::int n, sum(dm)::bigint mins,
      round(sum(rating * dm) / nullif(sum(dm) filter (where rating is not null), 0), 6) r,
      round(sum(reach_rate * dm) / nullif(sum(dm) filter (where reach_rate is not null), 0), 4) rr
    from b group by cn, rl, per
  )
  select cn, rl, per, n, mins, r, rr,
    (case when n >= 3 and r is not null then rank() over (partition by per order by r desc) end)::int,
    (count(*) filter (where n >= 3 and r is not null) over (partition by per))::int
  from a;
$$;
revoke all on function iptv_group_period(text, text, date, date, text) from public, anon, authenticated;

create or replace function iptv_group_slotmap(p_group text, p_target text, p_from date, p_to date)
returns table (
  channel_name text, role text, dow int, slot_band text, airings int, airing_minutes bigint,
  avg_rating numeric, cell_rank int, cells_ranked int, channel_index numeric,
  top_program text, top_program_rating numeric
)
language sql stable security definer set search_path = public
as $$
  with b as (
    select m.channel_name cn, g.role rl, m.dow, m.slot_band sb, m.program_key pk, m.program_name pn, m.duration_min dm, m.rating
    from iptv_airing_metrics m
    join iptv_peer_groups g on g.group_key = p_group and g.iptv_channel_name = m.channel_name
    where m.target_kind = p_target and m.broadcast_date between p_from and p_to and m.duration_min > 0 and m.rating is not null
  ), cell as (
    select cn, rl, dow, sb, count(*)::int n, sum(dm)::bigint mins, round(sum(rating * dm) / sum(dm), 6) r
    from b group by cn, rl, dow, sb
  ), chavg as (
    select cn, sum(rating * dm) / sum(dm) r from b group by cn
  ), ranked as (
    select c.*,
      (case when c.n >= 3 then rank() over (partition by c.dow, c.sb order by c.r desc) end)::int rk,
      (count(*) filter (where c.n >= 3) over (partition by c.dow, c.sb))::int cr
    from cell c
  ), prog as (
    select cn, dow, sb, pk, min(pn) pn, sum(rating * dm) vol, round(sum(rating * dm) / sum(dm), 6) pr,
      row_number() over (partition by cn, dow, sb order by sum(rating * dm) desc) rn
    from b group by cn, dow, sb, pk
  )
  select r.cn, r.rl, r.dow, r.sb, r.n, r.mins, r.r, r.rk, r.cr,
    round(r.r / nullif(ca.r, 0), 3), p.pn, p.pr
  from ranked r
  join chavg ca on ca.cn = r.cn
  left join prog p on p.cn = r.cn and p.dow = r.dow and p.sb = r.sb and p.rn = 1;
$$;
revoke all on function iptv_group_slotmap(text, text, date, date) from public, anon, authenticated;

create or replace function iptv_group_scorecard(p_group text, p_target text, p_channel text, p_from date, p_to date, p_min_airings int default 8)
returns table (
  program_key text, program_name text, airings int, first_run_airings int, rerun_airings int,
  airing_minutes bigint, avg_rating numeric, avg_reach_rate numeric, scale numeric,
  vs_slot numeric, vs_slot_adjusted numeric, vs_slot_first_run numeric, vs_slot_rerun numeric,
  main_slot text, first_date date, last_date date
)
language sql stable security definer set search_path = public
as $$
  with b as (
    select m.program_key pk, m.program_name pn, m.dow, m.slot_band sb, m.duration_min dm, m.rating, m.reach_rate,
      m.is_rerun_tag rr, m.broadcast_date d
    from iptv_airing_metrics m
    join iptv_peer_groups g on g.group_key = p_group and g.iptv_channel_name = m.channel_name
    where m.channel_name = p_channel and m.target_kind = p_target
      and m.broadcast_date between p_from and p_to and m.duration_min > 0 and m.rating is not null
  ), cell as (
    select dow, sb, sum(rating * dm) s, sum(dm) dsum, count(*) n from b group by dow, sb
  ), pc as (
    select pk, dow, sb, rr, sum(rating * dm) sp, sum(dm) dp, count(*) np from b group by pk, dow, sb, rr
  ), pcall as (
    select pk, dow, sb, sum(sp) sp, sum(dp) dp from pc group by pk, dow, sb
  ), exp_cell as (
    -- 칸 기준: 작품 자신을 뺀 같은 칸 평균(다른 방영이 3건 미만인 칸은 제외)
    select pa.pk, pa.dow, pa.sb, (c.s - pa.sp) / nullif(c.dsum - pa.dp, 0) base, (c.n - (select sum(np) from pc x where x.pk = pa.pk and x.dow = pa.dow and x.sb = pa.sb)) other_n
    from pcall pa join cell c using (dow, sb)
  ), ratio_all as (
    select pc.pk,
      sum(pc.sp) filter (where e.other_n >= 3 and e.base > 0) act,
      sum(e.base * pc.dp) filter (where e.other_n >= 3 and e.base > 0) expd,
      sum(pc.sp) filter (where e.other_n >= 3 and e.base > 0 and not pc.rr) act_f,
      sum(e.base * pc.dp) filter (where e.other_n >= 3 and e.base > 0 and not pc.rr) exp_f,
      sum(pc.sp) filter (where e.other_n >= 3 and e.base > 0 and pc.rr) act_r,
      sum(e.base * pc.dp) filter (where e.other_n >= 3 and e.base > 0 and pc.rr) exp_r
    from pc join exp_cell e on e.pk = pc.pk and e.dow = pc.dow and e.sb = pc.sb
    group by pc.pk
  ), agg as (
    select pk, min(pn) pn, count(*)::int n, (count(*) filter (where not rr))::int nf, (count(*) filter (where rr))::int nr,
      sum(dm)::bigint mins,
      round(sum(rating * dm) / sum(dm), 6) r,
      round(sum(reach_rate * dm) / nullif(sum(dm) filter (where reach_rate is not null), 0), 4) rch,
      round(sum(rating * dm), 2) sc,
      min(d) d0, max(d) d1
    from b group by pk
  ), mainslot as (
    select pk, (mode() within group (order by dow * 10 + (case sb when '02-05' then 1 when '05-08' then 2 when '08-11' then 3 when '11-14' then 4 when '14-17' then 5 when '17-20' then 6 when '20-23' then 7 else 8 end))) code
    from b group by pk
  )
  select a.pk, a.pn, a.n, a.nf, a.nr, a.mins, a.r, a.rch, a.sc,
    round(ra.act / nullif(ra.expd, 0), 3),
    round((ra.act / nullif(ra.expd, 0) * a.n + 5) / (a.n + 5), 3),
    round(ra.act_f / nullif(ra.exp_f, 0), 3),
    round(ra.act_r / nullif(ra.exp_r, 0), 3),
    (array['월','화','수','목','금','토','일'])[(ms.code / 10) + 1] || ' ' ||
      (array['02-05','05-08','08-11','11-14','14-17','17-20','20-23','23-02'])[(ms.code % 10)],
    a.d0, a.d1
  from agg a
  left join ratio_all ra on ra.pk = a.pk
  left join mainslot ms on ms.pk = a.pk
  where a.n >= p_min_airings
  order by a.sc desc;
$$;
revoke all on function iptv_group_scorecard(text, text, text, date, date, int) from public, anon, authenticated;
