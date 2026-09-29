-- 사용자 지시(2026-09-30): "전년 대비 이번년도 누적을 요청했는데... 시간대별 그래프도 제대로
-- 전년도와 올해가 그려지지 않는 등 여러가지 버그가 발생했어. 모든 채널이 그래."
--
-- 원인: get_hourly_rating_pattern이 실제로 프로그램 단위 데이터가 있는 시간대(broadcast_hour)만
-- group by로 돌려주고, 데이터가 아예 없는 시간대는 결과 행 자체가 빠졌다. YoY처럼 "전년 동기"와
-- "이번 기간" 두 기간을 나란히 그리는 화면(ChannelDeepDive.tsx의 HourlyGraphPanel)은 이 배열을
-- 순서대로 막대로 그리므로, 두 기간에 데이터가 있는 시간대 집합이 다르면(흔한 일 — 연도에 따라
-- 편성이 바뀌므로) 같은 x축 위치가 서로 다른 시간대를 가리키게 된다(막대 개수 자체도 달라짐).
--
-- 고침: 02~25시(이 프로젝트의 방송일 관행 그대로) 24개 시간대를 generate_series로 항상 만들고
-- 실측 집계에 left join한다. 데이터가 없는 시간대는 avg_*가 null, program_count가 0으로 내려가며
-- (행이 아예 빠지는 대신), 프론트가 이미 인덱스 순서대로 그리므로 이제 두 기간의 같은 위치가
-- 항상 같은 시간대를 가리킨다.
drop function if exists get_hourly_rating_pattern(text, text, date, date, int, int);

create or replace function get_hourly_rating_pattern(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_target_dow int default null,
  p_target_weeks int default null
)
returns table (
  broadcast_hour int,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  program_count bigint
)
language sql
stable
as $$
  with hours as (
    select generate_series(2, 25) as broadcast_hour
  ),
  agg as (
    select
      (case when extract(hour from r.start_time) < 2
            then extract(hour from r.start_time)::int + 24
            else extract(hour from r.start_time)::int
       end) as broadcast_hour,
      avg(r.rating) as avg_rating,
      avg(r.share) as avg_share,
      avg(r.reach) as avg_reach,
      avg(r.time_spent_seconds) as avg_time_spent_seconds,
      count(*) as program_count
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code
      and (t.label = p_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and r.program_id is not null
      and r.start_time is not null
      and (
        (p_target_dow is null or p_target_weeks is null) and r.broadcast_date between p_date_from and p_date_to
        or
        (p_target_dow is not null and p_target_weeks is not null)
          and r.broadcast_date in (select d from same_dow_dates(p_date_to, p_target_dow, p_target_weeks))
      )
    group by broadcast_hour
  )
  select
    h.broadcast_hour,
    agg.avg_rating,
    agg.avg_share,
    agg.avg_reach,
    agg.avg_time_spent_seconds,
    coalesce(agg.program_count, 0) as program_count
  from hours h
  left join agg on agg.broadcast_hour = h.broadcast_hour
  order by h.broadcast_hour
$$;
comment on function get_hourly_rating_pattern is 'Page 2 시간대별 그래프(02~25시) 원자료. 02~25시 24개 시간대를 항상 반환(데이터 없는 시간대는 avg_*=null, program_count=0)해, 전년/금년처럼 두 기간을 나란히 그릴 때 시간대 집합이 달라 x축이 어긋나는 문제를 막는다. p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 p_date_from~p_date_to 대신 "그 요일의 최근 N주"만 집계.';
