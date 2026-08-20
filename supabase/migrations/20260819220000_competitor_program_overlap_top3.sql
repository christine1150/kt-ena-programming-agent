-- get_competitor_program_overlap 다듬기: 심야 시간대처럼 겹치는 프로그램이 10개 넘게 잡히는
-- 경우가 실제로 있어(그래프상 노이즈), 우리 프로그램 하나당 "시청률 상위 3개 경쟁 프로그램"만
-- 돌려주도록 바꾼다 (기존 마이그레이션 파일은 그대로 두고 create or replace로 새 버전만 추가).
create or replace function get_competitor_program_overlap(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date
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
  where rn <= 3
  order by our_start_time, competitor_rating desc;
$$;
