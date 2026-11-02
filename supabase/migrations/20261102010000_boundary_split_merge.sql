-- 닐슨 26:00(02시) 경계 분할 방영 합치기 — 구매 시뮬레이터·작품 식별 방영 수(2026-11-02, 사용자 지적).
--
-- 닐슨은 방송일을 02:00에서 잘라, 01:42~02:45에 방송한 한 편을 방송일 D "01:42:16~01:59:59"와 방송일 D+1 "02:00:00~02:45:43"
-- 두 행으로 준다(자사·경쟁채널 모두, 경쟁 개인2049 10/19~11/01 334쌍). 구매 시뮬레이터는 이 두 행을 각각 1회로 세고
-- 뒷조각을 02~05시 시간대 방영으로 따로 잡았다. 앱 코드(src/lib/broadcastTime/boundarySplit.ts)와 같은 규칙으로 SQL에서도 합친다.
--
-- 규칙(앱과 같음):
--  - 짝: 같은 프로그램(자사 program_id, 경쟁 채널+타깃+<본>·<재> 표시 뗀 이름), 앞 조각 D에 01:59:00~02:00:00 종료, 뒤 조각 D+1 02:00:00 시작.
--    회차·본방 표시가 둘 다 있는데 서로 다르면 합치지 않는다.
--  - 합친 방영: 방송일·시작 = 앞 조각, 시청률 = 조각 길이(초) 가중 평균. 뒤 조각 행은 뺀다.
--  - 누수 차단: 뒤 조각은 조회 끝날(p_to) 안에서만 찾는다(기준일 다음 날 자료를 쓰지 않음 — 기준일의 앞 조각은 앞 조각 값 그대로).
--    조회 첫날의 뒤 조각은 전날 시작한 방영이라 뺀다.
--  - 행 수가 많은 경쟁 표(연 약 22만 행/타깃)는 짝 후보(02:00 시작·01:59~02:00 종료)만 따로 읽어 짝을 찾는다.
--
-- 바꾸는 함수: get_purchase_sim_inputs, get_purchase_sim_inputs_multi, get_purchase_sim_competition, get_purchase_channel_avg,
-- refresh_program_identity(방영 수). 그 밖의 계산 내용은 그대로다.

-- 앞 조각 길이(초). 01:59:59 종료는 마지막 1초를 포함한다(앱 tailSeconds와 같음).
create or replace function split_tail_seconds(p_start time, p_end time)
returns numeric
language sql
immutable
as $$
  select mod((extract(epoch from p_end) - extract(epoch from p_start))::numeric + 86400, 86400)
         + case when p_end < time '02:00:00' then 1 else 0 end
$$;

-- 자사 방영(합친 뒤). program_id가 없는 행(채널 단위 행)은 그대로 지나간다.
create or replace function purchase_own_airings(p_channel uuid, p_target uuid, p_skyuhd boolean, p_from date, p_to date)
returns table (air_date date, air_start time, air_rating numeric, air_program_id uuid)
language sql
stable
set search_path = public
as $$
  with base as (
    select x.id, x.broadcast_date, x.start_time, x.end_time, x.rating::numeric as rating, x.program_id, x.is_first_run, x.episode_number
    from ratings x
    where x.channel_id = p_channel
      and ((p_skyuhd and x.target_id is null and x.source_type = 'skyuhd')
        or (not p_skyuhd and x.target_id = p_target and x.source_type = 'nielsen_daily'))
      and x.broadcast_date between p_from - 1 and p_to
      and x.rating is not null
  ),
  pairs as (
    select distinct on (t.id) t.id as tail_id, h.id as head_id,
           split_tail_seconds(t.start_time, t.end_time) as wt,
           (extract(epoch from h.end_time) - extract(epoch from h.start_time))::numeric as wh,
           h.rating as rh
    from base t
    join base h
      on h.program_id = t.program_id
     and h.broadcast_date = t.broadcast_date + 1
     and h.start_time = time '02:00:00'
     and h.end_time > time '02:00:00'
     and not (t.is_first_run is not null and h.is_first_run is not null and t.is_first_run <> h.is_first_run)
     and not (t.episode_number is not null and h.episode_number is not null and t.episode_number <> h.episode_number)
    where t.program_id is not null
      and t.end_time between time '01:59:00' and time '02:00:00'
      and t.start_time <> time '02:00:00'
    order by t.id, h.id
  )
  select b.broadcast_date,
         b.start_time,
         case when p.tail_id is null then b.rating else (b.rating * p.wt + p.rh * p.wh) / nullif(p.wt + p.wh, 0) end,
         b.program_id
  from base b
  left join pairs p on p.tail_id = b.id
  where b.broadcast_date >= p_from
    and not exists (select 1 from pairs q where q.head_id = b.id)
