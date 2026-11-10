-- 자사 7개 채널 × 비교군 분석 0단계(docs/iptv/ALL_CHANNELS_ANALYSIS_PLAN.md) — 사용자 승인 2026-11-10 "0부터 시작".
-- 원칙 1: 지표는 DB 에서 계산. IPTV 는 보조 자료(공식 KPI 는 닐슨, 닐슨과 섞지 않는다).
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 실행.
--
-- ① iptv_peer_groups: 비교군 정의표. 한 채널이 여러 군에 들어갈 수 있다(예: ENA 는 드라마군과 지상파·종편 동시간대군 모두).
--    role: own = 자사, peer = 같은 장르 비교 채널, registered = 사이트에 경쟁채널로 등록했거나 사용자가 지정한 채널.
-- ② iptv_group_benchmark: iptv_uhd_benchmark 를 군·타깃을 받도록 일반화. 군 안의 모든 채널을 같은 기준으로
--    최근 p_weeks 주 · 직전 p_weeks 주 비교한다. 순위는 해당 시간대 방영 3회 이상인 채널끼리.

create table if not exists iptv_peer_groups (
  group_key text not null,
  group_label text not null,
  iptv_channel_name text not null references iptv_channel_map (iptv_channel_name),
  role text not null check (role in ('own', 'peer', 'registered')),
  note text,
  primary key (group_key, iptv_channel_name)
);
comment on table iptv_peer_groups is '자사×비교군 분석의 비교군 정의. 한 채널이 여러 군에 들어갈 수 있다. IPTV 에 없는 채널은 넣지 않는다(닐슨만 있는 채널은 별도 단계).';
alter table iptv_peer_groups enable row level security;

-- 국내 드라마군: 자사 ENA·ENA Drama·ONCE, 비교는 IPTV 자료가 있는 채널(KBS드라마·tvN DRAMA 등은 IPTV 없음)
insert into iptv_peer_groups (group_key, group_label, iptv_channel_name, role, note) values
  ('drama', '국내 드라마군', 'ENA', 'own', null),
  ('drama', '국내 드라마군', 'ENA Drama', 'own', null),
  ('drama', '국내 드라마군', 'ONCE', 'own', null),
  ('drama', '국내 드라마군', 'SBS Plus', 'peer', null),
  ('drama', '국내 드라마군', 'Dramacube', 'peer', null),
  ('drama', '국내 드라마군', 'Dramax', 'peer', null),
  ('drama', '국내 드라마군', 'MBC 드라마넷', 'peer', '가구만'),
  ('drama', '국내 드라마군', 'D-ONE', 'peer', '가구만'),
  ('drama', '국내 드라마군', 'EDGE TV', 'peer', '가구만'),
  ('drama', '국내 드라마군', '하이라이트 TV', 'peer', '가구만'),
  ('drama', '국내 드라마군', 'CNTV', 'peer', '가구만'),
  ('drama', '국내 드라마군', 'MBC ON', 'peer', '가구만'),
-- ENA 지상파·종편 동시간대군: 사이트에 등록된 ENA 경쟁채널 9개(전부 IPTV 가구·2049 있음)
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'ENA', 'own', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'JTBC', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'KBS1', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'KBS2', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'MBC', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'MBN', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'SBS', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'TV CHOSUN', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', 'tvN', 'registered', null),
  ('ena_slot', 'ENA 동시간대(지상파·종편)', '채널A', 'registered', null),
-- 예능·오락군: 자사 ENA Play·ENA Story, 비교는 IPTV 자료가 있는 10개(나머지 26개는 닐슨만)
  ('variety', '예능·오락군', 'ENA Play', 'own', null),
  ('variety', '예능·오락군', 'ENA Story', 'own', null),
  ('variety', '예능·오락군', 'tvN', 'peer', null),
  ('variety', '예능·오락군', 'MBC every1', 'peer', null),
  ('variety', '예능·오락군', 'tvN Story', 'peer', null),
  ('variety', '예능·오락군', '채널S', 'peer', null),
  ('variety', '예능·오락군', 'SBS FunE', 'peer', null),
  ('variety', '예능·오락군', 'JTBC2', 'peer', null),
  ('variety', '예능·오락군', 'tvN SHOW', 'peer', null),
  ('variety', '예능·오락군', 'E채널', 'peer', null),
  ('variety', '예능·오락군', 'KBS Joy', 'peer', '가구만'),
  ('variety', '예능·오락군', 'CMC TV', 'registered', 'ENA Story 등록 경쟁채널'),
