-- Page 1 Original 리포트 보강(사용자 지시, 2026-08-20 여섯 번째): 실제로 8/19 데이터를 직접
-- 조회해 확인한 세 가지 패턴을 반영한다.
--   1) ENA Play의 "직후재방"이 지금까지 전혀 안 잡히고 있었다 — 원인은 코드 버그가 아니라
--      `original_review_programs.rerun_channel_id`가 "나는 SOLO"/"나는 SOLO, 그 후 사랑은
--      계속된다" 두 행 모두 NULL이었기 때문(관리자가 아직 안 채워둔 값). 이 마이그레이션
--      끝에서 ENA_PLAY로 채워 넣는다. 이름이 정확히 같은 프로그램이어야만 재방으로 인정하던
--      제약도, 사용자 지시대로 "본방 이후 그 채널의 첫 편성"으로 완화한다(이름이 달라도 인정).
--   2) ENA 자체가 22:30 본방 "전에" 전주 회차를 먼저 방영하고(예: 20:36), 본방이 끝난 직후
--      "당일 자체 재방"도 한 번 더 방영하는(예: 00:33=24:33) 패턴이 실제로 있다 — 지금까지는
--      ±10분 매칭 창 밖이라 완전히 무시되고 있었다. 리드인 참고 정보로 추가한다.
--   3) "동시간대 타깃 1위" 판정과 "전회 대비" 비교에 쓸 원자료(직전 방영일 실적)를 추가한다.

-- 회차 번호 추적(get_original_content_daily가 참조하므로 먼저 만든다) — Nielsen 자료에는 회차
-- 정보가 전혀 없어(프로그램명이 "나는SOLO"로만 들어옴), 어느 한 시점의 정확한 회차 번호를
-- 관리자가 한 번 심어두면(seed) 그 이후 날짜는 "그 프로그램이 실제로 방영된 날짜 수"를 세어
-- 자동으로 이어서 계산한다(요일이 밀리거나 결방이 있어도 실제 방영 여부를 그대로 반영 — 달력
-- 요일 계산으로 추정하지 않음). seed 이전 날짜는 계산하지 않는다(과거 회차를 거꾸로 추정하는
-- 건 결방/특집 편성 등으로 오차가 쌓이기 쉬워 하지 않음).
create table if not exists program_episode_counters (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  seed_episode_number int not null,
  seed_broadcast_date date not null,
  created_at timestamptz not null default now()
);
comment on table program_episode_counters is '회차제 프로그램의 회차 번호 기준점(관리자가 한 번 심어두면 그 이후는 자동 계산). 사용자 지시(2026-08-20)로 "나는SOLO" 267회=2026-08-19를 기준점으로 심어둠.';

create or replace function get_episode_number(p_canonical_name text, p_broadcast_date date)
returns int
language sql
stable
as $$
  select pec.seed_episode_number + count(distinct r.broadcast_date)
  from program_episode_counters pec
  left join ratings r
    on r.source_type = 'nielsen_daily' and r.program_id is not null
    and r.broadcast_date > pec.seed_broadcast_date
    and r.broadcast_date <= p_broadcast_date
    and exists (
      select 1 from programs p2 where p2.id = r.program_id and p2.canonical_name = pec.canonical_name
    )
  where pec.canonical_name = p_canonical_name
    and p_broadcast_date >= pec.seed_broadcast_date
  group by pec.seed_episode_number
$$;
comment on function get_episode_number is '회차 번호 = seed 회차 + (seed 날짜 이후 ~ 대상 날짜까지 그 프로그램이 실제로 방영된 날짜 수). seed 이전 날짜나 seed가 없는 프로그램은 NULL(추정하지 않음).';

insert into program_episode_counters (canonical_name, seed_episode_number, seed_broadcast_date)
values ('나는SOLO', 267, '2026-08-19')
on conflict (canonical_name) do update set seed_episode_number = excluded.seed_episode_number, seed_broadcast_date = excluded.seed_broadcast_date;

drop function if exists get_original_content_daily(date);

