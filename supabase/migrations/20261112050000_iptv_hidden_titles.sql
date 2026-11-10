-- 전 채널 분석 P2 — 숨은 작품·재방 내성(닐슨 붙이기). 2026-11-10 사용자 요청 "밤 사이 차례대로".
-- 원칙 1: DB 계산. IPTV 는 보조 자료이고 닐슨 값은 따로 둔다(섞지 않음). 신규 추가(멱등), service_role 만 실행.
-- 짝 지어진 방영 건(iptv_nielsen_pairs: 시작 ±3분) 안에서 작품의 IPTV·닐슨 평균과 채널 평균 대비 배수를 같은 표본으로 비교한다.
--   iptv_rel / nielsen_rel = 작품 평균 ÷ 같은 채널·같은 짝 표본의 전체 평균. nielsen_zero_rate = 닐슨 시청률 0인 방영 비율.
--   verdict: hidden = IPTV 배수 1.2 이상이면서 (닐슨 배수 1 미만 또는 닐슨 0 비율 50% 이상),
--            agree_high = 두 자료 모두 1.2 이상, agree_low = 두 자료 모두 0.8 미만, thin = 짝 표본 p_min_pairs 미만, else mixed.
--   rerun_tolerance(스코어카드의 본방·재방 평균 대비): tolerant = 재방 평균 대비가 1.0 이상이고 본방의 90% 이상,
--            weak = 재방이 본방의 70% 미만, unknown = 본방·재방 한쪽이 없음, else partial.
-- 닐슨 자료가 있는 채널(자사 전부, 경쟁은 닐슨 경쟁 시트에 있는 채널)에서만 값이 나온다.
create or replace function iptv_group_hidden_titles(p_group text, p_target text, p_channel text, p_from date, p_to date, p_min_pairs int default 8)
returns table (
  program_key text, program_name text, airings int, pairs int, iptv_avg numeric, nielsen_avg numeric,
  nielsen_zero_rate numeric, iptv_rel numeric, nielsen_rel numeric, vs_slot_adjusted numeric,
  vs_slot_first_run numeric, vs_slot_rerun numeric, verdict text, rerun_tolerance text
)
language sql stable security definer set search_path = public
as $$
  with pr as (
    select p.program_key pk, p.iptv_rating ir, p.nielsen_rating nr
    from iptv_nielsen_pairs p
    join iptv_peer_groups g on g.group_key = p_group and g.iptv_channel_name = p.channel_name
    where p.channel_name = p_channel and p.target_kind = p_target and p.broadcast_date between p_from and p_to
      and p.iptv_rating is not null and p.nielsen_rating is not null
  ), cha as (
    select avg(ir) i, avg(nr) n from pr
  ), a as (
    select pk, count(*)::int n, round(avg(ir), 5) i, round(avg(nr), 5) nn,
      round((count(*) filter (where nr = 0))::numeric / count(*), 3) z
    from pr group by pk
  ), sc as (
    select * from iptv_group_scorecard(p_group, p_target, p_channel, p_from, p_to, 1)
  )
  select s.program_key, s.program_name, s.airings, coalesce(a.n, 0), a.i, a.nn, a.z,
    round(a.i / nullif(c.i, 0), 3), round(a.nn / nullif(c.n, 0), 3),
    s.vs_slot_adjusted, s.vs_slot_first_run, s.vs_slot_rerun,
    case
      when a.n is null or a.n < p_min_pairs then 'thin'
      when a.i / nullif(c.i, 0) >= 1.2 and (a.nn / nullif(c.n, 0) < 1 or a.z >= 0.5) then 'hidden'
      when a.i / nullif(c.i, 0) >= 1.2 and a.nn / nullif(c.n, 0) >= 1.2 then 'agree_high'
      when a.i / nullif(c.i, 0) < 0.8 and a.nn / nullif(c.n, 0) < 0.8 then 'agree_low'
      else 'mixed' end,
    case
      when s.vs_slot_first_run is null or s.vs_slot_rerun is null then 'unknown'
      when s.vs_slot_rerun >= 1.0 and s.vs_slot_rerun >= 0.9 * s.vs_slot_first_run then 'tolerant'
      when s.vs_slot_rerun < 0.7 * s.vs_slot_first_run then 'weak'
      else 'partial' end
  from sc s
  left join a on a.pk = s.program_key
  cross join cha c
  where s.airings >= 8
  order by s.airings desc;
$$;
revoke all on function iptv_group_hidden_titles(text, text, text, date, date, int) from public, anon, authenticated;
