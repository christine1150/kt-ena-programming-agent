-- 사용자 지시(2026-09-20): "1시간 단위로 보기에서 시청률이 비는 곳이 있는 이유는?" +
-- "편성표 형태로 보기에서 회색 빈칸이 있는 게 이상해, 30분 단위로라도 실제 방영시간에 맞게
-- 그려달라" + "3시간 단위로 볼 때도 체크박스로 대표 프로그램명(그 구간 최고 시청률 타이틀)을
-- 보여달라".
--
-- 원인 확인: 기존 get_channel_dow_hourblock_pattern/get_channel_dow_hour_pattern은 ratings
-- 한 행(프로그램 하나의 실제 방영 구간 start_time~end_time 전체에 대한 시청률)을 start_time이
-- 속한 시간 칸에만 배정하고 있었다. 예를 들어 19:40~21:00에 방영된 프로그램은 19시뿐 아니라
-- 20시에도 실제로 방영 중이었는데, 20시 칸은 계속 빈칸(회색)으로 남았다. ratings.end_time은
-- 이미 적재돼 있는 값이라(Nielsen 원본의 종료시각 컬럼을 그대로 저장, 추정 아님) 이를 반영해
-- start_time~end_time이 겹치는 모든 시간에 그 프로그램의 시청률을 배정하도록 3개 함수를 모두
-- 다시 만든다. 짧은(7일) 창에서는 특정 요일·시간대 조합이 달력상 단 하루뿐이라 그 하루의 실제
-- 데이터가 없으면 여전히 빈칸일 수 있다 — 이건 데이터 공백이지 계산 버그가 아니므로 값을
-- 지어내지 않고 그대로 빈칸으로 둔다.
drop function if exists get_channel_dow_hourblock_pattern(text, text, date, int);
drop function if exists get_channel_dow_hour_pattern(text, text, date, int);
drop function if exists get_channel_dow_halfhour_pattern(text, text, date, int);

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
  program_names text,
  top_program_name text -- 그 (요일,시간) 조합에서 창 기간 동안 가장 높은 시청률을 기록한 타이틀
)
language sql
stable
as $$
  with raw as (
    select
      extract(isodow from r.broadcast_date)::int as dow,
      r.rating,
      p.canonical_name,
      ((case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) * 60
        + extract(minute from r.start_time)::int) as start_min,
      case when r.end_time is null then null else
        ((case when extract(hour from r.end_time) < 2 then extract(hour from r.end_time)::int + 24 else extract(hour from r.end_time)::int end) * 60
          + extract(minute from r.end_time)::int)
      end as end_min_raw
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    left join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  base as (
    select
      dow, rating, canonical_name, start_min,
      -- end_time이 없거나 시작보다 앞서면(데이터 이상) 시작 시각 1시간만 인정한다 — 없는 값을
      -- 추정하지 않고 기존 동작(시작 시간에만 배정)으로 안전하게 되돌아간다.
      case when end_min_raw is null or end_min_raw <= start_min then start_min + 60 else end_min_raw end as end_min
    from raw
  ),
  exploded as (
    select b.dow, b.rating, b.canonical_name, h.hour
    from base b
    cross join lateral generate_series(b.start_min / 60, (b.end_min - 1) / 60) as h(hour)
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
    round(avg(e.rating)::numeric, 5) as avg_rating,
    count(e.rating)::int as sample_count,
    string_agg(distinct e.canonical_name, ' / ' order by e.canonical_name) as program_names,
    (array_agg(e.canonical_name order by e.rating desc nulls last))[1] as top_program_name
  from grid g
  left join exploded e on e.dow = g.dow and e.hour = g.hour
  group by g.dow, g.hour
  order by g.dow, g.hour;
$$;
comment on function get_channel_dow_hour_pattern is 'Page 2 "요일×시간대 강세 시간대" 히트맵 1시간 단위(02~25시 24구간). 2026-09-20: ratings.end_time을 반영해 프로그램이 실제로 방영 중이던 모든 시간에 값을 배정(기존엔 시작 시각에만 배정돼 빈칸이 많았음) + top_program_name(그 시간대 최고 시청률 타이틀) 추가.';

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
  program_names text,
  top_program_name text -- "프로그램명 보기" 체크박스용 — 그 구간에서 가장 높은 시청률을 기록한 타이틀
)
language sql
stable
as $$
  with raw as (
    select
      r.id,
      extract(isodow from r.broadcast_date)::int as dow,
      r.rating,
      p.canonical_name,
      ((case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) * 60
        + extract(minute from r.start_time)::int) as start_min,
      case when r.end_time is null then null else
        ((case when extract(hour from r.end_time) < 2 then extract(hour from r.end_time)::int + 24 else extract(hour from r.end_time)::int end) * 60
          + extract(minute from r.end_time)::int)
      end as end_min_raw
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    left join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  base as (
    select
      id, dow, rating, canonical_name, start_min,
      case when end_min_raw is null or end_min_raw <= start_min then start_min + 60 else end_min_raw end as end_min
    from raw
  ),
  exploded as (
    select b.id, b.dow, b.rating, b.canonical_name,
      (2 + 3 * floor((h.hour - 2) / 3.0))::int as hour_block
    from base b
    cross join lateral generate_series(b.start_min / 60, (b.end_min - 1) / 60) as h(hour)
  ),
  -- 같은 프로그램(id)이 같은 3시간 블록 안의 여러 시간을 겹쳐 지나가도 그 블록에는 1건으로만
  -- 센다 — 안 그러면 sample_count가 부풀려진다(시청률 값 자체는 같아 평균에는 영향 없음).
  exploded_dedup as (
    select distinct id, dow, rating, canonical_name, hour_block from exploded
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
    round(avg(e.rating)::numeric, 5) as avg_rating,
    count(e.rating)::int as sample_count,
    string_agg(distinct e.canonical_name, ' / ' order by e.canonical_name) as program_names,
    (array_agg(e.canonical_name order by e.rating desc nulls last))[1] as top_program_name
  from grid g
  left join exploded_dedup e on e.dow = g.dow and e.hour_block = g.hour_block
  group by g.dow, g.hour_block
  order by g.dow, g.hour_block;
$$;
comment on function get_channel_dow_hourblock_pattern is 'Page 2 "요일×시간대 강세 시간대" 히트맵 3시간 단위(02-04~23-25 8구간). 2026-09-20: ratings.end_time 반영(빈칸 원인 수정) + top_program_name("프로그램명 보기" 체크박스용, 그 구간 최고 시청률 타이틀) 추가.';

-- 사용자 지시(2026-09-20): "편성표 형태로 보기는... 30분 단위로라도 실제 방영시간에 맞게 그려줘.
-- 회색 빈칸이 있는 것은 이상해" — 편성표 형태 전용 30분 단위(02:00~25:30, 48구간) 함수. 위
-- 두 함수와 동일하게 start_time~end_time이 겹치는 모든 30분에 값을 배정한다.
create function get_channel_dow_halfhour_pattern(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  dow int,
  dow_label text,
  half_hour int, -- 그 30분 구간의 시작을 "방송일 자정 기준 분"으로 표기(예: 02:00=120, 02:30=150) — 화면에서 시:분으로 변환
  avg_rating numeric,
  sample_count int,
  program_names text
)
language sql
stable
as $$
  with raw as (
    select
      extract(isodow from r.broadcast_date)::int as dow,
      r.rating,
      p.canonical_name,
      ((case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) * 60
        + extract(minute from r.start_time)::int) as start_min,
      case when r.end_time is null then null else
        ((case when extract(hour from r.end_time) < 2 then extract(hour from r.end_time)::int + 24 else extract(hour from r.end_time)::int end) * 60
          + extract(minute from r.end_time)::int)
      end as end_min_raw
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    left join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  base as (
    select
      dow, rating, canonical_name, start_min,
      case when end_min_raw is null or end_min_raw <= start_min then start_min + 30 else end_min_raw end as end_min
    from raw
  ),
  exploded as (
    select b.dow, b.rating, b.canonical_name, (hh.slot * 30) as half_hour
    from base b
    cross join lateral generate_series(b.start_min / 30, (b.end_min - 1) / 30) as hh(slot)
  ),
  grid as (
    select dow.d as dow, (hs.s * 30) as half_hour
    from generate_series(1, 7) as dow(d)
    cross join generate_series(4, 51) as hs(s) -- 02:00(4*30=120분)부터 25:30(51*30=1530분)까지 48구간
  )
  select
    g.dow,
    (array['월', '화', '수', '목', '금', '토', '일'])[g.dow] as dow_label,
    g.half_hour,
    round(avg(e.rating)::numeric, 5) as avg_rating,
    count(e.rating)::int as sample_count,
    string_agg(distinct e.canonical_name, ' / ' order by e.canonical_name) as program_names
  from grid g
  left join exploded e on e.dow = g.dow and e.half_hour = g.half_hour
  group by g.dow, g.half_hour
  order by g.dow, g.half_hour;
$$;
comment on function get_channel_dow_halfhour_pattern is 'Page 2 "편성표 형태로 보기" 전용 30분 단위(02:00~25:30, 48구간). half_hour는 방송일 자정 기준 분(예: 02:00=120) — 실제 방영 구간(start_time~end_time)이 겹치는 모든 30분에 값을 배정해 빈칸을 최소화한다.';
