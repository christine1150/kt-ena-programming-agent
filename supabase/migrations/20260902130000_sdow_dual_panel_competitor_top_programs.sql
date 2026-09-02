-- 사용자 지시(2026-09-02): "좌측에 비교 대상(비교대상기간의 평균) / 우측에 오늘을 MoM·WoW와
-- 같은 두 개의 표 형식으로" — TOP20/TOP5/시간대별 그래프는 이미 이 형식으로 반영했고
-- (get_channel_top_programs/get_channel_top_share_programs/get_hourly_rating_pattern이 이미
-- p_target_dow/p_target_weeks를 지원), 남은 한 곳은 COMPARED WITH?의 "동기간 경쟁사 주요
-- 프로그램 리뷰"(get_competitor_period_top_programs) — 기존엔 hasPriorRange(WoW/MoM 등)에서만
-- 좌우 듀얼 패널로 나왔고 SDoW는 대상이 아니었다. 같은 same_dow_dates 패턴으로 확장한다.
-- 새 파라미터 2개가 추가돼 시그니처가 바뀌므로(6개→8개) 먼저 명시적으로 drop(같은 이유로
-- get_hourly_rating_pattern/get_competitor_insight_report 확장 때도 필요했던 안전장치).
drop function if exists get_competitor_period_top_programs(text, text, date, date, int, int);

create or replace function get_competitor_period_top_programs(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_channel_limit int default 5,
  p_program_limit int default 7,
  p_target_dow int default null,
  p_target_weeks int default null
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
      and (
        (p_target_dow is null or p_target_weeks is null) and cr.broadcast_date between p_date_from and p_date_to
        or
        (p_target_dow is not null and p_target_weeks is not null) and cr.broadcast_date in (select d from same_dow_dates(p_date_to, p_target_dow, p_target_weeks))
      )
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
    where cp.rating is not null
      and (
        (p_target_dow is null or p_target_weeks is null) and cp.broadcast_date between p_date_from and p_date_to
        or
        (p_target_dow is not null and p_target_weeks is not null) and cp.broadcast_date in (select d from same_dow_dates(p_date_to, p_target_dow, p_target_weeks))
      )
    group by cp.competitor_name, cp.program_name
  ),
  hour_counts as (
    -- 실측 중 발견한 기존 버그(2026-09-02): 아래 hour_mode의 distinct on/order by가 competitor_name/
    -- program_name을 별칭 없이 그대로 썼는데, 이 함수의 RETURNS TABLE에 같은 이름의 출력 컬럼이
    -- 있어 plpgsql이 "column reference is ambiguous"로 실패했다(memory: RETURNS TABLE 컬럼명과
    -- 겹치는 CTE 컬럼은 반드시 별칭 필요). cn/pn으로 별칭을 줘 충돌 자체를 없앤다.
    select cp.competitor_name as cn, cp.program_name as pn,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hr,
      count(*) as cnt
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    join top_channels tc on tc.competitor_name = cp.competitor_name
    where cp.rating is not null
      and (
        (p_target_dow is null or p_target_weeks is null) and cp.broadcast_date between p_date_from and p_date_to
        or
        (p_target_dow is not null and p_target_weeks is not null) and cp.broadcast_date in (select d from same_dow_dates(p_date_to, p_target_dow, p_target_weeks))
      )
    group by cp.competitor_name, cp.program_name, hr
  ),
  hour_mode as (
    select distinct on (cn, pn) cn, pn, hr
    from hour_counts
    order by cn, pn, cnt desc, hr
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
  left join hour_mode hm on hm.cn = pa.competitor_name and hm.pn = pa.program_name
  order by pa.program_avg_rating desc
  limit p_program_limit;
end;
$$;
comment on function get_competitor_period_top_programs is 'Page 2 COMPARED WITH?(기간 모드): 시청률 상위 등록 경쟁채널(기본 5개) 안에서, 프로그램별 "그 기간 평균 시청률"이 높은 순 상위 M개(기본 7)를 뽑는다. p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 p_date_from~p_date_to 대신 "그 요일의 최근 N주"만 집계 — 없으면(기존 호출부 전부) 기존 날짜 범위 그대로.';
