-- 사용자 지시(2026-09-19): "전주 대비 이번주 분석 등을 할 때, 히트맵의 시간대 위를
-- 마우스오버 하면 그 때 편성했던 실제 프로그램이 나올 수 있도록" + "히트맵은 지금 3시간
-- 단위인데, 우측에 체크박스를 만들어서 2시부터 25시까지 1시간 단위로 비교할 수 있는
-- 선택지도 만들어줄 것 — 역시 마우스오버 시 실제 편성 프로그램이 나올 수 있도록".
--
-- 1) get_channel_dow_hourblock_pattern(기존, 3시간 단위)에 program_names 컬럼을 추가한다.
--    반환 컬럼이 늘어나 RETURNS TABLE 시그니처가 바뀌므로 drop 후 재생성(이 프로젝트의
--    기존 관행 — 20260910020000_first_run_by_registered_slot.sql 참고).
-- 2) 1시간 단위 토글을 위한 get_channel_dow_hour_pattern을 신규로 추가한다 — 3시간 단위
--    함수와 WHERE절·window 로직은 동일하고 group by만 hour_block 대신 raw hour.
drop function if exists get_channel_dow_hourblock_pattern(text, text, date, int);
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
  sample_count int,
  program_names text -- 그 (요일,시간대) 조합에서 창 기간 동안 방영된 프로그램명(중복 제거, ' / ' 결합)
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
      r.rating,
      p.canonical_name
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    left join programs p on p.id = r.program_id
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
    count(b.rating)::int as sample_count,
    string_agg(distinct b.canonical_name, ' / ' order by b.canonical_name) as program_names
  from grid g
  left join base b on b.dow = g.dow and b.hour_block = g.hour_block
  group by g.dow, g.hour_block
  order by g.dow, g.hour_block;
$$;
comment on function get_channel_dow_hourblock_pattern is 'Page 2 "요일×시간대 강세 시간대" 히트맵 전용(3시간 단위 8구간: 02-04~23-25). 2026-09-19: 마우스오버 시 실제 편성 프로그램을 보여주기 위해 program_names 컬럼 추가.';

create function get_channel_dow_hour_pattern(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  dow int,
  dow_label text,
  hour int, -- 02~25시(02~01시를 다음날 넘어가는 방송일 관행대로 24/25로 표기)
  avg_rating numeric,
  sample_count int,
  program_names text
)
language sql
stable
as $$
  with base as (
    select
      extract(isodow from r.broadcast_date)::int as dow,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hour,
      r.rating,
      p.canonical_name
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    left join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  grid as (
    select dow.d as dow, hh.h as hour
    from generate_series(1, 7) as dow(d)
    cross join generate_series(2, 25) as hh(h)
  )
  select
    g.dow,
    (array['월', '화', '수', '목', '금', '토', '일'])[g.dow] as dow_label,
    g.hour,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    count(b.rating)::int as sample_count,
    string_agg(distinct b.canonical_name, ' / ' order by b.canonical_name) as program_names
  from grid g
  left join base b on b.dow = g.dow and b.hour = g.hour
  group by g.dow, g.hour
  order by g.dow, g.hour;
$$;
comment on function get_channel_dow_hour_pattern is 'Page 2 "요일×시간대 강세 시간대" 히트맵의 1시간 단위 토글 전용(02~25시 24구간). get_channel_dow_hourblock_pattern(3시간 단위)과 WHERE절·window 로직은 동일, group by만 raw hour.';
