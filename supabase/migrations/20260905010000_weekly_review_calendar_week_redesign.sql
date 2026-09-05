-- 사용자 지시(2026-09-05): 1페이지 "주요 컨텐츠 리뷰"의 요일 화이트리스트가 없는 날 대체 뷰
-- (weekly_review)를 전면 재설계한다.
-- (1) 기존 get_original_content_weekly_review(p_as_of_date, p_days=7)는 asOfDate 기준
--     "트레일링 7일"이라 달력 요일과 무관했다 — 이제 호출부(route.ts)가 계산해 넘기는
--     명시적 날짜 구간(p_date_from~p_date_to, 정확히 7일)을 그대로 쓴다. route.ts는 이번 주
--     토·일이 아직 지나지 않았으면(월~금) 지난주 토·일 + 이번 주 월~금을, 이미 토·일까지
--     지났으면 이번 주 월~일을 넘긴다.
-- (2) "평균/최고/최근" 3종 대신 "금주 실적"(this_week_rating)과 "4주 평균"(baseline_avg_rating,
--     p_date_from 이전 p_baseline_weeks*7일의 같은 요일 평균)만 반환한다.
-- (3) 실측 중 발견한 문제: 기존에 이 함수가 참조하던 original_review_programs(채널기본정보.xlsx
--     "요일 별 리뷰 프로그램" 시트, 수기 화이트리스트)가 낡아 있었다 — "신병4:사보타주"(오리지널
--     드라마, 2026-08-24부터 방영 중)가 아예 없고, "짐쌀라비움"은 실제로는 일요일 방영인데
--     토요일로 잘못 등록돼 있었다. 반면 Page 1 일간 모드(get_original_content_daily)와
--     오디언스 리포트(getInSeasonFeaturedContent)가 이미 쓰는 featured_content(주요 콘텐츠
--     관리 화면에서 직접 관리되는 표, category+요일 배열+방영기간 보유)는 최신 상태였다 —
--     "지금 방영 중인 오리지널 드라마·예능이 반드시 들어가야 한다"는 지시를 만족하려면
--     이 함수도 featured_content를 1순위 소스로 쓰고, original_review_programs는 그 프로그램이
--     featured_content에 아예 등록돼 있지 않을 때만(예: "여자가 여왕이 되는, 위대한 도전" 등
--     사업형 프로그램 일부) 보충하는 2순위로 남긴다 — 두 표 모두에 있는 이름은 항상
--     featured_content 쪽 요일·채널을 신뢰한다(더 최근에 관리되는 표라 판단).
--     featured_content 자체의 중복 등록(예: "신병4: 사보타주"/"신병4사보타주", "제비탐정
--     장성규"/"제비탐정장성규" — 공백만 다른 같은 프로그램)은 정규화한 이름+채널+요일별로
--     하나만 남긴다(더 자연스러운 표기인 긴 이름을 우선).
-- CTE 내부 컬럼명을 전부 sl_/wp_/bp_ 접두사로 지어 RETURNS TABLE 출력 컬럼명과 절대 겹치지
-- 않게 했다(plpgsql-returns-table-column-shadowing 메모리와 동일한 예방 조치 — 이 함수는
-- language sql이라 원래도 위험이 적지만, 가독성을 위해 그대로 유지).
drop function if exists get_original_content_weekly_review(date, int);
-- 이번 세션에서 먼저 만들었던 시그니처(category 컬럼 없는 버전)도 반환 타입이 달라 create or
-- replace로 덮어쓸 수 없다 — 배포 전 검증 중 발견해 함께 제거(git에 아직 커밋 전인 이 마이그레이션
-- 파일 자체를 완성해 가는 과정, 별도 이력 아님).
drop function if exists get_original_content_weekly_review(date, date, integer);

create or replace function get_original_content_weekly_review(
  p_date_from date,
  p_date_to date,
  p_baseline_weeks int default 4
)
returns table (
  program_name text,
  broadcast_channel_code text,
  category text,
  day_of_week_iso int,
  this_week_date date,
  this_week_rating numeric,
  baseline_avg_rating numeric,
  baseline_instances int
)
language sql
stable
as $$
  with dow_map(kr, iso) as (
    values ('월',1),('화',2),('수',3),('목',4),('금',5),('토',6),('일',7)
  ),
  featured_slots as (
    select
      regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g') as sl_key,
      p.canonical_name as sl_program_name,
      c.id as sl_channel_id,
      c.code as sl_channel_code,
      fc.category as sl_category,
      fc.broadcast_time as sl_time,
      dm.iso as sl_dow,
      row_number() over (
        partition by regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g'), c.code, dm.iso
        order by length(p.canonical_name) desc, fc.broadcast_start_date desc
      ) as rn
    from featured_content fc
    join programs p on p.id = fc.program_id
    join channels c on c.id = p.channel_id
    cross join lateral unnest(fc.broadcast_day_of_week) as day_kr
    join dow_map dm on dm.kr = day_kr
    where fc.broadcast_start_date <= p_date_to
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_date_from)
  ),
  legacy_slots as (
    select
      regexp_replace(w.program_name, '[^0-9A-Za-z가-힣]', '', 'g') as sl_key,
      w.program_name as sl_program_name,
      w.broadcast_channel_id as sl_channel_id,
      c.code as sl_channel_code,
      null::text as sl_category,
      w.broadcast_time as sl_time,
      w.day_of_week_iso as sl_dow
    from original_review_programs w
    join channels c on c.id = w.broadcast_channel_id
  ),
  slots as (
    select sl_key, sl_program_name, sl_channel_id, sl_channel_code, sl_category, sl_time, sl_dow
    from featured_slots
    where rn = 1
    union
    select l.sl_key, l.sl_program_name, l.sl_channel_id, l.sl_channel_code, l.sl_category, l.sl_time, l.sl_dow
    from legacy_slots l
    where not exists (select 1 from featured_slots f where f.sl_key = l.sl_key)
  ),
  window_days as (
    select gs::date as target_date from generate_series(p_date_from, p_date_to, interval '1 day') gs
  ),
  this_week as (
    select
      s.sl_program_name as wp_program_name,
      s.sl_channel_code as wp_channel_code,
      s.sl_category as wp_category,
      s.sl_dow as wp_dow,
      wd.target_date as wp_date,
      (
        select r.rating
        from ratings r
        join programs p on p.id = r.program_id
        where r.channel_id = s.sl_channel_id
          and r.source_type = 'nielsen_daily'
          and r.broadcast_date = wd.target_date - (case when s.sl_time < time '02:00:00' then 1 else 0 end)
          and r.program_id is not null
          and s.sl_time is not null
          and regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g')
              = regexp_replace(s.sl_program_name, '[^0-9A-Za-z가-힣]', '', 'g')
          and least(
                abs(extract(epoch from (r.start_time - s.sl_time))),
                86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
              ) <= 600
        order by least(
                abs(extract(epoch from (r.start_time - s.sl_time))),
                86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
              ) asc
        limit 1
      ) as wp_rating
    from window_days wd
    join slots s on s.sl_dow = extract(isodow from wd.target_date)::int
  ),
  baseline_days as (
    select gs::date as target_date
    from generate_series(p_date_from - (p_baseline_weeks * 7), p_date_from - 1, interval '1 day') gs
  ),
  baseline as (
    select
      s.sl_program_name as bp_program_name,
      s.sl_channel_code as bp_channel_code,
      (
        select r.rating
        from ratings r
        join programs p on p.id = r.program_id
        where r.channel_id = s.sl_channel_id
          and r.source_type = 'nielsen_daily'
          and r.broadcast_date = bd.target_date - (case when s.sl_time < time '02:00:00' then 1 else 0 end)
          and r.program_id is not null
          and s.sl_time is not null
          and regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g')
              = regexp_replace(s.sl_program_name, '[^0-9A-Za-z가-힣]', '', 'g')
          and least(
                abs(extract(epoch from (r.start_time - s.sl_time))),
                86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
              ) <= 600
        order by least(
                abs(extract(epoch from (r.start_time - s.sl_time))),
                86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
              ) asc
        limit 1
      ) as bp_rating
    from baseline_days bd
    join slots s on s.sl_dow = extract(isodow from bd.target_date)::int
  ),
  baseline_agg as (
    select bp_program_name, bp_channel_code,
      round(avg(bp_rating)::numeric, 5) as baseline_avg_rating,
      count(bp_rating)::int as baseline_instances
    from baseline
    group by bp_program_name, bp_channel_code
  ),
  this_week_best as (
    -- 한 프로그램이 이 창 안에 여러 요일로 등록돼 있으면(예: 월,화 방영 드라마) 그중 실제로
    -- 방영 데이터가 잡힌 "가장 최근" 회차 하나만 카드에 낸다.
    select distinct on (wp_program_name, wp_channel_code)
      wp_program_name, wp_channel_code, wp_category, wp_dow, wp_date, wp_rating
    from this_week
    where wp_rating is not null
    order by wp_program_name, wp_channel_code, wp_date desc
  )
  select
    tw.wp_program_name as program_name,
    tw.wp_channel_code as broadcast_channel_code,
    tw.wp_category as category,
    tw.wp_dow as day_of_week_iso,
    tw.wp_date as this_week_date,
    tw.wp_rating as this_week_rating,
    ba.baseline_avg_rating,
    coalesce(ba.baseline_instances, 0) as baseline_instances
  from this_week_best tw
  left join baseline_agg ba
    on ba.bp_program_name = tw.wp_program_name
   and ba.bp_channel_code = tw.wp_channel_code
  order by tw.wp_date asc;
$$;
