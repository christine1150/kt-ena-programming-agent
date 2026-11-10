-- IPTV 셋톱 자료 활용 계획(docs/iptv/IPTV_DATA_PLAN.md) 0·1단계 — 사용자 승인 2026-11-10 "0~2단계 시작".
-- 화면은 바꾸지 않는다. 기존 테이블·함수는 건드리지 않는 신규 추가만 하며 몇 번을 실행해도 같은 결과(멱등).
--  0단계: iptv_channel_map(IPTV ↔ 닐슨 채널명), iptv_nielsen_match(같은 방영 건 짝) + 다시 채우는 함수, iptv_coverage(자료 범위)
--  1단계: iptv_airing_metrics(방영 건 지표), iptv_program_summary·iptv_slot_competition(기간 함수), iptv_calibration(버전 있는 보정 계수)
-- 서버(service_role)만 접근하므로 테이블은 RLS 를 켜고 정책은 두지 않는다. 함수는 anon·authenticated 실행 권한을 거둔다.

-- ── 0-1. 채널 대응표 ────────────────────────────────────────────────
create table if not exists iptv_channel_map (
  iptv_channel_name text primary key,
  channel_group text not null check (channel_group in ('own', 'uhd', 'comp')),
  -- 자사: channels.code
  nielsen_channel_code text,
  -- 경쟁: competitor_program_ratings.competitor_name (닐슨 경쟁채널 시트 표기)
  nielsen_competitor_name text,
  note text
);
comment on table iptv_channel_map is 'IPTV(TV INDEX) 채널명 ↔ 닐슨 채널(자사 channels.code / 경쟁 competitor_name) 대응. 닐슨에 없는 채널은 둘 다 비움.';

insert into iptv_channel_map (iptv_channel_name, channel_group, nielsen_channel_code, nielsen_competitor_name, note) values
  ('ENA', 'own', 'ENA', null, null),
  ('ENA Drama', 'own', 'ENA_DRAMA', null, null),
  ('ENA Play', 'own', 'ENA_PLAY', null, null),
  ('ENA Story', 'own', 'ENA_STORY', null, null),
  ('OLIFE', 'own', 'OLIFE', null, null),
  ('ONCE', 'own', 'ONCE', null, null),
  ('skyUHD', 'own', 'SKYUHD', null, '닐슨 skyUHD 는 수기 파일(target_id 비움)이라 타깃 대응이 없어 짝짓기에서 뺀다'),
  ('Asia UHD', 'uhd', null, null, '닐슨 경쟁채널 자료에 없음'),
  ('SBS NEX', 'uhd', null, null, '닐슨 경쟁채널 자료에 없음'),
  ('UHD Dream', 'uhd', null, 'UHD Dream TV', null),
  ('UMAX', 'uhd', null, 'UMAX', null),
  ('UXN', 'uhd', null, null, '닐슨 경쟁채널 자료에 없음'),
  ('CMC TV', 'comp', null, 'CMCTV', null),
  ('CNTV', 'comp', null, 'CNTV', null),
  ('D-ONE', 'comp', null, 'D-ONE', null),
  ('Dramacube', 'comp', null, 'DRAMAcube', null),
  ('Dramax', 'comp', null, 'Dramax', null),
  ('EBS', 'comp', null, null, '닐슨 경쟁채널 자료에 없음'),
  ('EDGE TV', 'comp', null, 'EDGETV', null),
  ('E채널', 'comp', null, 'E채널', null),
  ('JTBC', 'comp', null, 'JTBC', null),
  ('KBS Joy', 'comp', null, 'KBS JOY', null),
  ('KBS1', 'comp', null, 'KBS1', null),
  ('KBS2', 'comp', null, 'KBS2', null),
  ('MBC', 'comp', null, 'MBC', null),
  ('MBC every1', 'comp', null, 'MBC every1', null),
  ('MBC ON', 'comp', null, 'MBC ON', null),
  ('MBC 드라마넷', 'comp', null, 'MBC드라마넷', null),
  ('ONT', 'comp', null, null, '닐슨 경쟁채널 자료에 없음'),
  ('SBS', 'comp', null, 'SBS', null),
  ('SBS FunE', 'comp', null, 'SBS funE', null),
  ('SBS Plus', 'comp', null, 'SBS Plus', null),
  ('tvN', 'comp', null, 'tvN', null),
  ('tvN Story', 'comp', null, 'tvN STORY', null),
  ('하이라이트 TV', 'comp', null, null, '닐슨 경쟁채널 자료에 없음')
on conflict (iptv_channel_name) do update set
  channel_group = excluded.channel_group,
  nielsen_channel_code = excluded.nielsen_channel_code,
  nielsen_competitor_name = excluded.nielsen_competitor_name,
  note = excluded.note;

