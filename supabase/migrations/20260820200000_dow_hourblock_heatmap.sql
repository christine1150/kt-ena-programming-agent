-- 사용자 지시(2026-08-20): "최근 12주 요일 × 시간대 강세 시간대는 3시간 단위로 분리해주면
-- 좋겠어." — 기존 get_channel_dow_daypart_pattern(새벽/오전/오후/저녁_심야 4구간)은 Fit Score
-- 자연어 질의 엔진(CHANNEL_DAYPART intent) 등 다른 곳에서도 그대로 쓰고 있어 건드리지 않고,
-- Page 2 히트맵 전용으로 3시간 단위(02~04,05~07,...,23~25 총 8구간) 함수를 새로 만든다.
create function get_channel_dow_hourblock_pattern(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  dow int,
  dow_label text,
  hour_block int, -- 그 3시간 구간의 시작 시각(2,5,8,11,14,17,20,23)
  avg_rating numeric,
  sample_count int
)
language sql
stable
as $$
  with base as (
    select
      extract(isodow from r.broadcast_date)::int as dow,
      (2 + 3 * floor((
        (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) - 2
      ) / 3.0))::int as hour_block,
      r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  grid as (
    select dow.d as dow, hb.h as hour_block
    from generate_series(1, 7) as dow(d)
    cross join unnest(array[2, 5, 8, 11, 14, 17, 20, 23]) as hb(h)
  )
  select
    g.dow,
    (array['월', '화', '수', '목', '금', '토', '일'])[g.dow] as dow_label,
    g.hour_block,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    count(b.rating)::int as sample_count
  from grid g
  left join base b on b.dow = g.dow and b.hour_block = g.hour_block
  group by g.dow, g.hour_block
  order by g.dow, g.hour_block;
$$;
comment on function get_channel_dow_hourblock_pattern is 'Page 2 "최근 12주 요일×시간대 강세 시간대" 히트맵 전용(3시간 단위 8구간: 02-04~23-25). get_channel_dow_daypart_pattern(4구간, 자연어 질의 엔진 등에서 재사용 중)과 별개로 유지.';