create function get_original_content_daily(p_as_of_date date)
returns table (
  day_of_week_iso int,
  whitelist_program_name text,
  broadcast_channel_code text,
  expected_time time,
  note text,
  matched_program_name text,
  matched_start_time time,
  matched_end_time time,
  matched_rating numeric,
  matched_share numeric,
  featured_category text,
  rerun_channel_code text,
  rerun_program_name text,
  rerun_start_time time,
  rerun_rating numeric,
  retention_pct numeric,
  pre_rerun_start_time time,
  pre_rerun_rating numeric,
  self_rerun_start_time time,
  self_rerun_rating numeric,
  prior_occurrence_date date,
  prior_occurrence_rating numeric,
  prior_rating_change_pct numeric,
  episode_number int
)
language sql
stable
as $$
  with whitelist as (
    select w.*, c.code as broadcast_channel_code, rc.code as rerun_channel_code_val
    from original_review_programs w
    join channels c on c.id = w.broadcast_channel_id
    left join channels rc on rc.id = w.rerun_channel_id
    where w.day_of_week_iso = extract(isodow from p_as_of_date)::int
  ),
  matched as (
    select
      w.*,
      p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end) as effective_date,
      m.canonical_name as matched_program_name,
      m.start_time as matched_start_time,
      m.end_time as matched_end_time,
      m.rating as matched_rating,
      m.share as matched_share
    from whitelist w
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share
      from ratings r
      join programs p on p.id = r.program_id
      where r.channel_id = w.broadcast_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and w.broadcast_time is not null
        and least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) <= 600 -- ±10분
      order by least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) asc
      limit 1
    ) m on true
  )
  select
    m.day_of_week_iso,
    m.program_name as whitelist_program_name,
    m.broadcast_channel_code,
    m.broadcast_time as expected_time,
    m.note,
    m.matched_program_name,
    m.matched_start_time,
    m.matched_end_time,
    m.matched_rating,
    m.matched_share,
    fc.category as featured_category,
    m.rerun_channel_code_val as rerun_channel_code,
    rr.canonical_name as rerun_program_name,
    rr.start_time as rerun_start_time,
    rr.rating as rerun_rating,
    case when m.matched_rating is not null and m.matched_rating > 0 and rr.rating is not null
      then round((rr.rating / m.matched_rating * 100)::numeric, 1) else null end as retention_pct,
    pre.start_time as pre_rerun_start_time,
    pre.rating as pre_rerun_rating,
    self_r.start_time as self_rerun_start_time,
    self_r.rating as self_rerun_rating,
    prior.broadcast_date as prior_occurrence_date,
    prior.rating as prior_occurrence_rating,
    pct_change(m.matched_rating, prior.rating) as prior_rating_change_pct,
    get_episode_number(m.matched_program_name, m.effective_date) as episode_number
  from matched m
  left join lateral (
    select fc.category
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    where m.matched_program_name is not null
      and replace(fp.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
    limit 1
  ) fc on true
  -- 직후재방(다른 채널, 보통 ENA Play) — 사용자 지시: 이름이 같아야 한다는 제약을 빼고
  -- "본방 이후 그 채널에 편성된 첫 프로그램"을 그대로 재방으로 인정한다.
  left join lateral (
    select p2.canonical_name, r2.start_time, r2.rating
    from ratings r2
    join programs p2 on p2.id = r2.program_id
    where m.rerun_channel_id is not null
      and m.matched_program_name is not null
      and r2.channel_id = m.rerun_channel_id
      and r2.source_type = 'nielsen_daily'
      and r2.broadcast_date = m.effective_date
      and r2.program_id is not null
      and r2.start_time > m.matched_end_time
    order by r2.start_time asc
    limit 1
  ) rr on true
  -- 선행 재방(같은 채널, 본방 시작 전) — 예: 22:30 본방 전 20:36에 전주 회차를 먼저 방영.
  left join lateral (
    select r3.start_time, r3.rating
    from ratings r3
    join programs p3 on p3.id = r3.program_id
    where m.matched_program_name is not null
      and r3.channel_id = m.broadcast_channel_id
      and r3.source_type = 'nielsen_daily'
      and r3.broadcast_date = m.effective_date
      and r3.program_id is not null
      and replace(p3.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r3.start_time < m.matched_start_time
    order by r3.start_time desc
    limit 1
  ) pre on true
  -- 당일 자체 재방(같은 채널, 본방 종료 후) — 예: 22:30~24:14 본방 종료 후 24:33에 자체 재방.
  left join lateral (
    select r4.start_time, r4.rating
    from ratings r4
    join programs p4 on p4.id = r4.program_id
    where m.matched_program_name is not null
      and r4.channel_id = m.broadcast_channel_id
      and r4.source_type = 'nielsen_daily'
      and r4.broadcast_date = m.effective_date
      and r4.program_id is not null
      and replace(p4.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r4.start_time > m.matched_end_time
    order by r4.start_time asc
    limit 1
  ) self_r on true
  -- 직전 방영일 실적("전회 대비" 비교용) — 같은 화이트리스트 프로그램·채널의 가장 최근 이전
  -- 본방 매칭(최대 21일 전까지 탐색, 결방 주가 있어도 어느 정도 버티도록).
  left join lateral (
    select r5.broadcast_date, r5.rating
    from ratings r5
    join programs p5 on p5.id = r5.program_id
    where m.matched_program_name is not null
      and r5.channel_id = m.broadcast_channel_id
      and r5.source_type = 'nielsen_daily'
      and r5.program_id is not null
      and replace(p5.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r5.broadcast_date < m.effective_date
      and r5.broadcast_date >= m.effective_date - 21
      and m.broadcast_time is not null
      and least(
            abs(extract(epoch from (r5.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r5.start_time - m.broadcast_time)))
          ) <= 600
    order by r5.broadcast_date desc
    limit 1
  ) prior on true
  where m.matched_program_name is not null -- 화이트리스트에는 있지만 실제로 방영된 게 없으면(조건부 편성 등) 조용히 제외
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 Original 리포트(평일): 화이트리스트를 실제 방영 데이터(±10분 매칭)와 연결. 직후재방(다른 채널, 이름 불문 첫 편성)·선행 재방(같은 채널, 본방 전)·당일 자체 재방(같은 채널, 본방 후)·직전 방영 대비·회차 번호까지 포함.';

-- 경쟁채널 시청률이 "다른 채널"의 등록 경쟁채널 시트에서만 나오는 경우를 위한 범용 조회.
-- 실제 사례(사용자 지시): SBS Plus는 ENA의 등록 경쟁채널이 아니라 ENA Drama의 등록 경쟁채널이라
-- (§1.2 채널 페어링 고정), ENA의 "나는 SOLO"와 SBS Plus 동시방송을 비교하려면 ENA Drama 쪽
-- 데이터를 봐야 한다. 이름을 하드코딩하지 않고 채널·경쟁채널명을 인자로 받아 범용으로 만든다.
create or replace function get_competitor_overlap_via_channel(
  p_lookup_channel_code text,
  p_competitor_name text,
  p_broadcast_date date,
  p_our_start_time time,
  p_our_end_time time
)
returns table (
  competitor_name text,
  program_name text,
  start_time time,
  end_time time,
  rating numeric
)
language sql
stable
as $$
  select cp.competitor_name, cp.program_name, cp.start_time, cp.end_time, cp.rating
  from competitor_program_ratings cp
  join channels c on c.id = cp.our_channel_id
  where c.code = p_lookup_channel_code
    and cp.competitor_name = p_competitor_name
    and cp.broadcast_date = p_broadcast_date
    and cp.start_time < coalesce(p_our_end_time, p_our_start_time + interval '1 hour')
    and coalesce(cp.end_time, cp.start_time + interval '1 hour') > p_our_start_time
  order by cp.rating desc nulls last;
$$;
comment on function get_competitor_overlap_via_channel is '경쟁채널 데이터가 조회 대상 채널이 아니라 다른 채널의 등록 경쟁채널 시트에만 있는 경우(예: SBS Plus는 ENA가 아니라 ENA Drama의 등록 경쟁채널)를 위한 범용 동시간대 조회.';
