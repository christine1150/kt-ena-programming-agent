-- 백테스트용 배치 입력: 같은 기준일(as_of)·자사 채널·타깃에서 여러 프로그램 그룹의 입력을 한 번에 만든다.
-- get_purchase_sim_inputs 와 같은 구조(단일 윈도우)를 그룹 키별 객체로 돌려준다. 경쟁 데이터 스캔은 한 번만 하고
-- 채널×슬롯 합계는 그룹과 무관하므로 한 번만 집계한 뒤 "그 프로그램이 방영된 채널"로 걸러 붙인다.
-- 누수 차단은 단건 RPC 와 같다: broadcast_date <= p_as_of 를 SQL 에서 강제.
create or replace function get_purchase_sim_inputs_multi(
  p_groups jsonb,               -- [{ "group_key": "...", "members": ["키1","키2"] }, ...]
  p_own_channel_code text,
  p_target text,
  p_as_of date,
  p_window int default 91
)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_comp_label text;
  v_own_label text;
  v_own_ch uuid;
  v_own_tid uuid;
  v_from date;
  v_out jsonb;
begin
  v_comp_label := case p_target when 'A2049' then '개인2049' when 'HH' then '유료방송가구' end;
  v_own_label := case p_target when 'A2049' then '수도권 2049' when 'HH' then '전국 유료가구' end;
  if v_comp_label is null then
    raise exception 'unsupported target %', p_target;
  end if;
  select ch.id into v_own_ch from channels ch where ch.code = p_own_channel_code;
  select tg.id into v_own_tid from targets tg where tg.label = v_own_label;
  v_from := p_as_of - p_window + 1;

  with g as (
    select e->>'group_key' as gk, upper(m) as k
    from jsonb_array_elements(p_groups) e, jsonb_array_elements_text(e->'members') m
  ),
  gkeys as (select distinct gk from g),
  comp as materialized (
    select c.competitor_name as ch, c.broadcast_date as d, purchase_slot(c.broadcast_date, c.start_time) as slot,
           c.rating as r, upper(c.norm_program_name) as k, (c.program_name like '%<재>%') as jae
    from competitor_program_target_ratings c
    where c.target_label = v_comp_label
      and c.broadcast_date between v_from and p_as_of
      and c.rating is not null
  ),
  chan_tot as (
    select cp.ch, cp.slot, sum(cp.r) as s, count(*) as n from comp cp group by cp.ch, cp.slot
  ),
  prog_slots as (
    select g.gk, cp.ch, cp.slot, sum(cp.r) as ps_sum, count(*) as ps_n, count(*) filter (where cp.jae) as ps_jae,
           min(cp.d) as first_d, max(cp.d) as last_d
    from comp cp join g on g.k = cp.k
    group by g.gk, cp.ch, cp.slot
  ),
  prog_ch as (select distinct ps.gk, ps.ch from prog_slots ps),
  own as (
    select r.broadcast_date as d, purchase_slot(r.broadcast_date, r.start_time) as slot, r.rating as r,
           purchase_norm_key(pr.canonical_name) as k
    from ratings r
    join programs pr on pr.id = r.program_id
    where r.channel_id = v_own_ch
      and r.target_id = v_own_tid
      and r.source_type = 'nielsen_daily'
      and r.broadcast_date between v_from and p_as_of
      and r.rating is not null
  ),
  own_chan as (select o.slot, sum(o.r) as s, count(*) as n from own o group by o.slot),
  own_prog as (
    select g.gk, o.slot, sum(o.r) as s, count(*) as n, min(o.d) as first_d, max(o.d) as last_d
    from own o join g on g.k = o.k
    group by g.gk, o.slot
  ),
  mx as (
    select (select max(c2.broadcast_date) from competitor_program_target_ratings c2 where c2.broadcast_date <= p_as_of) as comp_max,
           (select max(o2.d) from own o2) as own_max
  )
  select coalesce(jsonb_object_agg(k.gk, jsonb_build_object(
    'as_of', p_as_of,
    'windows', jsonb_build_array(p_window),
    'target', p_target,
    'own_channel', p_own_channel_code,
    'peer_chan_slots', coalesce((select jsonb_agg(jsonb_build_object('w', p_window, 'ch', ct.ch, 'slot', ct.slot, 'sum', ct.s, 'n', ct.n))
                                 from prog_ch pc join chan_tot ct on ct.ch = pc.ch where pc.gk = k.gk), '[]'::jsonb),
    'peer_prog_slots', coalesce((select jsonb_agg(jsonb_build_object('w', p_window, 'ch', ps.ch, 'slot', ps.slot, 'sum', ps.ps_sum, 'n', ps.ps_n, 'jae', ps.ps_jae, 'first', ps.first_d, 'last', ps.last_d))
                                 from prog_slots ps where ps.gk = k.gk), '[]'::jsonb),
    'own_chan_slots', coalesce((select jsonb_agg(jsonb_build_object('w', p_window, 'slot', oc.slot, 'sum', oc.s, 'n', oc.n)) from own_chan oc), '[]'::jsonb),
    'own_prog_slots', coalesce((select jsonb_agg(jsonb_build_object('w', p_window, 'slot', op.slot, 'sum', op.s, 'n', op.n, 'first', op.first_d, 'last', op.last_d))
                                from own_prog op where op.gk = k.gk), '[]'::jsonb),
    'comp_max_date', (select comp_max from mx),
    'own_max_date', (select own_max from mx)
  )), '{}'::jsonb)
  into v_out
  from gkeys k;
  return v_out;
end;
$$;
