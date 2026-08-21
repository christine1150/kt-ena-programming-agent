-- 사용자 지시(2026-08-21): "전분기 대비, 전월 대비 등에서 COMPARED WITH?의 '기간 중 최고 성적
-- 프로그램'은 그 기간의 단발성 최고 시청률 1회 방영이 아니라, 채널별 컨텐츠(프로그램) 평균
-- 단위로 반영해 타이틀과 평균 시청률을 보여줄 것." 기존 top_program CTE는 기간 전체에서
-- "단일 방영 중 시청률이 가장 높았던 한 회"를 그대로 골라(distinct on + order by rating desc),
-- 예를 들어 뉴스 프로그램이 어느 하루 우연히 튄 회차 하나가 "전분기 최고 프로그램"으로 뽑히는
-- 문제가 있었다 — 90일 같은 긴 기간일수록 대표성이 떨어진다. 프로그램명(program_name) 기준으로
-- 그 기간 내 모든 방영분을 평균 내고, 평균이 가장 높은 프로그램을 고르도록 바꾼다. 단일 일자
-- 조회(p_date_from 없음)는 그날 하루만 집계되므로 이 방식으로 바꿔도 결과가 사실상 동일하다
-- (그날 같은 프로그램이 여러 번 방영되지 않는 한 평균=그 회차 시청률).
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
  -- 프로그램명 단위로 그 기간 모든 방영분을 평균 낸다(사용자 지시: "채널별 컨텐츠 평균 단위").
  top_program_agg as (
    select
      cp.competitor_name,
      cp.program_name,
      avg(cp.rating) as avg_rating,
      count(*) as air_count,
      min(cp.start_time) as sample_start_time -- 단일 일자 조회에서만 화면에 노출(아래 case 참고)
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    where cp.broadcast_date between v_date_from and p_as_of_date
      and cp.rating is not null
    group by cp.competitor_name, cp.program_name
  ),
  top_program as (
    select distinct on (competitor_name) competitor_name, program_name, avg_rating, air_count, sample_start_time
    from top_program_agg
    order by competitor_name, avg_rating desc
  )
  select
    pr.competitor_name,
    pr.best_rank as today_rank,
    round(pr.period_rating::numeric, 5) as today_rating,
    round(bl.avg_rating::numeric, 5) as baseline_avg_rating,
    case when bl.avg_rating is not null and bl.avg_rating <> 0
      then round(((pr.period_rating - bl.avg_rating) / bl.avg_rating * 100)::numeric, 1) else null end as delta_pct,
    tp.program_name as top_program_name,
    -- 기간(멀티데이) 조회는 여러 방영분의 평균이라 특정 시각 하나로 대표할 수 없어 null(화면은
    -- "타이틀(평균 시청률)"만 보여준다) — 단일 일자 조회만 실제 방영 시각을 보여준다.
    case when v_is_multiday then null else tp.sample_start_time end as top_program_start_time,
    round(tp.avg_rating::numeric, 5) as top_program_rating,
    tp.air_count as top_program_air_count
  from period_rows pr
  left join baseline bl on bl.competitor_name = pr.competitor_name
  left join top_program tp on tp.competitor_name = pr.competitor_name
  order by pr.best_rank asc nulls last;
end;
$$;
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, 최근 12주 평균 대비 등락과 기간 내 최고 성적 프로그램(제목+그 기간 평균 시청률+방영 횟수)까지 제공. p_date_from을 주면 그 기간 평균/최고순위로 집계(baseline은 p_date_from 이전으로 겹치지 않게 계산). 최고 성적 프로그램은 프로그램명 단위로 그 기간 모든 방영분을 평균 내어 고른다(2026-08-21 수정 — 이전엔 단일 방영 1회의 최고 시청률을 그대로 골라 긴 기간일수록 우연한 스파이크가 대표 프로그램으로 뽑히는 문제가 있었음). 단일 일자 조회만 방영 시각을 함께 반환(멀티데이 평균은 시각이 무의미해 null). 자사 타깃 라벨이 competitor_ratings 표기와 다르면 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다.';