-- 취미·레저군: 자사 OLIFE, 사용자 지정(2026-11-10) ONT·CMC TV + 여행·기행 결이 같은 UHD Dream·EBS·KBS1 참고
  ('hobby', '취미·레저군(OLIFE)', 'OLIFE', 'own', null),
  ('hobby', '취미·레저군(OLIFE)', 'ONT', 'registered', '사용자 지정, 가구만'),
  ('hobby', '취미·레저군(OLIFE)', 'CMC TV', 'registered', '사용자 지정'),
  ('hobby', '취미·레저군(OLIFE)', 'UHD Dream', 'peer', '여행·기행 참고'),
  ('hobby', '취미·레저군(OLIFE)', 'EBS', 'peer', '여행·기행 참고'),
  ('hobby', '취미·레저군(OLIFE)', 'KBS1', 'peer', '여행·기행 참고'),
-- UHD군: 완료된 skyUHD 분석과 같은 구성("SBS FIL UHD" = "SBS NEX", 사용자 확인 2026-11-10)
  ('uhd', 'UHD군', 'skyUHD', 'own', null),
  ('uhd', 'UHD군', 'Asia UHD', 'peer', null),
  ('uhd', 'UHD군', 'SBS NEX', 'peer', '표기 SBS FIL UHD 와 같은 채널'),
  ('uhd', 'UHD군', 'UHD Dream', 'peer', null),
  ('uhd', 'UHD군', 'UMAX', 'peer', null),
  ('uhd', 'UHD군', 'UXN', 'peer', null)
on conflict (group_key, iptv_channel_name) do update set
  group_label = excluded.group_label, role = excluded.role, note = excluded.note;

create or replace function iptv_group_benchmark(p_group text, p_target text, p_to date, p_weeks int default 12)
returns table (
  channel_name text,
  role text,
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
    select m.channel_name, g.role, m.slot_band, m.broadcast_date, m.duration_min, m.rating, m.reach_rate,
      (m.avg_minute_viewers::numeric * m.duration_min / nullif(m.reach_viewers, 0)) mpr,
      (m.broadcast_date >= w.d0) cur
    from iptv_airing_metrics m
    join iptv_peer_groups g on g.group_key = p_group and g.iptv_channel_name = m.channel_name
    cross join w
    where m.target_kind = p_target
      and m.broadcast_date between w.pd0 and w.d1 and m.duration_min > 0
  ), expanded as (
    select b.*, b.slot_band sb from base b
    union all
    select b.*, 'all' sb from base b
  ), agg as (
    select e.channel_name, e.role, e.sb,
      (count(*) filter (where e.cur))::int n_cur,
      round(sum(e.rating * e.duration_min) filter (where e.cur) / nullif(sum(e.duration_min) filter (where e.cur and e.rating is not null), 0), 6) r_cur,
      round(sum(e.rating * e.duration_min) filter (where not e.cur) / nullif(sum(e.duration_min) filter (where not e.cur and e.rating is not null), 0), 6) r_prev,
      round(sum(e.reach_rate * e.duration_min) filter (where e.cur) / nullif(sum(e.duration_min) filter (where e.cur and e.reach_rate is not null), 0), 4) rr,
      round((percentile_cont(0.5) within group (order by e.mpr) filter (where e.cur and e.mpr is not null))::numeric, 1) mpr
    from expanded e
    group by e.channel_name, e.role, e.sb
  ), ranked as (
    select a.*,
      case when a.n_cur >= 3 and a.r_cur is not null then rank() over (partition by a.sb order by a.r_cur desc) end rk,
      count(*) filter (where a.n_cur >= 3 and a.r_cur is not null) over (partition by a.sb) cr
    from agg a
  )
  select r.channel_name, r.role, r.sb, w.d0, w.d1, r.n_cur, r.r_cur, r.r_prev, r.rr, r.mpr,
    r.rk::int, r.cr::int
  from ranked r cross join w
  where r.n_cur > 0;
$$;

revoke all on function iptv_group_benchmark(text, text, date, int) from public, anon, authenticated;