-- ── 0-2. 닐슨 방영 건과의 짝 ─────────────────────────────────────────
-- IPTV 방영 건 하나에 같은 채널·타깃·방송일에서 시작 시각이 가장 가까운(±3분) 닐슨 방영 건 하나를 붙인다.
-- 타깃 대응: household ↔ 자사 '전국 유료가구' / 경쟁 '유료방송가구', p2049 ↔ 자사 '수도권 2049' / 경쟁 '개인2049'.
-- 방영 길이가 두 배 넘게 다르면(한쪽이 묶음·분할 방영) 짝으로 보지 않는다.
create table if not exists iptv_nielsen_match (
  channel_name text not null,
  target_kind text not null check (target_kind in ('household', 'p2049')),
  broadcast_date date not null,
  start_minute int not null,
  program_key text not null,
  nielsen_source text not null check (nielsen_source in ('own', 'comp')),
  nielsen_start_minute int not null,
  nielsen_end_minute int,
  nielsen_program_name text,
  nielsen_rating numeric,
  nielsen_share numeric,
  nielsen_reach numeric,
  start_gap int not null,
  refreshed_at timestamptz not null default now(),
  primary key (channel_name, target_kind, broadcast_date, start_minute, program_key)
);
create index if not exists idx_iptv_nielsen_match_date on iptv_nielsen_match (broadcast_date, target_kind);
comment on table iptv_nielsen_match is 'IPTV 방영 건 ↔ 닐슨 방영 건 짝(시작 ±3분, 길이 0.5~2배). refresh_iptv_nielsen_match(기간) 으로 다시 채운다.';

