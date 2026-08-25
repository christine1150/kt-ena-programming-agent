-- 후속 수정(2026-08-25, 방금 배포한 20260825130000의 동의어 변환식이 틀렸음을 배포 직후 재검증
-- 하다 발견): p_target_label로 실제 들어오는 값은 "수도권 2049"(타깃상세 시트 표기, 이미 "개인"이
-- 빠진 형태)인데, regexp_replace(p_target_label, '^수도권\s*', '')는 "수도권 " 접두어만 떼어내
-- "2049"만 남긴다 — 정작 필요한 랭킹 시트 표기 "개인2049"가 안 나와 동의어 매칭이 항상 실패하고
-- 여전히 최후 수단 폴백(엉뚱한 타깃)으로 빠지고 있었다(재검증: resolved_target_label이 여전히
-- "여자3039"로 나옴). "수도권 2049"→"개인2049"로 검증된(2026-08-25, ENA Drama 실측 완전 일치)
-- 정확한 매핑 하나만 명시적으로 고정한다 — 다른 타깃까지 일반화된 규칙으로 확장하지 않는다
-- (검증 안 된 매핑을 만들지 않는다는 원칙, 필요해지면 그때 실측 확인 후 추가).
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
  top_program_air_count int,
  resolved_target_label text
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_resolved_target_id uuid;
  v_resolved_target_label text;
  v_synonym_label text;
  v_synonym_target_id uuid;
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
    -- 1순위: 검증된 동의어 하나만 명시(2026-08-25 실측 검증됨). 다른 타깃은 아직 검증 안 됐으므로
    -- 여기 추가하지 않는다 — 필요해지면 그때 실측 확인 후 case 분기를 늘린다.
    v_synonym_label := case p_target_label when '수도권 2049' then '개인2049' else null end;
    if v_synonym_label is not null then
      select id into v_synonym_target_id from targets where label = v_synonym_label;
    end if;
    if v_synonym_target_id is not null and exists (
      select 1 from competitor_ratings cr
      join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
      where cr.target_id = v_synonym_target_id
        and cr.source_type = 'nielsen_daily'
        and cr.broadcast_date between v_date_from and p_as_of_date
    ) then
      v_resolved_target_id := v_synonym_target_id;
    else
      -- 2순위(최후 수단): 그 경쟁채널들이 실제로 가장 많이 가진 target_id.
      select cr.target_id into v_resolved_target_id
      from competitor_ratings cr
      join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
      where cr.source_type = 'nielsen_daily'
        and cr.broadcast_date between v_date_from and p_as_of_date
      group by cr.target_id
      order by count(*) desc
      limit 1;
    end if;
  end if;

  select label into v_resolved_target_label from targets where id = v_resolved_target_id;

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
    tp.air_count as top_program_air_count,
    v_resolved_target_label as resolved_target_label
  from period_rows pr
  left join baseline bl on bl.competitor_name = pr.competitor_name
  left join top_program tp on tp.competitor_name = pr.competitor_name
  order by pr.best_rank asc nulls last;
end;
$$;
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, 최근 12주 평균 대비 등락과 기간 내 최고 성적 프로그램까지 제공. 자사 KPI 타깃(p_target_label)에 해당하는 competitor_ratings가 없으면 (1) "수도권 2049"→"개인2049"처럼 실측 검증된 동의어로 먼저 재시도하고 (2) 그래도 없으면 그 경쟁채널들이 실제로 가장 많이 가진 target_id로 대체하며, 어느 경우든 실제 사용된 타깃 라벨을 resolved_target_label로 항상 반환한다(2026-08-25 — Group A 채널이 매번 조용히 엉뚱한 타깃으로 비교되던 버그 수정).';
