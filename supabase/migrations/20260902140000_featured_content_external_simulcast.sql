-- 사용자 지시(2026-09-02): "나는 SOLO와 나는 SOLO 그 후 사랑은 계속된다 둘 다 동시방송을
-- SBS Plus로 명기할 것. 그리고 SBS Plus의 동시 방영 시청률도 함께 반영할 것".
--
-- 조사 결과: featured_content.simulcast_channel_id는 channels(id) FK라 우리 7개 채널만 가리킬
-- 수 있다(CLAUDE.md "분석 대상은 7개 채널" 고정 아키텍처) — SBS Plus는 그 7개에 없는 외부
-- (경쟁) 채널이라 이 필드로는 표현할 수 없다. 실측 확인 결과 SBS Plus는 이미
-- competitor_program_ratings(Nielsen 경쟁채널시청률 시트)에 존재하고, "나는SOLO"/"나는SOLO
-- 그후사랑은계속된다" 관련 프로그램명 행도 실제로 있다(competitor_name='SBS Plus') — 즉 시청률
-- 데이터 자체는 이미 수집돼 있고, featured_content에 그 연결고리(어느 경쟁채널명을 봐야 하는지)만
-- 없었다.
--
-- 새 컬럼 simulcast_competitor_name(자유 텍스트, competitor_program_ratings.competitor_name과
-- 동일 표기)을 추가해 외부 채널 동시방송을 표현한다. 기존 simulcast_channel_id(내부 채널)는
-- 그대로 두고 서로 다른 상황에 쓴다(한 프로그램이 둘 다 가질 일은 없다 — 있어도 두 값이 다른
-- 채널을 가리키는 한 계산상 문제는 없음).

alter table featured_content
  add column if not exists simulcast_competitor_name text;
comment on column featured_content.simulcast_competitor_name is
  '동시방송 파트너가 우리 7개 채널이 아닌 외부(경쟁) 채널일 때 그 이름
   (competitor_program_ratings.competitor_name과 동일 표기, 예: "SBS Plus"). simulcast_channel_id
   (내부 채널 동시방송)와는 별개 — 보통 둘 중 하나만 값을 가진다.';

-- 나는SOLO/나는SOLO그후사랑은계속된다(둘 다 ENA 본방) 동시방송 채널을 SBS Plus로 명기.
update featured_content fc
set simulcast_competitor_name = 'SBS Plus'
from programs p
where p.id = fc.program_id
  and p.channel_id = (select id from channels where code = 'ENA')
  and regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') in ('나는SOLO', '나는SOLO그후사랑은계속된다');

