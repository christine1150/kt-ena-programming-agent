-- 사용자 지시(2026-08-26): "신병4사보타주는 '신병4: 사보타주'로 표현되게 통일해줘." Page 1
-- 헤드라인·카드 제목은 지금까지 Nielsen에서 그대로 딴 canonical_name(공백·문장부호가 전부
-- 빠진 "신병4사보타주")을 보여주고 있었다 — featured_content 관리 화면에서 관리자가 입력해둔
-- 사람이 읽기 좋은 원문 제목("신병4 : 사보타주", programs.canonical_name)이 이미 있는데 그동안
-- 조회만 하고(featured_category) 화면에 쓰지는 않았다. 이 원문을 featured_display_name으로
-- 추가 반환해, 프론트에서 있으면 우선 쓰고 없으면 기존처럼 matched_program_name으로 폴백한다
-- (화이트리스트에 없는 일반 프로그램은 계속 Nielsen 표기 그대로). 나머지 로직·조인은
-- 20260825150000_original_daily_punctuation_match_fix.sql과 완전히 동일(Delta-Only).
--
-- 부수 수정: 관리자가 입력해둔 "신병4 : 사보타주"는 콜론 앞에 불필요한 공백이 있어(다른
-- 항목들 "아너: 그녀들의 법정" 등과도 표기가 어긋남) 사용자가 요청한 정확한 형태
-- "신병4: 사보타주"로 고친다(featured_content가 참조하는 programs 행 하나만 UPDATE — 실제
-- Nielsen ingest용 programs 행(공백·문장부호 없는 canonical_name, id 별도)은 건드리지 않음).
update programs
set canonical_name = '신병4: 사보타주', raw_name = '신병4: 사보타주'
where id = '6d53a214-fead-40db-93f5-4a94c192dc3a' and canonical_name = '신병4 : 사보타주';

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
  featured_display_name text,
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
  age_breakdown jsonb,
  matched_household_rating numeric,
  household_rating_change_pct numeric
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
    fc.display_name as featured_display_name,
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
    age.age_breakdown,
    hh.rating as matched_household_rating,
    pct_change(hh.rating, hh_prior.rating) as household_rating_change_pct
  from matched m
  left join lateral (
    select fc.category, fp.canonical_name as display_name
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    where m.matched_program_name is not null
      and regexp_replace(fp.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
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
      and regexp_replace(p3.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
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
      and regexp_replace(p4.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
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
      and regexp_replace(p5.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
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
            and regexp_replace(p6.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
        )
        and t.label ~ '^(수도권|전국) (남|여)(0409|10대|20대|30대|40대|50대|60대\+)$'
        and r6.rating is not null
      order by r6.rating desc
      limit 5
    ) x
  ) age on true
  -- 가구(전국 유료가구) 타깃 버전 — 타깃 쪽(matched/prior)과 완전히 같은 매칭 방식(같은 방영
  -- 슬롯 ±10분, 직전 방영 대비)을 "전국 유료가구" 타깃에 그대로 적용. 그 타깃 데이터가 없는
  -- 채널(가구가 이미 KPI인 OLIFE/ONCE/ENA Story 등)은 자연히 null — 제목에서 조건부로 생략된다.
  left join lateral (
    select r7.rating
    from ratings r7
    join targets t7 on t7.id = r7.target_id
    where m.matched_program_name is not null
      and r7.channel_id = m.broadcast_channel_id
      and r7.source_type = 'nielsen_daily'
      and r7.broadcast_date = m.effective_date
      and r7.program_id is not null
      and t7.label = '전국 유료가구'
      and m.broadcast_time is not null
      and least(
            abs(extract(epoch from (r7.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r7.start_time - m.broadcast_time)))
          ) <= 600
    order by least(
            abs(extract(epoch from (r7.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r7.start_time - m.broadcast_time)))
          ) asc
    limit 1
  ) hh on true
  left join lateral (
    select r8.rating
    from ratings r8
    join targets t8 on t8.id = r8.target_id
    where m.matched_program_name is not null
      and r8.channel_id = m.broadcast_channel_id
      and r8.source_type = 'nielsen_daily'
      and r8.program_id is not null
      and t8.label = '전국 유료가구'
      and r8.broadcast_date < m.effective_date
      and r8.broadcast_date >= m.effective_date - 21
      and m.broadcast_time is not null
      and least(
            abs(extract(epoch from (r8.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r8.start_time - m.broadcast_time)))
          ) <= 600
    order by r8.broadcast_date desc
    limit 1
  ) hh_prior on true
  where m.matched_program_name is not null -- 화이트리스트에는 있지만 실제로 방영된 게 없으면(조건부 편성 등) 조용히 제외
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 Original 리포트(평일): 화이트리스트를 실제 방영 데이터(±10분 매칭)와 연결. 직후재방·선행 재방·당일 자체 재방·직전 방영 대비·회차 번호·도달율·연령대별 상위 5개·가구(전국 유료가구) 타깃 시청률과 그 전회 대비 등락, featured_display_name(관리자가 등록한 사람이 읽기 좋은 원문 제목, 2026-08-26 추가)까지 포함. 프로그램명 매칭은 공백뿐 아니라 문장부호까지 제거한 canonical 비교.';
