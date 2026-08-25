-- 버그 수정(2026-08-26, 통합 직후 실측으로 발견): featured_content를 화이트리스트로 쓰기 시작하니
-- "같은 채널·같은 시각"에 편성된 항목이 여러 개(종영한 시리즈 포함) 남아 한 방영분을 서로 다른
-- 타이틀로 중복 매칭했다 — 실측: 2026-08-24 ENA 22:00 슬롯 하나에 '신병4: 사보타주'(정답),
-- '아너: 그녀들의 법정'(2026-03 종영), '크래시2 : 분노의 도로'(편성일 미정)가 모두 붙어 Page 1에
-- 같은 시청률이 세 번 나왔다(예전 original_review_programs는 요일별 한 줄짜리 표라 이 상황이
-- 구조적으로 없었다). 종영일이 비어 있는 과거 시리즈가 원인이라 데이터만으로는 못 거른다.
--
-- 수정: 매칭 이후 "실제 방영분 1건(채널+시각) = 화이트리스트 1건"이 되도록 한 번 더 추린다.
-- 우선순위는 (1) 화이트리스트 제목이 실제 Nielsen 프로그램명과 canonical 일치하는 항목,
-- (2) 첫 방송일자가 더 최근인 항목(진행 중인 시리즈가 종영 시리즈보다 우선). 이름이 전혀 안
-- 맞는 경우에도 예전처럼 시간 매칭 결과는 살려둔다(Nielsen 표기가 크게 다른 프로그램 보호).
-- 나머지 로직은 20260826040000과 동일(Delta-Only).
alter table featured_content
  add column if not exists simulcast_channel_id uuid references channels(id) on delete set null,
  add column if not exists rerun_channel_id uuid references channels(id) on delete set null;

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
    -- 화이트리스트 = featured_content 중 "오늘 요일에 편성돼 있고 방영 시각이 지정된" 항목
    -- (기존 original_review_programs 대체). 첫 방송일자 이전이거나 종영일이 지난 프로그램은
    -- 자동으로 빠진다 — 예전엔 요일만 보고 종영한 시리즈까지 계속 잡히던 것이 개선된다.
    --
    -- DISTINCT ON: 같은 프로그램이 본방 채널·동시방송 채널별로 각각 featured_content 행을 갖는
    -- 경우("KT ENA 오리지널" 시트가 채널별로 한 행씩 만든다) Page 1에 같은 타이틀이 두 번
    -- 나오지 않도록 하나만 고른다. 동시방송/직후재방 정보를 가진 행(= 새 "요일 별 리뷰 프로그램"
    -- 시트가 채운 본방 채널 행)을 우선한다.
    select distinct on (regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g'), fc.broadcast_time)
      extract(isodow from p_as_of_date)::int as day_of_week_iso,
      p.canonical_name as program_name,
      fc.category as featured_category_val,
      p.channel_id as broadcast_channel_id,
      c.code as broadcast_channel_code,
      fc.rerun_channel_id,
      rc.code as rerun_channel_code_val,
      fc.broadcast_time,
      fc.broadcast_schedule_text as note,
      fc.broadcast_start_date,
      fc.broadcast_time as sort_order
    from featured_content fc
    join programs p on p.id = fc.program_id
    join channels c on c.id = p.channel_id
    left join channels rc on rc.id = fc.rerun_channel_id
    where fc.broadcast_time is not null
      and fc.broadcast_day_of_week is not null
      and (array['월','화','수','목','금','토','일'])[extract(isodow from p_as_of_date)::int] = any(fc.broadcast_day_of_week)
      and (fc.broadcast_start_date is null or fc.broadcast_start_date <= p_as_of_date)
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_as_of_date)
    order by
      regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g'),
      fc.broadcast_time,
      (fc.rerun_channel_id is not null or fc.simulcast_channel_id is not null) desc,
      fc.created_at desc
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
  ),
  -- 실제 방영분 1건(채널+시각) = 화이트리스트 1건이 되도록 추린다. 같은 슬롯에 종영한 과거
  -- 시리즈까지 남아있어 한 방영분이 여러 타이틀로 중복되던 문제를 여기서 정리한다.
  -- 우선순위: ① 화이트리스트 제목이 실제 Nielsen 프로그램명과 canonical 일치, ② 첫 방송일자가
  -- 더 최근(진행 중 시리즈 우선). 매칭 결과가 없는 행(matched_program_name is null)은 어차피
  -- 마지막 where에서 걸러지므로 그대로 통과시킨다.
  deduped as (
    -- 매칭된 행은 (채널, 방영시각)만으로 묶어 하나만 남기고, 매칭 실패 행은 서로 안 뭉치도록
    -- 제목까지 키에 넣는다(어차피 마지막 where에서 빠지지만 안전하게).
    select distinct on (
      m.broadcast_channel_id,
      m.matched_start_time,
      case when m.matched_start_time is null then m.program_name else null end
    )
      m.*
    from matched m
    order by
      m.broadcast_channel_id,
      m.matched_start_time,
      case when m.matched_start_time is null then m.program_name else null end,
      -- 이름이 일치하는 항목을 맨 앞으로. 일치하는 게 없으면 첫 방송일자가 최근인 것부터.
      (m.matched_program_name is not null
        and regexp_replace(m.program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
            = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')) desc,
      m.broadcast_start_date desc nulls last,
      m.program_name
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
    -- 분류·표시명은 이제 화이트리스트(featured_content) 자체에서 바로 나온다 — 예전처럼
    -- 프로그램명을 다시 매칭해 찾아올 필요가 없어 매칭 실패로 분류가 비던 문제가 구조적으로 사라진다.
    m.featured_category_val as featured_category,
    m.program_name as featured_display_name,
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
  from deduped m
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
comment on function get_original_content_daily is 'Page 1 주요 콘텐츠 리뷰: featured_content(주요 콘텐츠 관리) 중 오늘 요일·시각에 편성된 항목을 실제 방영 데이터(±10분 매칭)와 연결. 2026-08-26부터 화이트리스트 출처가 original_review_programs → featured_content로 통합됐고(관리자 화면도 하나로 합침), 분류·표시명은 매칭 없이 featured_content에서 바로 가져온다. 첫 방송일자/종영일 범위를 벗어난 프로그램은 자동 제외. 직후재방·선행 재방·당일 자체 재방·직전 방영 대비·회차 번호·도달율·연령대별 상위 5개·가구 타깃 시청률과 전회 대비 등락 포함.';
