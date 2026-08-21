-- 사용자 지시(2026-08-21): "2025제21대대통령선거개표방송"처럼 개표방송 특수 방송은 "특집뉴스데스크"/
-- "2부"/"4부"/"5부" 등 파트마다 competitor_program_ratings.program_name이 달라, 프로그램 단위로
-- 평균 내는 COMPARED WITH? 기간 분석에서 같은 1회성 이벤트가 여러 개의 서로 다른 "프로그램"으로
-- 쪼개져 상위권을 도배하는 문제가 있었다(실측: ENA 전년 동기 분석에서 MBC 개표방송 파트 4개가
-- Top7 중 4자리를 차지). "개표방송은 모든 채널에서 하나의 프로그램으로 인식"하도록, program_name에
-- "개표방송"이 포함되면 그 뒤에 붙는 파트/부제를 잘라내고 "...개표방송"까지만 남긴 이름으로
-- 묶는다 — 특정 연도·대수를 하드코딩하지 않아 앞으로의 선거 개표방송에도 그대로 적용된다.
-- get_competitor_period_top_programs(기간 모드 Top7)와 get_competitor_insight_report(COMPARED
-- WITH? 기간 중 최고 성적 프로그램, 2026-08-21에 프로그램 단위 평균으로 바뀐 것과 같은 이유로
-- 영향받음) 둘 다 고친다.

drop function if exists get_competitor_period_top_programs(text, text, date, date, int, int);

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
    -- "개표방송" 포함 프로그램은 뒤에 붙는 파트 표기를 잘라 하나의 이벤트로 묶는다.
    select cp.competitor_name,
      regexp_replace(cp.program_name, '(개표방송).*$', '\1') as program_name,
      avg(cp.rating) as program_avg_rating,
      count(*)::int as air_count
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    join top_channels tc on tc.competitor_name = cp.competitor_name
    where cp.broadcast_date between p_date_from and p_date_to
      and cp.rating is not null
    group by cp.competitor_name, regexp_replace(cp.program_name, '(개표방송).*$', '\1')
  ),
  hour_counts as (
    select cp.competitor_name,
      regexp_replace(cp.program_name, '(개표방송).*$', '\1') as program_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hr,
      count(*) as cnt
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    join top_channels tc on tc.competitor_name = cp.competitor_name
    where cp.broadcast_date between p_date_from and p_date_to
      and cp.rating is not null
    group by cp.competitor_name, regexp_replace(cp.program_name, '(개표방송).*$', '\1'), hr
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
comment on function get_competitor_period_top_programs is 'Page 2 COMPARED WITH?(기간 모드): 시청률 상위 등록 경쟁채널(기본 5개) 안에서, 프로그램별 "그 기간 평균 시청률"이 높은 순 상위 M개(기본 7)를 뽑는다. "개표방송" 포함 프로그램명은 뒤에 붙는 파트 표기(N부/특집뉴스데스크 등)를 잘라 하나의 이벤트로 합산한다(2026-08-21 — 1회성 특수 방송이 파트별로 쪼개져 Top7을 도배하는 문제 수정). 자사 타깃 라벨이 competitor_ratings 표기와 다르면 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다.';

drop function if exists get_competitor_insight_report(text, text, date, int, date);

create or replace function get_competitor_insight_report(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_baseline_days int default 84,
  p_date_from date default null
)
returns table (
  competitor_name text,
  today_rank int,
  today_rating numeric,
  baseline_avg_rating numeric,
  delta_pct numeric,
  top_program_name text,
  top_program_start_time time,
  top_program_rating numeric,
  top_program_air_count int
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_resolved_target_id uuid;
  v_date_from date;
  v_is_multiday boolean;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;
  v_date_from := coalesce(p_date_from, p_as_of_date);
  v_is_multiday := v_date_from <> p_as_of_date;

  select id into v_target_id from targets where label = p_target_label;

  v_resolved_target_id := v_target_id;
  if v_resolved_target_id is null or not exists (
    select 1 from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between v_date_from and p_as_of_date
  ) then
    select cr.target_id into v_resolved_target_id
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between v_date_from and p_as_of_date
    group by cr.target_id
    order by count(*) desc
    limit 1;
  end if;

  return query
  with period_rows as (
    select cr.competitor_name, avg(cr.rating) as period_rating, min(cr.rank) as best_rank
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between v_date_from and p_as_of_date
    group by cr.competitor_name
  ),
  baseline as (
    select cr.competitor_name, avg(cr.rating) as avg_rating
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between (v_date_from - p_baseline_days) and (v_date_from - 1)
    group by cr.competitor_name
  ),
  top_program_agg as (
    -- "개표방송" 포함 프로그램은 뒤에 붙는 파트 표기를 잘라 하나의 이벤트로 묶는다(위
    -- get_competitor_period_top_programs와 동일한 정규화, 2026-08-21).
    select
      cp.competitor_name,
      regexp_replace(cp.program_name, '(개표방송).*$', '\1') as program_name,
      avg(cp.rating) as avg_rating,
      count(*)::int as air_count,
      min(cp.start_time) as sample_start_time
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    where cp.broadcast_date between v_date_from and p_as_of_date
      and cp.rating is not null
    group by cp.competitor_name, regexp_replace(cp.program_name, '(개표방송).*$', '\1')
  ),
  top_program as (
    select distinct on (tpa.competitor_name) tpa.competitor_name, tpa.program_name, tpa.avg_rating, tpa.air_count, tpa.sample_start_time
    from top_program_agg tpa
    order by tpa.competitor_name, tpa.avg_rating desc
  )
  select
    pr.competitor_name,
    pr.best_rank as today_rank,
    round(pr.period_rating::numeric, 5) as today_rating,
    round(bl.avg_rating::numeric, 5) as baseline_avg_rating,
    case when bl.avg_rating is not null and bl.avg_rating <> 0
      then round(((pr.period_rating - bl.avg_rating) / bl.avg_rating * 100)::numeric, 1) else null end as delta_pct,
    tp.program_name as top_program_name,
    case when v_is_multiday then null else tp.sample_start_time end as top_program_start_time,
    round(tp.avg_rating::numeric, 5) as top_program_rating,
    tp.air_count as top_program_air_count
  from period_rows pr
  left join baseline bl on bl.competitor_name = pr.competitor_name
  left join top_program tp on tp.competitor_name = pr.competitor_name
  order by pr.best_rank asc nulls last;
end;
$$;
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, 최근 12주 평균 대비 등락과 기간 내 최고 성적 프로그램(제목+그 기간 평균 시청률+방영 횟수)까지 제공. 최고 성적 프로그램은 프로그램명 단위로 그 기간 모든 방영분을 평균 내어 고른다. "개표방송" 포함 프로그램명은 파트 표기를 잘라 하나의 이벤트로 합산한다(2026-08-21). 단일 일자 조회만 방영 시각을 함께 반환. 자사 타깃 라벨이 competitor_ratings 표기와 다르면 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다.';
