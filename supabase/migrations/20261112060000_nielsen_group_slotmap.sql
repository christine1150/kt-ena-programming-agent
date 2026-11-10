-- 전 채널 분석 B단계 — IPTV 가 없는 비교 채널을 닐슨으로만 비교(2026-11-10 사용자 "밤 사이 자동 진행").
-- 원칙 1: DB 계산. 닐슨이 공식 기준이며 IPTV 값과 섞지 않는다. 신규 추가(멱등), service_role 만 실행.
-- 타깃(공식 기준): p2049 = 자사 '수도권 2049' ↔ 경쟁 '개인2049', household = 자사 '전국 유료가구' ↔ 경쟁 '유료방송가구'.
-- 한 채널이 두 타깃 중 하나만 가진 경우 그 타깃에만 나타난다.
-- 경쟁 채널 닐슨 시트는 우리 채널마다 같은 행이 반복되므로 (채널·방송일·시작)으로 한 건만 남긴다.
-- 시간대는 IPTV 와 같은 8대 시간대·요일(방송일 기준)이며 02시 미만 시작은 +24시간으로 본다.

create table if not exists nielsen_peer_groups (
  group_key text not null,
  nielsen_source text not null check (nielsen_source in ('own', 'comp')),
  nielsen_name text not null,
  role text not null check (role in ('own', 'peer', 'registered')),
  note text,
  primary key (group_key, nielsen_source, nielsen_name)
);
comment on table nielsen_peer_groups is '닐슨 기반 비교군(IPTV 유무와 무관). nielsen_name: own=channels.code, comp=competitor_program_ratings.competitor_name. 자료 기간은 채널마다 다르다.';
alter table nielsen_peer_groups enable row level security;

insert into nielsen_peer_groups (group_key, nielsen_source, nielsen_name, role, note) values
  ('drama', 'own', 'ENA', 'own', null), ('drama', 'own', 'ENA_DRAMA', 'own', null), ('drama', 'own', 'ONCE', 'own', null),
  ('drama', 'comp', 'KBS드라마', 'peer', '8/23까지'), ('drama', 'comp', 'tvN DRAMA', 'peer', '8/23까지'), ('drama', 'comp', 'KBS Story', 'peer', '9/16부터'),
  ('drama', 'comp', 'DRAMAcube', 'peer', null), ('drama', 'comp', 'Dramax', 'peer', null), ('drama', 'comp', 'MBC드라마넷', 'peer', null),
  ('drama', 'comp', 'SBS Plus', 'peer', null), ('drama', 'comp', 'EDGETV', 'peer', null), ('drama', 'comp', 'CNTV', 'peer', null),
  ('drama', 'comp', 'D-ONE', 'peer', null), ('drama', 'comp', 'MBC ON', 'peer', null),
  ('ena_slot', 'own', 'ENA', 'own', null), ('ena_slot', 'comp', 'JTBC', 'registered', null), ('ena_slot', 'comp', 'KBS1', 'registered', null),
  ('ena_slot', 'comp', 'KBS2', 'registered', null), ('ena_slot', 'comp', 'MBC', 'registered', null), ('ena_slot', 'comp', 'MBN', 'registered', null),
  ('ena_slot', 'comp', 'SBS', 'registered', null), ('ena_slot', 'comp', 'TV CHOSUN', 'registered', null), ('ena_slot', 'comp', 'tvN', 'registered', null),
  ('ena_slot', 'comp', '채널A', 'registered', null),
  ('variety', 'own', 'ENA_PLAY', 'own', null), ('variety', 'own', 'ENA_STORY', 'own', null),
  ('variety', 'comp', 'tvN', 'peer', null), ('variety', 'comp', 'MBC every1', 'peer', null), ('variety', 'comp', 'tvN STORY', 'peer', null),
  ('variety', 'comp', '채널S', 'peer', null), ('variety', 'comp', 'SBS funE', 'peer', null), ('variety', 'comp', 'JTBC2', 'peer', null),
  ('variety', 'comp', 'tvN SHOW', 'peer', null), ('variety', 'comp', 'E채널', 'peer', null), ('variety', 'comp', 'KBS JOY', 'peer', null),
  ('variety', 'comp', 'CMCTV', 'registered', '9/13부터'), ('variety', 'comp', 'theLIFE', 'peer', null), ('variety', 'comp', 'CH view', 'peer', null),
  ('variety', 'comp', 'K STAR', 'peer', null), ('variety', 'comp', '코미디TV', 'peer', null), ('variety', 'comp', 'Mnet', 'peer', null),
  ('variety', 'comp', 'GTV', 'peer', '9/13부터'), ('variety', 'comp', 'FUN TV', 'peer', '9/13부터'),
  ('hobby', 'own', 'OLIFE', 'own', null), ('hobby', 'comp', 'ONT', 'registered', '1~2월만'), ('hobby', 'comp', 'CMCTV', 'registered', '9/13부터'),
  ('hobby', 'comp', 'KBS1', 'peer', null)
