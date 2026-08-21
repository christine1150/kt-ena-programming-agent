-- 버그 수정(2026-08-21, 사용자 제보 "COMPARED WITH?에서 ENA의 오늘 최고 성적 프로그램은 안
-- 나와"): ENA는 Competitor Master 시트에 ENA Play/ENA Drama의 등록 경쟁채널로도 올라가 있다
-- (같은 KT ENA 계열이라 시트에 함께 실린 것으로 보임, CLAUDE.md에 이미 기록된 사실). 그런데
-- ENA Play/ENA Drama 페이지에서 ENA가 "경쟁채널"로 표시될 때 최고 성적 프로그램이 항상 null이었다
-- — 원인은 competitor_program_ratings(§1.2 "OOO경쟁채널시청률" 시트 파싱 결과)에 애초에 ENA의
-- 프로그램 스케줄이 들어갈 자리가 없기 때문이다: ENA는 우리가 직접 분석하는 자사 채널이라 그
-- 프로그램 데이터는 항상 ENA 자신의 §1.3 타깃상세/자사블록에서 ratings/programs 테이블로
-- 들어가고, 다른 채널의 "경쟁채널" 시트에 프로그램 단위로 잡히는 일이 없다(실측 확인: 2026-08-20
-- 기준 competitor_program_ratings에 competitor_name='ENA'인 행이 0건).
--
-- 고쳤다: top_program_agg에 데이터가 없는 competitor_name이 실제로 우리 분석 대상 채널(channels
-- 테이블에 code/name이 일치)이면, 그 채널 자신의 ratings/programs에서(자사 KPI 타깃 기준) 같은
-- 기간 최고 성적 프로그램을 대신 가져오는 폴백을 추가한다 — "ENA"를 하드코딩하지 않고 competitor_
-- name이 우리 자사 채널 이름/코드와 일치하는 모든 경우에 일반적으로 적용된다.
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
  -- 경쟁채널명이 사실 우리 자사 채널(예: ENA Play/ENA Drama 입장에서의 "ENA")과 같으면, 그
  -- 채널의 원본 §1.2 경쟁채널 시트에는 프로그램 데이터가 없으므로 자사 ratings/programs에서
  -- 그 채널 자신의 KPI 타깃 기준 최고 성적 프로그램을 대신 가져온다. top_program_agg에 이미
  -- 데이터가 있는 competitor_name은 건드리지 않는다(진짜 제3자 경쟁채널의 정상 데이터 보존).
  self_channel_fallback as (
    select
      pr.competitor_name,
      p.canonical_name as program_name,
      avg(r.rating) as avg_rating,
      count(*)::int as air_count,
      min(r.start_time) as sample_start_time
    from period_rows pr
    join channels sc on sc.name = pr.competitor_name or sc.code = pr.competitor_name
    join targets t on t.label = (
      case when sc.primary_target like '%유료방송가입가구%' then '전국 유료가구'
      else replace(sc.primary_target, '개인', '') end
    )
    join ratings r on r.channel_id = sc.id and r.target_id = t.id
    join programs p on p.id = r.program_id
    where r.source_type = 'nielsen_daily'
      and r.broadcast_date between v_date_from and p_as_of_date
      and r.program_id is not null
      and not exists (select 1 from top_program_agg tpa where tpa.competitor_name = pr.competitor_name)
    group by pr.competitor_name, p.canonical_name
  ),
  top_program_agg_combined as (
    select * from top_program_agg
    union all
    select * from self_channel_fallback
  ),
  top_program as (
    select distinct on (tpac.competitor_name) tpac.competitor_name, tpac.program_name, tpac.avg_rating, tpac.air_count, tpac.sample_start_time
    from top_program_agg_combined tpac
    order by tpac.competitor_name, tpac.avg_rating desc
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
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, 최근 12주 평균 대비 등락과 기간 내 최고 성적 프로그램(제목+그 기간 평균 시청률+방영 횟수)까지 제공. 최고 성적 프로그램은 프로그램명 단위로 그 기간 모든 방영분을 평균 내어 고른다. "개표방송" 포함 프로그램명은 파트 표기를 잘라 하나의 이벤트로 합산한다. 경쟁채널명이 우리 자사 채널(예: ENA Play 입장의 "ENA")과 같으면 그 채널 자신의 ratings/programs에서 최고 성적 프로그램을 대신 가져온다(2026-08-21 — 자사 채널은 경쟁채널 시트에 프로그램 데이터가 없어 항상 null이던 버그 수정). 단일 일자 조회만 방영 시각을 함께 반환. 자사 타깃 라벨이 competitor_ratings 표기와 다르면 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다.';
