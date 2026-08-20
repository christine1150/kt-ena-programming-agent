-- 사용자 지시(2026-08-20): "동시간대 타깃 #위 표시에 대한 조사 대상 모수는 정확한 편성
-- 시간대와 프로그램을 우리가 확보 가능한 모든 프로그램의 동시간대 시청률을 조사하여 본방송
-- 당시의 시청률 순위를 나타낼 수 있도록 할 것." — 기존 get_competitor_program_overlap은
-- "노이즈 방지" 목적으로 상위 3개만 돌려줬는데(2026-08-19), 이 상위 3개만으로는 우리 시청률이
-- 3위보다 낮을 때 정확한 순위를 매길 수 없다(4위 이하 경쟁 프로그램이 우리보다 높을 수도,
-- 낮을 수도 있어 판단 불가). p_limit 파라미터를 추가해(기본값 3 — 기존 Page 2 COMPARED WITH?
-- 호출부는 그대로 top3만 받는다) Page 1 Original 리포트가 순위 계산용으로는 더 큰 값을 넘겨
-- "확보 가능한 모든 경쟁 프로그램"을 받을 수 있게 한다. 새 계산 방식을 만들지 않고 기존 함수의
-- LIMIT만 파라미터화했다.
drop function if exists get_competitor_program_overlap(text, text, date);

create or replace function get_competitor_program_overlap(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_limit int default 3
)
returns table (
  our_program_name text,
  our_start_time time,
  our_end_time time,
  our_rating numeric,
  competitor_name text,
  competitor_program_name text,
  competitor_start_time time,
  competitor_end_time time,
  competitor_rating numeric,
  rating_gap numeric
)
language sql
stable
as $$
  with our_programs as (
    select p.canonical_name, r.start_time, r.end_time, r.rating
    from ratings r
    join programs p on p.id = r.program_id
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code
      and t.label = p_target_label
      and r.source_type = 'nielsen_daily'
      and r.broadcast_date = p_as_of_date
      and r.program_id is not null
      and r.start_time is not null
  ),
  matched as (
    select
      op.canonical_name as our_program_name,
      op.start_time as our_start_time,
      op.end_time as our_end_time,
      op.rating as our_rating,
      cp.competitor_name,
      cp.program_name as competitor_program_name,
      cp.start_time as competitor_start_time,
      cp.end_time as competitor_end_time,
      cp.rating as competitor_rating,
      round((cp.rating - op.rating)::numeric, 5) as rating_gap,
      row_number() over (
        partition by op.start_time, op.canonical_name
        order by cp.rating desc
      ) as rn
    from our_programs op
    join channels c on c.code = p_channel_code
    join competitor_program_ratings cp
      on cp.our_channel_id = c.id
      and cp.broadcast_date = p_as_of_date
      and cp.start_time < coalesce(op.end_time, op.start_time + interval '1 hour')
      and coalesce(cp.end_time, cp.start_time + interval '1 hour') > op.start_time
    where cp.rating is not null and op.rating is not null
  )
  select
    our_program_name, our_start_time, our_end_time, our_rating,
    competitor_name, competitor_program_name, competitor_start_time, competitor_end_time,
    competitor_rating, rating_gap
  from matched
  where rn <= p_limit
  order by our_start_time, competitor_rating desc;
$$;
comment on function get_competitor_program_overlap is '동시간대 겹치는 등록 경쟁채널 프로그램 조회. p_limit(기본 3)으로 반환 개수 조절 — Page 2 COMPARED WITH?는 기본값(top3, 노이즈 방지)을 쓰고, Page 1 Original 리포트의 "동시간대 타깃 순위" 계산은 더 큰 값을 넘겨 확보 가능한 모든 경쟁 프로그램을 받는다.';
