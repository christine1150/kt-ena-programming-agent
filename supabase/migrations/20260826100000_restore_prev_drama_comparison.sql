-- 사용자 제보(2026-08-26): "오리지널 1, 2회 방송 시 직전 라인업 평균·회차 추이 비교를 보고서
-- 안에 넣어달라"는 요청에 실측 확인해보니, 이 기능(prev_drama_*, 20260821030000에서 추가)이
-- "요일별 리뷰 프로그램 → 주요 콘텐츠 관리 통합"(394afa2, 20260826040000/050000/060000/
-- 070000/080000) 리팩터로 get_original_content_daily가 featured_content 기반으로 전면
-- 재작성되면서 prev_drama_* 컬럼과 그 join이 통째로 누락돼 있었다(회귀 버그) — 클라이언트
-- (Dashboard.tsx buildOriginalInsight)는 여전히 이 4개 필드를 읽고 있어 조용히 항상 빈 채로
-- 동작했다. 최신 버전(20260826080000, dedupe·동시방송/직후재방 분리 포함) 그대로에 그 4개
-- 컬럼과 get_previous_drama_baseline() 호출만 되살린다(그 함수 자체는 그대로 살아있어 재사용).
-- program_target_label(가구/개인 타깃 구분)도 이 버전엔 없어 whitelist CTE에서 다시 계산해야
-- 한다(2026-08-21 버전과 동일한 공식).
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
    m.simulcast_channel_code_val as simulcast_channel_code,
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
  -- 제약 없이, 본방 시작 시각과 가까운(±30분, 편성 오차 여유) 그 채널 실제 방영분을, 본방과
  -- 동일 target_id로만 매칭한다(같은 프로그램·시각에도 타깃별로 여러 행이 있어 타깃 고정 필요).
  left join lateral (
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
comment on function get_original_content_daily is 'Page 1 주요 콘텐츠 리뷰: featured_content(주요 콘텐츠 관리) 중 오늘 요일·시각에 편성된 항목을 실제 방영 데이터(±10분 매칭)와 연결. 동시방송(simulcast_channel_id, ±30분, 본방과 같은 target_id)과 직후재방(rerun_channel_id, 본방 종료 후 그 채널 첫 프로그램)을 분리 계산. 첫 방송일자/종영일 범위 밖 프로그램 자동 제외, 같은 슬롯 중복은 1건만 남김(2026-08-26). 신규 오리지널 드라마 1~2회차는 직전에 끝난 오리지널 드라마의 방영 기간 평균과 비교(prev_drama_*, 2026-08-21 도입 — featured_content 전환 리팩터 때 누락됐던 것을 복원, 2026-08-26).';
