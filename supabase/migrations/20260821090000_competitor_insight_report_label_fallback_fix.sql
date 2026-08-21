-- 버그 수정(2026-08-21, 사용자 제보 "ENA의 경쟁채널 자료가 안 보여"): get_competitor_insight_report는
-- 2026-08-20 처음에 "수도권/National→개인" 접두어 치환 폴백으로 한 번 고쳤었는데(20260820010000),
-- 바로 다음 마이그레이션(20260820050000)이 기간 범위(p_date_from) 지원을 추가하며 함수를
-- language sql로 통째로 다시 만들면서 그 폴백 로직이 통째로 사라졌다(순수 회귀 버그) — 그 결과
-- ENA/ENA Play(자사 라벨 "수도권 2049" vs competitor_ratings 라벨 "개인2049")처럼 표기가 다른
-- 채널은 COMPARED WITH?가 항상 "등록 경쟁채널 데이터가 없습니다"로 나왔다(실측: RPC 직접 호출로
-- 재현 확인, 원본 데이터 자체는 9건 정상 존재).
--
-- 이번엔 고정 치환 규칙 대신 get_competitor_period_top_programs와 동일한 더 강건한 방식을
-- 쓴다 — 자사 라벨을 그대로 시도하고, 매칭되는 데이터가 없으면 "이 채널의 등록 경쟁채널들이
-- 그 기간에 실제로 쓴 target_id 중 가장 많이 쓰인 것"을 데이터에서 직접 찾아 대체한다(채널마다
-- 다른 표기 규칙을 예측할 필요가 없어 더 안전함). 기간 범위(p_date_from) 지원은 그대로 유지.
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
  top_program_rating numeric
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_resolved_target_id uuid;
  v_date_from date;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;
  v_date_from := coalesce(p_date_from, p_as_of_date);

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
  top_program as (
    select distinct on (cp.competitor_name) cp.competitor_name, cp.program_name, cp.start_time, cp.rating
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    where cp.broadcast_date between v_date_from and p_as_of_date
      and cp.rating is not null
    order by cp.competitor_name, cp.rating desc
  )
  select
    pr.competitor_name,
    pr.best_rank as today_rank,
    round(pr.period_rating::numeric, 5) as today_rating,
    round(bl.avg_rating::numeric, 5) as baseline_avg_rating,
    case when bl.avg_rating is not null and bl.avg_rating <> 0
      then round(((pr.period_rating - bl.avg_rating) / bl.avg_rating * 100)::numeric, 1) else null end as delta_pct,
    tp.program_name as top_program_name,
    tp.start_time as top_program_start_time,
    round(tp.rating::numeric, 5) as top_program_rating
  from period_rows pr
  left join baseline bl on bl.competitor_name = pr.competitor_name
  left join top_program tp on tp.competitor_name = pr.competitor_name
  order by pr.best_rank asc nulls last;
end;
$$;
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, 최근 12주 평균 대비 등락과 최고 성적 프로그램(시간대)까지 제공. p_date_from을 주면 그 기간 평균/최고순위로 집계(baseline은 p_date_from 이전으로 겹치지 않게 계산), 안 주면 p_as_of_date 하루만. 자사 타깃 라벨이 competitor_ratings 표기와 다르면(채널마다 규칙이 달라 접두어 치환으로 예측 불가) 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다(2026-08-21 수정 — 이전 회귀 버그로 폴백 로직이 사라졌던 것을 복구 + 더 강건한 방식으로 교체).';
