-- 사용자 지시(2026-08-21, 기능 #15-11): "COMPARED WITH? — 오늘/어제/당일 직접 지정을 제외한
-- 기간은 해당 기간의 동기간 경쟁사 주요 프로그램 리뷰로 설계, 경쟁 채널 Top 5 프로그램은 해당
-- 기간 상위 Max 5개 채널의 상위 Top 7 프로그램으로 변경." 기존 get_competitor_top_programs는
-- 등록 경쟁채널 전체를 뒤섞어 시청률 상위 N개만 뽑아(어느 채널이 강세인지는 안 보여줌) — 이
-- 함수는 먼저 "기간 평균 시청률이 높은 채널 상위 5개"를 채널 단위로 추리고, 그 5개 채널 안에서만
-- 프로그램 단위 시청률 상위 7개를 뽑는다(같은 채널이 여러 편 들어갈 수 있음, 정렬 기준은 시청률).
create or replace function get_competitor_period_top_programs(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_channel_limit int default 5,
  p_program_limit int default 7
)
returns table (
  competitor_name text,
  channel_period_avg_rating numeric,
  channel_rank int,
  program_name text,
  start_time time,
  end_time time,
  rating numeric,
  broadcast_date date
)
language sql
stable
as $$
  with top_channels as (
    select cr.competitor_name, avg(cr.rating) as period_avg_rating,
      row_number() over (order by avg(cr.rating) desc) as rn
    from competitor_ratings cr
    join targets t on t.id = cr.target_id
    join channels c on c.code = p_channel_code
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = c.id
    where t.label = p_target_label
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between p_date_from and p_date_to
    group by cr.competitor_name
    order by period_avg_rating desc
    limit p_channel_limit
  )
  select
    tc.competitor_name,
    round(tc.period_avg_rating::numeric, 5),
    tc.rn::int,
    cp.program_name,
    cp.start_time,
    cp.end_time,
    cp.rating,
    cp.broadcast_date
  from top_channels tc
  join competitor_program_ratings cp on cp.competitor_name = tc.competitor_name
  join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
  where cp.broadcast_date between p_date_from and p_date_to
    and cp.rating is not null
  order by cp.rating desc
  limit p_program_limit;
$$;
comment on function get_competitor_period_top_programs is 'Page 2 COMPARED WITH?(기간 모드): 해당 기간 평균 시청률이 높은 등록 경쟁채널 상위 N개(기본 5) 안에서, 프로그램 단위 시청률 상위 M개(기본 7)를 뽑는다(2026-08-21, 오늘/어제/당일 직접 지정 이외 기간용).';
