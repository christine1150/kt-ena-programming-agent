-- skyUHD 는 타깃 없이(target_id 비움) source_type=skyuhd 로 적재되므로 자사 조회 조건을 채널별로 분기한다(가구 타깃 전용).
create or replace function get_purchase_sim_inputs(
  p_group_keys text[],          -- 같은 콘텐츠로 묶인 프로그램 정규화 키(대문자, purchase_norm_key)
  p_own_channel_code text,      -- 구매 후 편성할 자사 채널 코드 (ENA_PLAY 등)
  p_target text,                -- 'A2049'(경쟁 개인2049 ↔ 자사 수도권 2049) | 'HH'(경쟁 유료방송가구 ↔ 자사 전국 유료가구)
  p_as_of date,                 -- 이 날짜(포함) 이전 데이터만 사용
  p_windows int[] default array[28, 84, 182, 364]
)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '60s'
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
  select p_as_of - max(w) + 1 into v_from from unnest(p_windows) as w;

  with wins as (
    select w from unnest(p_windows) as w
  ),
  comp as (
    select c.competitor_name as ch, c.broadcast_date as d, purchase_slot(c.broadcast_date, c.start_time) as slot,
           c.rating as r, upper(c.norm_program_name) as k, (c.program_name like '%<재>%') as jae
    from competitor_program_target_ratings c
    where c.target_label = v_comp_label
      and c.broadcast_date between v_from and p_as_of
      and c.rating is not null
  ),
  prog_ch as (
    select distinct cp.ch from comp cp where cp.k = any (p_group_keys)
  ),
  chan_slots as (
    select ww.w, cp.ch, cp.slot, sum(cp.r) as cs_sum, count(*) as cs_n
    from comp cp
    join prog_ch pc on pc.ch = cp.ch
    join wins ww on cp.d >= p_as_of - ww.w + 1
    group by ww.w, cp.ch, cp.slot
  ),
  prog_slots as (
    select ww.w, cp.ch, cp.slot, sum(cp.r) as ps_sum, count(*) as ps_n, count(*) filter (where cp.jae) as ps_jae,
           min(cp.d) as first_d, max(cp.d) as last_d
    from comp cp
    join wins ww on cp.d >= p_as_of - ww.w + 1
    where cp.k = any (p_group_keys)
    group by ww.w, cp.ch, cp.slot
  ),
  own as (
    select r.broadcast_date as d, purchase_slot(r.broadcast_date, r.start_time) as slot, r.rating as r,
           purchase_norm_key(pr.canonical_name) as k
    from ratings r
    join programs pr on pr.id = r.program_id
    where r.channel_id = v_own_ch
      and ((p_own_channel_code = 'SKYUHD' and r.target_id is null and r.source_type = 'skyuhd')
        or (p_own_channel_code <> 'SKYUHD' and r.target_id = v_own_tid and r.source_type = 'nielsen_daily'))
      and r.broadcast_date between v_from and p_as_of
      and r.rating is not null
  ),
  own_chan_slots as (
    select ww.w, o.slot, sum(o.r) as cs_sum, count(*) as cs_n
    from own o join wins ww on o.d >= p_as_of - ww.w + 1
    group by ww.w, o.slot
  ),
  own_prog_slots as (
    select ww.w, o.slot, sum(o.r) as ps_sum, count(*) as ps_n, min(o.d) as first_d, max(o.d) as last_d
    from own o join wins ww on o.d >= p_as_of - ww.w + 1
    where o.k = any (p_group_keys)
    group by ww.w, o.slot
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'windows', to_jsonb(p_windows),
    'target', p_target,
    'own_channel', p_own_channel_code,
    'peer_chan_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'ch', t.ch, 'slot', t.slot, 'sum', t.cs_sum, 'n', t.cs_n)) from chan_slots t), '[]'::jsonb),
    'peer_prog_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'ch', t.ch, 'slot', t.slot, 'sum', t.ps_sum, 'n', t.ps_n, 'jae', t.ps_jae, 'first', t.first_d, 'last', t.last_d)) from prog_slots t), '[]'::jsonb),
    'own_chan_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'slot', t.slot, 'sum', t.cs_sum, 'n', t.cs_n)) from own_chan_slots t), '[]'::jsonb),
    'own_prog_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'slot', t.slot, 'sum', t.ps_sum, 'n', t.ps_n, 'first', t.first_d, 'last', t.last_d)) from own_prog_slots t), '[]'::jsonb),
    'comp_max_date', (select max(c2.broadcast_date) from competitor_program_target_ratings c2 where c2.broadcast_date <= p_as_of),
    'own_max_date', (select max(o2.d) from own o2)
  ) into v_out;
  return v_out;
end;
$$;
