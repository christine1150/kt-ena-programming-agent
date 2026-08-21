-- skyUHD 원본 파일(26 UHD ALL 시트)에는 점유율(share) 컬럼 자체가 없어(파서 확인:
-- src/app/api/admin/upload/skyuhd/route.ts가 share를 전혀 파싱하지 않음) ratings.share가
-- skyUHD 행에서 전부 NULL이다 — 직전 마이그레이션에서 만든 share_pctl은 항상 의미 없는 값만
-- 반환하므로(전부 NULL→percent_rank가 전부 0으로 나옴) 혼란을 줄 뿐이라 제거한다.
drop function if exists get_skyuhd_program_scorecard(date, int);

create function get_skyuhd_program_scorecard(
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  program_id uuid,
  program_name text,
  avg_rating numeric,
  air_count int,
  top_daypart text,
  most_common_start_hour int,
  rating_pctl numeric,
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
      count(*)::int as air_count,
      avg(b.rating) filter (where b.broadcast_date >= p_as_of_date - 27) as recent_avg_rating,
      avg(b.rating) filter (where b.broadcast_date between p_as_of_date - 83 and p_as_of_date - 28) as prior_avg_rating,
      bool_or(b.broadcast_date >= p_as_of_date - 13) as aired_recently
    from base b
    group by b.program_id
  )
  select
    a.program_id,
    a.canonical_name as program_name,
    round(a.avg_rating::numeric, 5) as avg_rating,
    a.air_count,
    dm.daypart as top_daypart,
    hm.hr as most_common_start_hour,
    round((percent_rank() over (order by a.avg_rating) * 100)::numeric, 1) as rating_pctl,
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
comment on function get_skyuhd_program_scorecard is 'skyUHD 전용 CONTENT FITS?/WHAT TO SCHEDULE? 대체 지표 — 타깃 구분이 없는 원본 자료 한계로 PRD Fit Score(타깃 기반) 계산이 불가능해, 채널 내 시청률 percentile과 최근 4주/이전 8주 추세만으로 계산한 참고 지표(다른 채널의 Fit Score 5태그와는 별개 개념, share는 원본에 없어 제외). 최근 14일 안에 방영된 프로그램만 반환.';
