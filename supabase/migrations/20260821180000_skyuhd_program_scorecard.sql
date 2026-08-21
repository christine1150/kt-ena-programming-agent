-- 사용자 지시(2026-08-21): "skyUHD도 WHAT TO SCHEDULE?/CONTENT FITS?를 채널 단위 대체 지표로
-- 새로 구현해줘." skyUHD는 원본 Nielsen 파일(26 UHD ALL 시트)에 타깃(연령대) 구분이 없어
-- ratings.target_id가 전부 NULL이다 — refresh_fit_score_mart()는 처음부터(개발 단위 17번,
-- 20260819140500) `where c.code <> 'SKYUHD'`로 skyUHD를 계산 대상에서 제외하고 있는데, 이는
-- Fit Score 공식(PRD.md 고정: 30% Target Performance + 20% Target Affinity + ...)이 전부
-- "타깃 시청률" 기반이라 원본 자료로는 계산 자체가 불가능하기 때문이다(버그 아님, 이번 세션
-- 이전부터 있던 원본 데이터 한계).
--
-- PRD 고정 Fit Score 공식을 skyUHD에 억지로 적용하거나 임의의 새 가중치 공식을 만들지 않는다
-- (CLAUDE.md 원칙: "계산 공식은 PRD.md에 명시된 것을 그대로 쓴다"). 대신 skyUHD가 실제로 가진
-- 채널 단위 지표(시청률·점유율·방영횟수·daypart·최근 추세)만으로 "채널 내 상대 순위" 참고
-- 지표를 계산한다 — Fit Score라는 이름도, STRENGTHEN/KEEP/MOVE/REPLACE 5태그도 쓰지 않고
-- (그 태그는 PRD Fit Score 임계값 80/65/50에 formal하게 묶여 있음) 강세/보통/약세/표본부족
-- 4단계로 명확히 구분되는 별도 지표임을 밝힌다. get_channel_top_programs와 같은 base 쿼리
-- 패턴(source_type in ('nielsen_daily','skyuhd'), target_id NULL 통과)을 그대로 재사용한다.
create or replace function get_skyuhd_program_scorecard(
  p_as_of_date date,
  p_window_days int default 84 -- 최근 12주, 다른 채널 TOP 콘텐츠와 동일 기준
)
returns table (
  program_id uuid,
  program_name text,
  avg_rating numeric,
  avg_share numeric,
  air_count int,
  top_daypart text,
  most_common_start_hour int,
  rating_pctl numeric,
  share_pctl numeric,
  recent_avg_rating numeric,
  prior_avg_rating numeric,
  trend_pct numeric
)
language sql
stable
as $$
  with base as (
    select
      r.program_id,
      p.canonical_name,
      r.rating,
      r.share,
      r.broadcast_date,
      daypart_of(r.start_time) as daypart,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr
    from ratings r
    join channels c on c.id = r.channel_id
    join programs p on p.id = r.program_id
    where c.code = 'SKYUHD'
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  daypart_counts as (
    select program_id, daypart, count(*) as cnt
    from base group by program_id, daypart
  ),
  daypart_mode as (
    select distinct on (program_id) program_id, daypart
    from daypart_counts order by program_id, cnt desc, daypart
  ),
  hour_counts as (
    select program_id, hr, count(*) as cnt
    from base group by program_id, hr
  ),
  hour_mode as (
    select distinct on (program_id) program_id, hr
    from hour_counts order by program_id, cnt desc, hr
  ),
  agg as (
    select
      b.program_id,
      min(b.canonical_name) as canonical_name,
      avg(b.rating) as avg_rating,
      avg(b.share) as avg_share,
      count(*)::int as air_count,
      -- 최근 4주 vs 이전 8주(기존 refresh_fit_score_mart의 recent_trend_score와 동일 기간 정의)
      avg(b.rating) filter (where b.broadcast_date >= p_as_of_date - 27) as recent_avg_rating,
      avg(b.rating) filter (where b.broadcast_date between p_as_of_date - 83 and p_as_of_date - 28) as prior_avg_rating,
      -- 최근 14일 안에 실제로 방영됐는지(다른 채널 WHAT TO SCHEDULE?와 동일한 "현재 편성 중" 기준)
      bool_or(b.broadcast_date >= p_as_of_date - 13) as aired_recently
    from base b
    group by b.program_id
  )
  select
    a.program_id,
    a.canonical_name as program_name,
    round(a.avg_rating::numeric, 5) as avg_rating,
    round(a.avg_share::numeric, 4) as avg_share,
    a.air_count,
    dm.daypart as top_daypart,
    hm.hr as most_common_start_hour,
    round((percent_rank() over (order by a.avg_rating) * 100)::numeric, 1) as rating_pctl,
    round((percent_rank() over (order by a.avg_share) * 100)::numeric, 1) as share_pctl,
    round(a.recent_avg_rating::numeric, 5) as recent_avg_rating,
    round(a.prior_avg_rating::numeric, 5) as prior_avg_rating,
    case when a.prior_avg_rating is not null and a.prior_avg_rating <> 0 and a.recent_avg_rating is not null
      then round(((a.recent_avg_rating - a.prior_avg_rating) / a.prior_avg_rating * 100)::numeric, 1)
      else null
    end as trend_pct
  from agg a
  left join daypart_mode dm on dm.program_id = a.program_id
  left join hour_mode hm on hm.program_id = a.program_id
  where a.aired_recently
  order by a.avg_rating desc;
$$;
comment on function get_skyuhd_program_scorecard is 'skyUHD 전용 CONTENT FITS?/WHAT TO SCHEDULE? 대체 지표 — 타깃 구분이 없는 원본 자료 한계로 PRD Fit Score(타깃 기반) 계산이 불가능해, 채널 내 시청률·점유율 percentile과 최근 4주/이전 8주 추세만으로 계산한 참고 지표(다른 채널의 Fit Score 5태그와는 별개 개념). 최근 14일 안에 방영된 프로그램만 반환.';
