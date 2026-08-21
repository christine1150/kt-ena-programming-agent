-- 사용자 지시(2026-08-21): "나는 SOLO, 그 후 사랑은 계속된다" 179회 헤드라인 포맷("N회 본방
-- 시청률 (전회 대비 감소, 동시간대 타깃 4위)")이 깨져 있었다 — 원인은 이 프로그램(canonical_name
-- '나는SOLO그후사랑은계속된다', 목요일 22:30 본방, 원조 '나는SOLO'와는 다른 프로그램)이
-- program_episode_counters에 한 번도 seed되지 않아 get_episode_number()가 NULL을 반환하고
-- 있었기 때문(회차 없는 화이트리스트 항목은 헤드라인에서 "N회" 부분이 통째로 빠짐). 사용자가
-- 첨부한 8/20자 PD 리뷰 보고서에 "179회"로 명시돼 있어 그대로 seed한다.
insert into program_episode_counters (canonical_name, seed_episode_number, seed_broadcast_date)
values ('나는SOLO그후사랑은계속된다', 179, '2026-08-20')
on conflict (canonical_name) do update set seed_episode_number = excluded.seed_episode_number, seed_broadcast_date = excluded.seed_broadcast_date;

-- 사용자 지시(2026-08-21): 첨부된 PD 수작업 리뷰 보고서(분당시청률·플랫폼별은 우리 시스템에
-- 없는 데이터라 그대로 못 옮기지만, "연령대별 세분화 강세/약세"와 "도달율" 두 가지는 우리
-- ratings 테이블에 이미 있는 실측 데이터임을 확인했다 — §1.3 타깃상세 시트가 수도권/전국 채널
-- 스코프에 맞는 10살 단위 연령대(남/여 0409~60대+) 시청률을 프로그램 단위로 이미 갖고 있다.
-- 본방 슬롯(matched_start_time)의 연령대별 시청률 상위 5개와 도달율을 추가해 "주요 컨텐츠
-- 리뷰"에서 KPI 타깃(예: 수도권 2049) 하나만으론 안 보이는 실제 핵심 시청층을 보여준다.
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
  matched_reach numeric,
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
  episode_number int,
  age_breakdown jsonb
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
      m.share as matched_share,
      m.reach as matched_reach
    from whitelist w
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share, r.reach
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
    m.matched_reach,
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
    get_episode_number(m.matched_program_name, m.effective_date) as episode_number,
    age.age_breakdown
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
  -- 연령대별 세분화(10살 단위, 본방 슬롯 한정) — 상위 5개만 jsonb로 묶어 반환, 나머지는 클라이언트에서
  -- 텍스트로 조립(CLAUDE.md 원칙: 정렬/집계는 SQL, 문장 조립만 클라이언트).
  left join lateral (
    select jsonb_agg(jsonb_build_object('label', x.label, 'rating', x.rating) order by x.rating desc) as age_breakdown
    from (
      select t.label, r6.rating
      from ratings r6
      join targets t on t.id = r6.target_id
      where m.matched_program_name is not null
        and r6.channel_id = m.broadcast_channel_id
        and r6.source_type = 'nielsen_daily'
        and r6.broadcast_date = m.effective_date
        and r6.program_id is not null
        and r6.start_time = m.matched_start_time
        and exists (
          select 1 from programs p6 where p6.id = r6.program_id
            and replace(p6.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
        )
        and t.label ~ '^(수도권|전국) (남|여)(0409|10대|20대|30대|40대|50대|60대\+)$'
        and r6.rating is not null
      order by r6.rating desc
      limit 5
    ) x
  ) age on true
  where m.matched_program_name is not null -- 화이트리스트에는 있지만 실제로 방영된 게 없으면(조건부 편성 등) 조용히 제외
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 Original 리포트(평일): 화이트리스트를 실제 방영 데이터(±10분 매칭)와 연결. 직후재방·선행 재방·당일 자체 재방·직전 방영 대비·회차 번호·도달율·연령대별 상위 5개(본방 슬롯 한정)까지 포함.';
