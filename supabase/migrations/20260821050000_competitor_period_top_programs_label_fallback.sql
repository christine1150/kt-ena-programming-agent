-- 버그 수정(2026-08-21): get_competitor_period_top_programs가 matchedTargetLabel(자사 KPI
-- 라벨)을 competitor_ratings 조회에 그대로 썼는데, 실측 확인 결과 ONCE("National 유료방송가입
-- 가구")처럼 기존에 통용되던 "수도권/National 접두어→개인" 치환 규칙(get_competitor_insight_report/
-- get_competitive_pressure가 쓰는 방식)으로도 맞지 않는 표기 차이가 있었다(ONCE의 실제
-- competitor_ratings 라벨은 "수도권 유료방송가입가구"로 확인됨 — 접두어 치환 규칙 무관하게
-- 다름). 특정 치환 규칙에 의존하는 대신, 1차로 자사 라벨을 그대로 시도하고 매칭되는 데이터가
-- 없으면 2차로 "이 채널의 등록 경쟁채널들이 그 기간에 실제로 쓴 target_id 중 가장 많이 쓰인 것"을
-- 데이터에서 직접 찾아 대체한다(더 강건함 — 채널마다 다른 표기 규칙을 예측할 필요가 없음).
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
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_resolved_target_id uuid;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;

  v_resolved_target_id := v_target_id;
  if v_resolved_target_id is null or not exists (
    select 1 from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.broadcast_date between p_date_from and p_date_to
  ) then
    select cr.target_id into v_resolved_target_id
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.broadcast_date between p_date_from and p_date_to
    group by cr.target_id
    order by count(*) desc
    limit 1;
  end if;

  return query
  with top_channels as (
    select cr.competitor_name, avg(cr.rating) as period_avg_rating,
      row_number() over (order by avg(cr.rating) desc) as rn
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
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
end;
$$;
comment on function get_competitor_period_top_programs is 'Page 2 COMPARED WITH?(기간 모드): 해당 기간 평균 시청률이 높은 등록 경쟁채널 상위 N개(기본 5) 안에서, 프로그램 단위 시청률 상위 M개(기본 7)를 뽑는다. 자사 타깃 라벨이 competitor_ratings 표기와 다르면(채널마다 규칙이 달라 접두어 치환으로 예측 불가) 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다(2026-08-21 수정).';
