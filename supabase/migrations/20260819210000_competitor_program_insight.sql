-- Page 2 COMPARED WITH? 보강: "경쟁채널 통합 시청률"만으로는 Competitive Pressure가 왜 100.0인지
-- (ENA류는 실제로 MBC/SBS/tvN 등 상위 경쟁채널의 합산 시청률이 ENA 자체보다 커서 클램프되는
-- 정상적인 현상 — 버그 아님, CLAUDE.md에 문서화됨) 설명이 안 되고, "그래서 그 시간대에 경쟁채널이
-- 뭘로 잘했는지"가 안 보인다는 사용자 피드백. competitor_program_ratings(§1.2, 등록된 경쟁채널의
-- 프로그램 단위 하루 편성, 이번에 파서 버그를 고치고 전량 재백필함)를 이용해 두 가지를 만든다:
--   1) get_competitor_program_overlap: 우리 프로그램과 "같은 시간대"에 경쟁채널이 무엇을
--      편성했는지, 그 시청률까지 나란히 보여준다(동시간대 직접 비교).
--   2) get_competitor_top_programs: 그날 등록된 경쟁채널들의 "가장 잘된 프로그램 TOP N"
--      (우리 프로그램과 무관하게, 시장 전체에서 무엇이 강했는지).
-- 두 함수 모두 Competitor Master에 등록된 채널만 나온다(등록 안 된 채널은 애초에 저장되지 않음).

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
  )
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
    round((cp.rating - op.rating)::numeric, 5) as rating_gap
  from our_programs op
  join channels c on c.code = p_channel_code
  join competitor_program_ratings cp
    on cp.our_channel_id = c.id
    and cp.broadcast_date = p_as_of_date
    -- 구간 겹침: 경쟁채널 프로그램 시작이 우리 프로그램 끝보다 이르고, 끝이 우리 프로그램 시작보다 늦으면 "동시간대"
    and cp.start_time < coalesce(op.end_time, op.start_time + interval '1 hour')
    and coalesce(cp.end_time, cp.start_time + interval '1 hour') > op.start_time
  where cp.rating is not null and op.rating is not null
  order by op.start_time, cp.rating desc;
$$;
comment on function get_competitor_program_overlap is 'Page 2 COMPARED WITH?: 우리 채널의 오늘 방영 프로그램과 시간대가 겹치는 등록 경쟁채널 프로그램·시청률을 나란히 보여준다(직접 비교, rating_gap=경쟁채널-우리). Competitor Master에 등록된 채널만 나옴.';

create or replace function get_competitor_top_programs(
  p_channel_code text,
  p_as_of_date date,
  p_limit int default 5
)
returns table (
  competitor_name text,
  program_name text,
  start_time time,
  end_time time,
  rating numeric
)
language sql
stable
as $$
  select cp.competitor_name, cp.program_name, cp.start_time, cp.end_time, cp.rating
  from competitor_program_ratings cp
  join channels c on c.id = cp.our_channel_id
  where c.code = p_channel_code
    and cp.broadcast_date = p_as_of_date
    and cp.rating is not null
  order by cp.rating desc
  limit p_limit;
$$;
comment on function get_competitor_top_programs is 'Page 2 COMPARED WITH?: 그날 등록된 경쟁채널들의 시청률 상위 프로그램 TOP N(우리 프로그램과 무관하게 시장 전체 동향 참고용).';
