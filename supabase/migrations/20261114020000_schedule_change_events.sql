-- 편성 변경(이동·교체) 사후 효과 이벤트(고도화 계획 S-2/B1, 2026-11-14, docs/upgrade-plan/B1_CHANGE_EFFECT.md §3.1).
-- 자사 닐슨·경쟁 닐슨·IPTV 세 출처에서 같은 추출 규칙(src/lib/dashboard/changeHistory.ts detectPastChanges)으로 뽑은 변경과 그 사후 효과를 쌓는다.
-- 계산은 서버 순수 함수가 하고(주 1회 크론이 upsert), 이 테이블과 집계 함수는 저장·분포 조회만 한다 — content-fit과 같은 "원칙 1의 명시적 예외".
-- 기대 효과 수치(+x%)는 만들지 않는다: 변경의 평균 효과는 0 근처·음수라 분포(상승·비슷·하락 건수)로만 쓴다.
create table if not exists schedule_change_events (
  source text not null check (source in ('own', 'comp', 'iptv')),
  -- own: channels.code / comp: competitor_name / iptv: IPTV 채널명
  channel_key text not null,
  channel_group text not null check (channel_group in ('terrestrial', 'drama', 'variety', 'life', 'uhd')),
  target_kind text not null check (target_kind in ('p2049', 'household')),
  kind text not null check (kind in ('move', 'replace')),
  -- 바뀐 뒤 첫 주 월요일(이동) 또는 첫 방영일(교체)
  event_date date not null,
  -- 이동: 옮긴 프로그램 / 교체: 새 프로그램 (정규화 키)
  program_key text not null,
  prev_program_key text,
  -- '요일|시'(요일 1=월, 시는 방송일 02시 기준). 교체는 from=to
  from_slot text not null,
  to_slot text not null,
  -- to_slot 기준 8대 시간대('02-05' … '23-02')
  daypart text not null check (daypart in ('02-05', '05-08', '08-11', '11-14', '14-17', '17-20', '20-23', '23-02')),
  -- 기존 detectPastChanges 값(전후 최대 6회 중앙값)
  before_median numeric,
  after_median numeric,
  before_n integer,
  after_n integer,
  change numeric,
  -- 공휴일 ±1일 방영을 뺀 전후 28일 비교
  w4_before numeric,
  w4_after numeric,
  w4_before_n integer,
  w4_after_n integer,
  w4_change numeric,
  -- 이동만: 새 자리 직전 28일 → 옮겨온 프로그램 28일 / 비운 자리
  to_slot_change numeric,
  from_slot_change numeric,
  -- 교체만: 이전 프로그램이 28일 안에 다른 자리에서 계속 방영됐나(true=편성상의 교체)
  prev_continues boolean,
  -- 시청률 수준별 잡음 폭 ÷ √min(전·후 비교 수). 잡음 표가 없으면 null
  noise_step numeric,
  verdict_noise text check (verdict_noise in ('up', 'flat', 'down')),
  verdict_band10 text not null check (verdict_band10 in ('up', 'flat', 'down')),
  version text not null default 'b1-v1',
  computed_at timestamptz not null default now(),
  primary key (source, channel_key, target_kind, kind, event_date, program_key, from_slot, to_slot)
);
comment on table schedule_change_events is '편성 변경(이동·교체) 사후 효과 이벤트 — 자사·경쟁 닐슨·IPTV 공통 추출(고도화 계획 B1). 기대 효과 수치가 아니라 분포(건수)로만 쓴다.';
create index if not exists schedule_change_events_group_idx on schedule_change_events (source, channel_group, kind, daypart);
create index if not exists schedule_change_events_channel_idx on schedule_change_events (source, channel_key, event_date desc);
alter table schedule_change_events enable row level security; -- 정책 없음: 서버 service_role만 접근

-- 셀(출처 × 군 × 유형 × 시간대 × 타깃)의 분포 — 사례가 20건 미만이면 건수만 돌려주고 나머지는 null(화면이 숨김).
-- p_only_swap=true(기본)면 교체는 "편성상의 교체(prev_continues = true)"만 센다. 잡음 띠 판정이 모든 행에 있을 때만 그것으로 세고, 아니면 ±10% 띠로 센다(basis로 표시).
create or replace function schedule_change_effect(
  p_source text[],
  p_group text default null,
  p_kind text default null,
  p_daypart text default null,
  p_target_kind text default null,
  p_only_swap boolean default true
)
returns table (
  n bigint,
  up bigint,
  flat bigint,
  down bigint,
  up_band10 bigint,
  down_band10 bigint,
  basis text,
  change_median numeric,
  change_p25 numeric,
  change_p75 numeric,
  to_slot_median numeric,
  from_slot_median numeric,
  period_from date,
  period_to date
)
language sql
stable
as $$
  with f as (
    select e.*
    from schedule_change_events e
    where e.source = any (p_source)
      and (p_group is null or e.channel_group = p_group)
      and (p_kind is null or e.kind = p_kind)
      and (p_daypart is null or e.daypart = p_daypart)
      and (p_target_kind is null or e.target_kind = p_target_kind)
      and not (p_only_swap and e.kind = 'replace' and e.prev_continues is distinct from true)
  ), g as (
    select f.*, bool_and(f.verdict_noise is not null) over () as use_noise from f
  )
  select
    count(*) as n,
    case when count(*) >= 20 then count(*) filter (where (case when g.use_noise then g.verdict_noise else g.verdict_band10 end) = 'up') end as up,
    case when count(*) >= 20 then count(*) filter (where (case when g.use_noise then g.verdict_noise else g.verdict_band10 end) = 'flat') end as flat,
    case when count(*) >= 20 then count(*) filter (where (case when g.use_noise then g.verdict_noise else g.verdict_band10 end) = 'down') end as down,
    case when count(*) >= 20 then count(*) filter (where g.verdict_band10 = 'up') end as up_band10,
    case when count(*) >= 20 then count(*) filter (where g.verdict_band10 = 'down') end as down_band10,
    case when coalesce(bool_and(g.verdict_noise is not null), false) then 'noise' else 'band10' end as basis,
    case when count(*) >= 20 then percentile_cont(0.5) within group (order by g.change) end as change_median,
    case when count(*) >= 20 then percentile_cont(0.25) within group (order by g.change) end as change_p25,
    case when count(*) >= 20 then percentile_cont(0.75) within group (order by g.change) end as change_p75,
    case when count(*) >= 20 then percentile_cont(0.5) within group (order by g.to_slot_change) end as to_slot_median,
    case when count(*) >= 20 then percentile_cont(0.5) within group (order by g.from_slot_change) end as from_slot_median,
    min(g.event_date) as period_from,
    max(g.event_date) as period_to
  from g;
$$;
