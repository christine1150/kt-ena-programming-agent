-- 버그 수정(2026-08-21, 직전 마이그레이션 20260821100000 직후 즉시 발견): plpgsql 함수에서
-- `returns table(competitor_name text, program_name text, ...)`의 OUT 컬럼명이 함수 본문 안에서
-- 암묵적으로 변수처럼 취급돼, hour_mode CTE의 `distinct on (competitor_name, program_name) ...
-- order by competitor_name, program_name, ...`처럼 테이블 별칭 없이 쓴 부분이 "column reference
-- is ambiguous"로 실패했다(실측 확인: RPC 직접 호출 시 42702 에러). 모든 컬럼을 hc. 별칭으로
-- 명시해 해결한다.
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
  program_avg_rating numeric,
  air_count int,
  typical_start_hour int
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
  ),
  program_avg as (
    select cp.competitor_name, cp.program_name,
      avg(cp.rating) as program_avg_rating,
      count(*)::int as air_count
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    join top_channels tc on tc.competitor_name = cp.competitor_name
    where cp.broadcast_date between p_date_from and p_date_to
      and cp.rating is not null
    group by cp.competitor_name, cp.program_name
  ),
  hour_counts as (
    select cp.competitor_name, cp.program_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hr,
      count(*) as cnt
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    join top_channels tc on tc.competitor_name = cp.competitor_name
    where cp.broadcast_date between p_date_from and p_date_to
      and cp.rating is not null
    group by cp.competitor_name, cp.program_name, hr
  ),
  hour_mode as (
    select distinct on (hc.competitor_name, hc.program_name) hc.competitor_name, hc.program_name, hc.hr
    from hour_counts hc
    order by hc.competitor_name, hc.program_name, hc.cnt desc, hc.hr
  )
  select
    tc.competitor_name,
    round(tc.period_avg_rating::numeric, 5),
    tc.rn::int,
    pa.program_name,
    round(pa.program_avg_rating::numeric, 5),
    pa.air_count,
    hm.hr
  from top_channels tc
  join program_avg pa on pa.competitor_name = tc.competitor_name
  left join hour_mode hm on hm.competitor_name = pa.competitor_name and hm.program_name = pa.program_name
  order by pa.program_avg_rating desc
  limit p_program_limit;
end;
$$;
comment on function get_competitor_period_top_programs is 'Page 2 COMPARED WITH?(기간 모드): 시청률 상위 등록 경쟁채널(기본 5개) 안에서, 프로그램별 "그 기간 평균 시청률"이 높은 순 상위 M개(기본 7)를 뽑는다(2026-08-21 재설계 — 개별 방영일 단위가 아니라 프로그램 단위 평균으로 바꿔 일회성 반짝 편성이 아니라 꾸준히 강했던 프로그램을 반영하고, group by로 같은 프로그램 중복 노출도 없앴다). 자사 타깃 라벨이 competitor_ratings 표기와 다르면 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다.';