$$;

-- 경쟁채널 방영(합친 뒤). 이름은 앞 조각 것(앞 조각에 <본>·<재> 표시가 없으면 뒤 조각 것).
create or replace function purchase_comp_airings(p_label text, p_from date, p_to date)
returns table (air_channel text, air_date date, air_start time, air_rating numeric, air_norm_name text, air_program_name text)
language sql
stable
set search_path = public
as $$
  with tails as (
    select c.id, c.competitor_name, c.broadcast_date, c.start_time, c.end_time, c.program_name,
           regexp_replace(c.program_name, '<[^>]*>', '', 'g') as bare
    from competitor_program_target_ratings c
    where c.target_label = p_label
      and c.broadcast_date between p_from - 1 and p_to
      and c.rating is not null
      and c.end_time between time '01:59:00' and time '02:00:00'
      and c.start_time <> time '02:00:00'
  ),
  heads as (
    select c.id, c.competitor_name, c.broadcast_date, c.start_time, c.end_time, c.program_name, c.rating::numeric as rating,
           regexp_replace(c.program_name, '<[^>]*>', '', 'g') as bare
    from competitor_program_target_ratings c
    where c.target_label = p_label
      and c.broadcast_date between p_from and p_to
      and c.rating is not null
      and c.start_time = time '02:00:00'
      and c.end_time > time '02:00:00'
  ),
  pairs as (
    select distinct on (t.id) t.id as tail_id, h.id as head_id,
           split_tail_seconds(t.start_time, t.end_time) as wt,
           (extract(epoch from h.end_time) - extract(epoch from h.start_time))::numeric as wh,
           h.rating as rh,
           case when t.program_name ~ '<(본|재)>' then t.program_name else h.program_name end as pname
    from tails t
    join heads h
      on h.competitor_name = t.competitor_name
     and h.bare = t.bare
     and h.broadcast_date = t.broadcast_date + 1
     and not (t.program_name ~ '<본>' and h.program_name ~ '<재>')
     and not (t.program_name ~ '<재>' and h.program_name ~ '<본>')
    order by t.id, h.id
  )
  select c.competitor_name,
         c.broadcast_date,
         c.start_time,
         case when p.tail_id is null then c.rating::numeric else (c.rating::numeric * p.wt + p.rh * p.wh) / nullif(p.wt + p.wh, 0) end,
         c.norm_program_name,
         coalesce(p.pname, c.program_name)
  from competitor_program_target_ratings c
  left join pairs p on p.tail_id = c.id
  where c.target_label = p_label
    and c.broadcast_date between p_from and p_to
    and c.rating is not null
    and not exists (select 1 from pairs q where q.head_id = c.id)
$$;