on conflict (group_key, nielsen_source, nielsen_name) do update set role = excluded.role, note = excluded.note;

create or replace function nielsen_group_rows(p_group text, p_kind text, p_from date, p_to date)
returns table (channel_label text, role text, broadcast_date date, dow int, slot_band text, duration_min int, rating numeric, program_name text)
language sql stable security definer set search_path = public
as $$
  with own_rows as (
    select g.nielsen_name lbl, g.role rl, r.broadcast_date d, p.canonical_name pn, r.rating,
      (extract(hour from r.start_time) * 60 + extract(minute from r.start_time) + case when extract(hour from r.start_time) < 2 then 1440 else 0 end)::int sm,
      (extract(hour from r.end_time) * 60 + extract(minute from r.end_time) + case when extract(hour from r.end_time) < 2 or r.end_time < r.start_time then 1440 else 0 end)::int em
    from nielsen_peer_groups g
    join channels c on g.nielsen_source = 'own' and c.code = g.nielsen_name
    join ratings r on r.channel_id = c.id and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
    join targets t on t.id = r.target_id and t.label = case p_kind when 'p2049' then '수도권 2049' else '전국 유료가구' end
    left join programs p on p.id = r.program_id
    where g.group_key = p_group and r.broadcast_date between p_from and p_to
  ), comp_rows as (
    select distinct on (cr.competitor_name, cr.broadcast_date, cr.start_time)
      g.nielsen_name lbl, g.role rl, cr.broadcast_date d, cr.program_name pn, cr.rating,
      (extract(hour from cr.start_time) * 60 + extract(minute from cr.start_time) + case when extract(hour from cr.start_time) < 2 then 1440 else 0 end)::int sm,
      (extract(hour from cr.end_time) * 60 + extract(minute from cr.end_time) + case when extract(hour from cr.end_time) < 2 or cr.end_time < cr.start_time then 1440 else 0 end)::int em
    from nielsen_peer_groups g
    join competitor_program_ratings cr on g.nielsen_source = 'comp' and cr.competitor_name = g.nielsen_name
      and cr.target_label = case p_kind when 'p2049' then '개인2049' else '유료방송가구' end
    where g.group_key = p_group and cr.broadcast_date between p_from and p_to and cr.start_time is not null
    order by cr.competitor_name, cr.broadcast_date, cr.start_time
  ), u as (
    select * from own_rows union all select * from comp_rows
  )
  select lbl, rl, d, (extract(isodow from d)::int - 1),
    case when sm >= 1380 then '23-02' when sm < 300 then '02-05' when sm < 480 then '05-08' when sm < 660 then '08-11'
      when sm < 840 then '11-14' when sm < 1020 then '14-17' when sm < 1200 then '17-20' else '20-23' end,
    (em - sm)::int, rating, pn
  from u where em > sm and rating is not null;
$$;
revoke all on function nielsen_group_rows(text, text, date, date) from public, anon, authenticated;

create or replace function nielsen_group_slotmap(p_group text, p_kind text, p_from date, p_to date)
returns table (channel_label text, role text, dow int, slot_band text, airings int, avg_rating numeric, cell_rank int, cells_ranked int, channel_index numeric, top_program text)
language sql stable security definer set search_path = public
as $$
  with b as (select * from nielsen_group_rows(p_group, p_kind, p_from, p_to)),
  cell as (
    select channel_label cl, role rl, dow, slot_band sb, count(*)::int n, round(sum(rating * duration_min) / nullif(sum(duration_min), 0), 6) r
    from b group by 1, 2, 3, 4
  ), chavg as (select channel_label cl, sum(rating * duration_min) / nullif(sum(duration_min), 0) r from b group by 1),
  ranked as (
    select c.*, (case when c.n >= 3 then rank() over (partition by c.dow, c.sb order by c.r desc) end)::int rk,
      (count(*) filter (where c.n >= 3) over (partition by c.dow, c.sb))::int cr
    from cell c
  ), prog as (
    select channel_label cl, dow, slot_band sb, program_name pn, sum(rating * duration_min) vol,
      row_number() over (partition by channel_label, dow, slot_band order by sum(rating * duration_min) desc) rn
    from b group by channel_label, dow, slot_band, program_name
  )
  select r.cl, r.rl, r.dow, r.sb, r.n, r.r, r.rk, r.cr, round(r.r / nullif(ca.r, 0), 3), p.pn
  from ranked r join chavg ca on ca.cl = r.cl
  left join prog p on p.cl = r.cl and p.dow = r.dow and p.sb = r.sb and p.rn = 1;
$$;
revoke all on function nielsen_group_slotmap(text, text, date, date) from public, anon, authenticated;