-- get_original_content_daily 재정의 — 20260826100000(최신 정의)에 외부 동시방송 매칭만 추가.
-- 내부 simulcast_channel_id 분기(ratings 조회)는 전혀 손대지 않고, simulcast_channel_id가
-- null이면서 simulcast_competitor_name이 있을 때만 competitor_program_ratings를 대신 본다
-- (본방과 같은 ±30분 창, norm_program_name 생성 컬럼으로 인덱스 매칭 — 새 정규화 로직 없음,
-- get_program_cross_channel_reach가 이미 쓰는 것과 동일한 컬럼 재사용).
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
  simulcast_channel_code text,
  simulcast_program_name text,
  simulcast_start_time time,
  simulcast_rating numeric,
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
  household_rating_change_pct numeric,
  prev_drama_name text,
  prev_drama_avg_rating numeric,
  prev_drama_episode_count int,
  prev_drama_change_pct numeric
)
language sql
stable
as $$
  with whitelist as (
    select distinct on (regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g'), fc.broadcast_time)
      extract(isodow from p_as_of_date)::int as day_of_week_iso,
      p.canonical_name as program_name,
      fc.category as featured_category_val,
      p.channel_id as broadcast_channel_id,
      c.code as broadcast_channel_code,
      case
        when c.primary_target ilike '%유료방송가입가구%' then '전국 유료가구'
        else trim(replace(c.primary_target, '개인', ''))
      end as program_target_label,
      fc.simulcast_channel_id as simulcast_channel_id_val,
      sc.code as simulcast_channel_code_val,
      fc.simulcast_competitor_name as simulcast_competitor_name_val,
      fc.rerun_channel_id as rerun_channel_id,
      rc.code as rerun_channel_code_val,
      fc.broadcast_time,
      fc.broadcast_schedule_text as note,
      fc.broadcast_start_date,
      fc.broadcast_time as sort_order
    from featured_content fc
    join programs p on p.id = fc.program_id
    join channels c on c.id = p.channel_id
    left join channels rc on rc.id = fc.rerun_channel_id
    left join channels sc on sc.id = fc.simulcast_channel_id
    where fc.broadcast_time is not null
      and fc.broadcast_day_of_week is not null
      and (array['월','화','수','목','금','토','일'])[extract(isodow from p_as_of_date)::int] = any(fc.broadcast_day_of_week)
      and (fc.broadcast_start_date is null or fc.broadcast_start_date <= p_as_of_date)
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_as_of_date)
    order by
      regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g'),
      fc.broadcast_time,
      (fc.rerun_channel_id is not null or fc.simulcast_channel_id is not null or fc.simulcast_competitor_name is not null) desc,
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
      m.reach as matched_reach,
      m.target_id as matched_target_id_val
    from whitelist w
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share, r.reach, r.target_id
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
  deduped as (
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
    m.featured_category_val as featured_category,
    m.program_name as featured_display_name,
    -- 사용자 지시(2026-09-02): 내부 채널이 없으면 외부 경쟁채널명(예: "SBS Plus")을 그대로
    -- simulcast_channel_code 자리에 내려준다 — 화면(Dashboard.tsx)이 이미
    -- CHANNEL_NAME_BY_CODE[code] ?? code로 못 찾은 코드를 그대로 표시하는 폴백을 갖고 있어
    -- 새 필드를 화면에 추가로 배선하지 않아도 그대로 보인다.
    coalesce(m.simulcast_channel_code_val, m.simulcast_competitor_name_val) as simulcast_channel_code,
    sim.canonical_name as simulcast_program_name,
    sim.start_time as simulcast_start_time,
    sim.rating as simulcast_rating,
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
    pct_change(hh.rating, hh_prior.rating) as household_rating_change_pct,
    prevd.program_name as prev_drama_name,
    prevd.avg_rating as prev_drama_avg_rating,
    prevd.episode_count as prev_drama_episode_count,
    pct_change(m.matched_rating, prevd.avg_rating) as prev_drama_change_pct
  from deduped m
  -- 동시방송(같은 채널이 본방과 거의 같은 시각에 함께 트는 경우) — 직후재방과 달리 "본방 종료 후"
  -- 제약 없이, 본방 시작 시각과 가까운(±30분, 편성 오차 여유) 실제 방영분을 찾는다. 내부 채널
  -- (ratings)과 외부 경쟁채널(competitor_program_ratings)은 서로 배타적 조건(하나가 not null이면
  -- 다른 하나는 null)이라 union all로 합쳐도 최대 1행만 나온다.
  left join lateral (
    (
      select p9.canonical_name, r9.start_time, r9.rating
      from ratings r9
      join programs p9 on p9.id = r9.program_id
      where m.simulcast_channel_id_val is not null
        and m.matched_program_name is not null
        and m.matched_start_time is not null
        and r9.channel_id = m.simulcast_channel_id_val
        and r9.source_type = 'nielsen_daily'
        and r9.broadcast_date = m.effective_date
        and r9.program_id is not null
        and r9.target_id = m.matched_target_id_val
        and least(
              abs(extract(epoch from (r9.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (r9.start_time - m.matched_start_time)))
            ) <= 1800 -- ±30분
      order by least(
              abs(extract(epoch from (r9.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (r9.start_time - m.matched_start_time)))
            ) asc
      limit 1
    )
    union all
    (
      select cpr.program_name as canonical_name, cpr.start_time, cpr.rating
      from competitor_program_ratings cpr
      where m.simulcast_channel_id_val is null
        and m.simulcast_competitor_name_val is not null
        and m.matched_program_name is not null
        and m.matched_start_time is not null
        -- 실측 확인(2026-09-02): SBS Plus의 나는SOLO 방영 기록은 our_channel_id=ENA가 아니라
        -- ENA_PLAY/ENA_DRAMA의 "경쟁채널시청률" 시트 밑에 잡혀 있었다(Nielsen이 그 경쟁채널을
        -- 어느 우리 채널의 비교 시트에서 관찰했는지일 뿐, 실제 동시방송 대상과는 무관 — Phase 12
        -- 감사에서 이미 "경쟁채널 1개뿐" 문서가 낡았음을 확인한 것과 같은 함정). 그래서
        -- our_channel_id로 좁히지 않고 경쟁채널명+날짜+정규화 프로그램명+±30분 창만으로 찾는다
        -- (같은 실제 방영 1건이 여러 our_channel_id 밑에 중복 기록돼도 order by+limit 1이
        -- 그중 하나만 골라 결과는 동일하다).
        and cpr.competitor_name = m.simulcast_competitor_name_val
        and cpr.broadcast_date = m.effective_date
        and cpr.norm_program_name = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
        and least(
              abs(extract(epoch from (cpr.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (cpr.start_time - m.matched_start_time)))
            ) <= 1800
      order by least(
              abs(extract(epoch from (cpr.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (cpr.start_time - m.matched_start_time)))
            ) asc
      limit 1
    )
  ) sim on true
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
  -- 신규 드라마 1~2회차만(2026-08-21 원 규칙 그대로) — 회차가 많아지면 자기 작품 기준 비교가
  -- 이미 가능하므로 직전 작품 비교는 필요 없다.
  left join lateral (
    select *
    from get_previous_drama_baseline(m.broadcast_channel_id, m.program_target_label, m.broadcast_start_date)
    where m.featured_category_val = '오리지널 드라마'
      and m.broadcast_start_date is not null
      and get_episode_number(m.matched_program_name, m.effective_date) <= 2
  ) prevd on true
  where m.matched_program_name is not null
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 주요 콘텐츠 리뷰: featured_content(주요 콘텐츠 관리) 중 오늘 요일·시각에 편성된 항목을 실제 방영 데이터(±10분 매칭)와 연결. 동시방송(±30분, 본방과 같은 target_id — 내부 채널은 simulcast_channel_id로 ratings 조회, 외부 경쟁채널은 simulcast_competitor_name으로 competitor_program_ratings 조회, 2026-09-02)과 직후재방(rerun_channel_id, 본방 종료 후 그 채널 첫 프로그램)을 분리 계산. 첫 방송일자/종영일 범위 밖 프로그램 자동 제외, 같은 슬롯 중복은 1건만 남김. 신규 오리지널 드라마 1~2회차는 직전에 끝난 오리지널 드라마의 방영 기간 평균과 비교(prev_drama_*).';