create or replace function refresh_iptv_nielsen_match(p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_m int;
begin
  delete from iptv_nielsen_match m where m.broadcast_date between p_from and p_to;

  -- 자사(닐슨 일일 파일 ratings, 프로그램 행만). 채널·타깃·방송일 동등 조인 뒤 시작 ±3분으로 거른다.
  insert into iptv_nielsen_match
    (channel_name, target_kind, broadcast_date, start_minute, program_key, nielsen_source,
     nielsen_start_minute, nielsen_end_minute, nielsen_program_name, nielsen_rating, nielsen_share, nielsen_reach, start_gap)
  with n as (
    select c.code, case t.label when '전국 유료가구' then 'household' else 'p2049' end tk, r.broadcast_date d,
      (extract(hour from r.start_time) * 60 + extract(minute from r.start_time)
        + case when extract(hour from r.start_time) < 2 then 1440 else 0 end)::int sm,
      (extract(hour from r.end_time) * 60 + extract(minute from r.end_time)
        + case when extract(hour from r.end_time) < 2 or r.end_time < r.start_time then 1440 else 0 end)::int em,
      p.name pname, r.rating, r.share, r.reach
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id and t.label in ('전국 유료가구', '수도권 2049')
    left join programs p on p.id = r.program_id
    where r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.broadcast_date between p_from and p_to
  )
  select distinct on (a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key)
    a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, 'own',
    n.sm, n.em, n.pname, n.rating, n.share, n.reach, abs(n.sm - a.start_minute)
  from iptv_tvindex_airings a
  join iptv_channel_map cm on cm.iptv_channel_name = a.channel_name and cm.channel_group = 'own' and cm.nielsen_channel_code is not null
  join n on n.code = cm.nielsen_channel_code and n.tk = a.target_kind and n.d = a.broadcast_date
    and abs(n.sm - a.start_minute) <= 3
  where a.broadcast_date between p_from and p_to
    and (n.em is null or (n.em - n.sm) between 0.5 * (a.end_minute - a.start_minute) and 2 * (a.end_minute - a.start_minute))
  order by a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, abs(n.sm - a.start_minute);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 경쟁(닐슨 경쟁채널 시트). 우리 채널 시트마다 같은 행이 반복되므로 distinct on 으로 가장 가까운 한 건만 남긴다.
  insert into iptv_nielsen_match
    (channel_name, target_kind, broadcast_date, start_minute, program_key, nielsen_source,
     nielsen_start_minute, nielsen_end_minute, nielsen_program_name, nielsen_rating, nielsen_share, nielsen_reach, start_gap)
  with n as (
    select x.competitor_name cn, case x.target_label when '유료방송가구' then 'household' else 'p2049' end tk, x.broadcast_date d,
      (extract(hour from x.start_time) * 60 + extract(minute from x.start_time)
        + case when extract(hour from x.start_time) < 2 then 1440 else 0 end)::int sm,
      (extract(hour from x.end_time) * 60 + extract(minute from x.end_time)
        + case when extract(hour from x.end_time) < 2 or x.end_time < x.start_time then 1440 else 0 end)::int em,
      x.program_name pname, x.rating, x.share
    from competitor_program_ratings x
    where x.target_label in ('유료방송가구', '개인2049') and x.start_time is not null
      and x.broadcast_date between p_from and p_to
  )
  select distinct on (a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key)
    a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, 'comp',
    n.sm, n.em, n.pname, n.rating, n.share, null, abs(n.sm - a.start_minute)
  from iptv_tvindex_airings a
  join iptv_channel_map cm on cm.iptv_channel_name = a.channel_name and cm.nielsen_competitor_name is not null
  join n on n.cn = cm.nielsen_competitor_name and n.tk = a.target_kind and n.d = a.broadcast_date
    and abs(n.sm - a.start_minute) <= 3
  where a.broadcast_date between p_from and p_to
    and (n.em is null or (n.em - n.sm) between 0.5 * (a.end_minute - a.start_minute) and 2 * (a.end_minute - a.start_minute))
  order by a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, abs(n.sm - a.start_minute);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  return v_n;
end;
$$;

-- 짝을 IPTV 값과 함께 읽는 뷰
create or replace view iptv_nielsen_pairs with (security_invoker = true) as
select a.channel_name, a.channel_group, a.target_kind, a.broadcast_date, a.start_minute, a.end_minute,
  a.program_name, a.program_key, a.is_rerun_tag,
  a.rating iptv_rating, a.reach_rate iptv_reach_rate, a.reach_viewers iptv_reach_viewers, a.avg_minute_viewers iptv_avg_minute_viewers,
  m.nielsen_source, m.nielsen_start_minute, m.nielsen_end_minute, m.nielsen_program_name,
  m.nielsen_rating, m.nielsen_share, m.nielsen_reach, m.start_gap
from iptv_nielsen_match m
join iptv_tvindex_airings a using (channel_name, target_kind, broadcast_date, start_minute, program_key);

-- ── 0-3. 자료 범위 ──────────────────────────────────────────────────
-- 화면이 "IPTV 자료 마지막 날짜"를 여기서 읽는다(계획 P2). own_common_end = 자사 채널·타깃 가운데 가장 이른 종료일.
create or replace view iptv_coverage with (security_invoker = true) as
select a.channel_name, a.channel_group, a.target_kind,
  min(a.broadcast_date) first_date, max(a.broadcast_date) last_date, count(*) airings,
  max(a.created_at) last_loaded_at,
  min(max(a.broadcast_date)) filter (where a.channel_group = 'own') over () own_common_end
from iptv_tvindex_airings a
group by a.channel_name, a.channel_group, a.target_kind;

-- ── 1-1. 방영 건 지표 ───────────────────────────────────────────────
-- 체류율 = 1분 시청자수 ÷ 도달자(들어온 사람이 평균적으로 프로그램의 몇 %를 봤나, 0~1).
-- dow 0=월 … 6=일(방송일 기준), slot_band = 2·3페이지와 같은 8대 시간대(02-05 … 23-02).
create or replace view iptv_airing_metrics with (security_invoker = true) as
select a.channel_name, a.channel_group, a.target_kind, a.broadcast_date, a.start_minute, a.end_minute,
  a.program_name, a.program_key, a.is_rerun_tag, a.rating, a.reach_viewers, a.avg_minute_viewers, a.reach_rate,
  a.end_minute - a.start_minute duration_min,
  case when a.reach_viewers > 0 then a.avg_minute_viewers::numeric / a.reach_viewers end stickiness,
  (extract(isodow from a.broadcast_date)::int - 1) dow,
  case
    when a.start_minute >= 1380 or a.start_minute < 120 then '23-02'
    when a.start_minute < 300 then '02-05'
    when a.start_minute < 480 then '05-08'
    when a.start_minute < 660 then '08-11'
    when a.start_minute < 840 then '11-14'
    when a.start_minute < 1020 then '14-17'
    when a.start_minute < 1200 then '17-20'
    else '20-23'
  end slot_band
from iptv_tvindex_airings a;

-- ── 1-2. 프로그램 요약(기간) ─────────────────────────────────────────
-- 시청률·도달률은 방영 길이 가중 평균, 체류율은 도달자 가중. 앞·뒤 절반 평균으로 추세를 본다.
create or replace function iptv_program_summary(p_from date, p_to date, p_target text, p_channel text default null)
returns table (
  channel_name text, channel_group text, program_key text, program_name text,
  airings int, tagged_rerun_airings int, first_date date, last_date date,
  avg_rating numeric, avg_reach_rate numeric, avg_stickiness numeric,
  rating_first_half numeric, rating_second_half numeric
)
language sql stable security definer set search_path = public
as $$
  with b as (
    select m.*, row_number() over (partition by m.channel_name, m.program_key order by m.broadcast_date, m.start_minute) rn,
      count(*) over (partition by m.channel_name, m.program_key) cnt
    from iptv_airing_metrics m
    where m.broadcast_date between p_from and p_to and m.target_kind = p_target
      and (p_channel is null or m.channel_name = p_channel)
  )
  select b.channel_name, min(b.channel_group), b.program_key, (array_agg(b.program_name order by b.broadcast_date desc))[1],
    count(*)::int, count(*) filter (where b.is_rerun_tag)::int, min(b.broadcast_date), max(b.broadcast_date),
    round(sum(b.rating * b.duration_min) / nullif(sum(b.duration_min) filter (where b.rating is not null), 0), 5),
    round(sum(b.reach_rate * b.duration_min) / nullif(sum(b.duration_min) filter (where b.reach_rate is not null), 0), 4),
    round(sum(b.avg_minute_viewers)::numeric / nullif(sum(b.reach_viewers), 0), 4),
    round(avg(b.rating) filter (where b.rn <= b.cnt / 2.0), 5),
    round(avg(b.rating) filter (where b.rn > b.cnt / 2.0), 5)
  from b
  group by b.channel_name, b.program_key;
$$;

-- ── 1-3. 시간대 경쟁(기간) ───────────────────────────────────────────
-- 방영 건을 걸친 시(hour)마다 겹친 분만큼 나눠 요일×시(방송일 기준 hour 2~25)×채널 평균 시청률을 낸다.
-- share_of_observed = 같은 요일·시에 자료가 있는 관측 채널 합계 대비 비중(점유율이 아님).
create or replace function iptv_slot_competition(p_from date, p_to date, p_target text)
returns table (
  dow int, hour_of_day int, channel_name text, channel_group text,
  avg_rating numeric, observed_channels int, share_of_observed numeric
)
language sql stable security definer set search_path = public
as $$
  with seg as (
    select m.channel_name, m.channel_group, m.dow, m.broadcast_date, h hr,
      least(m.end_minute, (h + 1) * 60) - greatest(m.start_minute, h * 60) mins, m.rating
    from iptv_airing_metrics m
    cross join lateral generate_series(m.start_minute / 60, (m.end_minute - 1) / 60) h
    where m.broadcast_date between p_from and p_to and m.target_kind = p_target and m.rating is not null
  ), per as (
    select s.dow, s.hr, s.channel_name, min(s.channel_group) grp,
      sum(s.rating * s.mins) / nullif(sum(s.mins), 0) r
    from seg s where s.mins > 0
    group by s.dow, s.hr, s.channel_name
  )
  select p.dow, p.hr, p.channel_name, p.grp, round(p.r, 5),
    (count(*) over (partition by p.dow, p.hr))::int,
    round(p.r / nullif(sum(p.r) over (partition by p.dow, p.hr), 0), 4)
  from per p;
$$;

-- ── 1-4. 보정 계수(버전) ────────────────────────────────────────────
-- 2단계 검증 결과를 버전별로 담는다. 12월 말 최종본을 고정해 자료가 끊긴 뒤에도 출처 기간과 함께 쓴다(계획 4단계).
create table if not exists iptv_calibration (
  version text not null,
  channel_name text not null,
  target_kind text not null check (target_kind in ('household', 'p2049')),
  slot_band text not null default 'all',
  period_from date not null,
  period_to date not null,
  n_pairs int not null,
  -- IPTV ÷ 닐슨 중앙값, 상관계수
  median_ratio numeric,
  corr numeric,
  -- 같은 프로그램 연속 방영의 회차 간 변화 폭(로그 차이 절댓값 중앙값): 닐슨·IPTV·닐슨 잡음 몫
  nielsen_step_mad numeric,
  iptv_step_mad numeric,
  noise_step numeric,
  -- 닐슨 시청률 0 비율(패널에 잡히지 않은 방영 건)
  nielsen_zero_rate numeric,
  note text,
  created_at timestamptz not null default now(),
  primary key (version, channel_name, target_kind, slot_band)
);
comment on table iptv_calibration is 'IPTV ↔ 닐슨 보정 계수·잡음 폭(버전별). 화면·판정 근거로 쓸 때는 버전과 출처 기간을 함께 적는다.';

-- ── 권한 ───────────────────────────────────────────────────────────
alter table iptv_channel_map enable row level security;
alter table iptv_nielsen_match enable row level security;
alter table iptv_calibration enable row level security;
revoke all on function refresh_iptv_nielsen_match(date, date) from public, anon, authenticated;
revoke all on function iptv_program_summary(date, date, text, text) from public, anon, authenticated;
revoke all on function iptv_slot_competition(date, date, text) from public, anon, authenticated;
revoke all on iptv_nielsen_pairs, iptv_coverage, iptv_airing_metrics from anon, authenticated;