-- ── 구매 시뮬레이터 입력(단건) — 20261010010000 그대로, 방영 원천만 합친 함수로 ──
create or replace function get_purchase_sim_inputs(
  p_group_keys text[],
  p_own_channel_code text,
  p_target text,
  p_as_of date,
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
    select c.air_channel as ch, c.air_date as d, purchase_slot(c.air_date, c.air_start) as slot,
           c.air_rating as r, upper(c.air_norm_name) as k, (c.air_program_name like '%<재>%') as jae
    from purchase_comp_airings(v_comp_label, v_from, p_as_of) c
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
    select a.air_date as d, purchase_slot(a.air_date, a.air_start) as slot, a.air_rating as r,
           purchase_norm_key(pr.canonical_name) as k
    from purchase_own_airings(v_own_ch, v_own_tid, p_own_channel_code = 'SKYUHD', v_from, p_as_of) a
    join programs pr on pr.id = a.air_program_id
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

-- ── 구매 시뮬레이터 입력(백테스트 배치) — 20261002070000 그대로, 방영 원천만 합친 함수로 ──
create or replace function get_purchase_sim_inputs_multi(
  p_groups jsonb,
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
    select c.air_channel as ch, c.air_date as d, purchase_slot(c.air_date, c.air_start) as slot,
           c.air_rating as r, upper(c.air_norm_name) as k, (c.air_program_name like '%<재>%') as jae
    from purchase_comp_airings(v_comp_label, v_from, p_as_of) c
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
    select a.air_date as d, purchase_slot(a.air_date, a.air_start) as slot, a.air_rating as r,
           purchase_norm_key(pr.canonical_name) as k
    from purchase_own_airings(v_own_ch, v_own_tid, false, v_from, p_as_of) a
    join programs pr on pr.id = a.air_program_id
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

-- ── 같은 요일·시간대 경쟁 프로그램 — 20261002040000 그대로, 방영 원천만 합친 함수로 ──
create or replace function get_purchase_sim_competition(
  p_isodow int,
  p_start_hour int,
  p_target text,
  p_as_of date,
  p_window_days int default 91,
  p_limit int default 8
)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_label text;
  v_out jsonb;
begin
  v_label := case p_target when 'A2049' then '개인2049' when 'HH' then '유료방송가구' end;
  select coalesce(jsonb_agg(t order by t.avg_rating desc), '[]'::jsonb) into v_out
  from (
    select c.air_channel as ch,
           regexp_replace(c.air_program_name, '<[^>]*>', '', 'g') as program,
           round(avg(c.air_rating)::numeric, 5) as avg_rating,
           count(*)::int as n
    from purchase_comp_airings(v_label, p_as_of - p_window_days + 1, p_as_of) c
    where extract(isodow from c.air_date)::int = p_isodow
      and (case when extract(hour from c.air_start)::int < 2 then extract(hour from c.air_start)::int + 24 else extract(hour from c.air_start)::int end) = p_start_hour
    group by c.air_channel, regexp_replace(c.air_program_name, '<[^>]*>', '', 'g')
    having count(*) >= 2
    order by avg(c.air_rating) desc
    limit greatest(p_limit, 1)
  ) t;
  return v_out;
end;
$$;

-- ── 채널 1년 평균(편성 단위 단순 평균) — 20261010020000 그대로, 방영 원천만 합친 함수로 ──
create or replace function get_purchase_channel_avg(p_own_channel_code text, p_target text, p_as_of date, p_days int default 365)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_ch uuid;
  v_tid uuid;
  v_label text;
  v_avg numeric;
  v_n int;
begin
  v_label := case p_target when 'A2049' then '수도권 2049' when 'HH' then '전국 유료가구' end;
  select ch.id into v_ch from channels ch where ch.code = p_own_channel_code;
  select tg.id into v_tid from targets tg where tg.label = v_label;
  select avg(a.air_rating), count(*) into v_avg, v_n
  from purchase_own_airings(v_ch, v_tid, p_own_channel_code = 'SKYUHD', p_as_of - p_days + 1, p_as_of) a;
  return jsonb_build_object('avg', v_avg, 'n', v_n);
end;
$$;

-- ── 작품 식별 방영 수 — 20261022020000 그대로, 26:00 뒤 조각(전날 시작한 방영의 이어짐)은 세지 않음 ──
create or replace function refresh_program_identity()
returns jsonb
language plpgsql
set statement_timeout = '300s'
as $$
declare
  v_asof date;
  v_rows int;
begin
  select max(r.broadcast_date) into v_asof from ratings r where r.source_type = 'nielsen_daily';

  create temporary table if not exists tmp_identity_stats (k text, disp text, own_chans text[], comp_chans text[], n_total int, n_91 int, d0 date, d1 date) on commit delete rows;
  insert into tmp_identity_stats
  with comp as (
    select upper(c.norm_program_name) as k,
           mode() within group (order by regexp_replace(c.program_name, '<[^>]*>', '', 'g')) as disp,
           array_agg(distinct c.competitor_name) as chans,
           count(*)::int as n_total,
           count(*) filter (where c.broadcast_date > v_asof - 91)::int as n_91,
           min(c.broadcast_date) as d0,
           max(c.broadcast_date) as d1
    from competitor_program_target_ratings c
    where c.target_label = '개인2049'
      and not (c.start_time = time '02:00:00' and exists (
        select 1 from competitor_program_target_ratings t
        where t.broadcast_date = c.broadcast_date - 1
          and t.competitor_name = c.competitor_name
          and t.target_label = c.target_label
          and t.end_time between time '01:59:00' and time '02:00:00'
          and regexp_replace(t.program_name, '<[^>]*>', '', 'g') = regexp_replace(c.program_name, '<[^>]*>', '', 'g')))
    group by upper(c.norm_program_name)
  ),
  own as (
    select purchase_norm_key(p.canonical_name) as k,
           (array_agg(p.canonical_name order by length(p.canonical_name) desc))[1] as disp,
           array_agg(distinct ch.code) as chans,
           sum(s.n)::int as n_total,
           sum(s.n91)::int as n_91,
           min(s.d0) as d0,
           max(s.d1) as d1
    from programs p
    join channels ch on ch.id = p.channel_id
    join lateral (
      select count(distinct (r.broadcast_date, r.start_time))::int as n,
             count(distinct (r.broadcast_date, r.start_time)) filter (where r.broadcast_date > v_asof - 91)::int as n91,
             min(r.broadcast_date) as d0,
             max(r.broadcast_date) as d1
      from ratings r
      where r.program_id = p.id and r.source_type = 'nielsen_daily'
        and not (r.start_time = time '02:00:00' and exists (
          select 1 from ratings t
          where t.program_id = r.program_id
            and t.source_type = 'nielsen_daily'
            and t.broadcast_date = r.broadcast_date - 1
            and t.end_time between time '01:59:00' and time '02:00:00'))
    ) s on s.n > 0
    group by purchase_norm_key(p.canonical_name)
  )
  select coalesce(o.k, c.k) as k,
         coalesce(o.disp, c.disp) as disp,
         coalesce(o.chans, '{}'::text[]) as own_chans,
         coalesce(c.chans, '{}'::text[]) as comp_chans,
         coalesce(o.n_total, 0) + coalesce(c.n_total, 0) as n_total,
         coalesce(o.n_91, 0) + coalesce(c.n_91, 0) as n_91,
         least(o.d0, c.d0) as d0,
         greatest(o.d1, c.d1) as d1
  from own o
  full outer join comp c on c.k = o.k
  where coalesce(o.k, c.k) <> '';

  delete from program_identity where true;
  insert into program_identity (key, display_name, jamo_key, group_key, own_channels, comp_channels, airings_total, airings_91d, first_date, last_date, is_special)
  select s.k, s.disp, purchase_hangul_jamo(s.k),
         coalesce((select a.group_key from program_alias a where a.alias_key = s.k and a.status = 'confirmed'), s.k),
         s.own_chans, s.comp_chans, s.n_total, s.n_91, s.d0, s.d1,
         s.k ~ '(스페셜|특집|특별판|몰아보기|하이라이트|베스트|SPECIAL)'
  from tmp_identity_stats s;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('identity_rows', v_rows, 'as_of', v_asof);
end;
$$;
