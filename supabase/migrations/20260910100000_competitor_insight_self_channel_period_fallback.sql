-- 버그 수정(2026-09-10, 사용자 제보 "ENA Drama 경쟁채널에 ENA Play를 등록했는데 COMPARED
-- WITH?에 안 나옴") — ENA Play는 우리 자사 채널이라 Nielsen의 "OOO경쟁채널시청률" 시트
-- (competitor_ratings/competitor_program_ratings가 그 시트에서 채워짐)에는 애초에 등장하지
-- 않는다. 그 시트는 외부 경쟁채널만 다루기 때문이다. 이 함수는 이미 top_program 한 곳에서만
-- "경쟁채널명이 우리 자사 채널명과 같으면 그 채널 자신의 ratings에서 값을 끌어온다"는
-- self_channel_fallback을 쓰고 있었는데, 그 fallback은 period_rows(오늘 시청률·등위)가
-- 아니라 top_program_agg 쪽에서만 적용됐다 — 그리고 self_channel_fallback 자체가
-- `from period_rows pr`로 시작해 period_rows에 없는 경쟁채널은애초에 거기 도달하지도
-- 못한다. 즉 competitor_ratings에 전혀 없는 자사 채널(ENA Play처럼 이번에 처음 등록된
-- 경우)은 period_rows 단계에서부터 통째로 빠져, 최종 결과에 아예 나타나지 않았다.
--
-- 고침: period_rows·baseline 각각에 "등록된 경쟁채널 중 Nielsen 경쟁채널 데이터가 없고,
-- 우리 자사 채널명과 일치하는 것"을 그 채널 자신의 ratings(program_id is null, 채널 단위
-- 일별 행)에서 집계해 채워 넣는 self-channel fallback을 추가한다. 이러면 그 경쟁채널이
-- period_rows에 들어오게 되고, 기존 top_program 쪽 self_channel_fallback도 자동으로 함께
-- 작동한다(그쪽은 이미 period_rows를 통해서만 대상을 찾으므로 추가 수정 불필요).
--
-- 시청률과 등위는 타깃 라벨 표기가 서로 다르다(targetResolution.ts, 2026-08-25 실측 검증):
--   - 시청률(타깃상세 시트 표기): "수도권 개인2049" → "수도권 2049"("개인"만 빠짐)
--   - 등위(랭킹 시트 표기, ratings.rank가 채워진 행): "수도권 개인2049" → "개인2049"
--     ("수도권 " 접두어가 빠짐). 가구 KPI 채널("...유료방송가입가구")은 랭킹 시트도 타깃상세
--     시트도 아닌 세 번째 표기("전국 유료가구"/원문 그대로)라 이미 있던 case 분기를 그대로 재사용한다.
-- 시청률·등위가 서로 다른 target_id에서 나오므로 한 조인에 같이 넣으면 행이 곱해져 평균이
-- 틀어진다 — 그래서 두 개의 별도 CTE(self_channel_rating/self_channel_rank)로 각각
-- 집계한 뒤 경쟁채널명 기준으로 다시 합친다.
create or replace function get_competitor_insight_report(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_baseline_days int default 84,
  p_date_from date default null,
  p_target_dow int default null,
  p_target_weeks int default null
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
  with registered_competitors as (
    select comp.competitor_name
    from competitors comp
    where comp.channel_id = v_channel_id
  ),
  nielsen_period_rows as (
    select cr.competitor_name, avg(cr.rating) as period_rating, min(cr.rank) as best_rank
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between v_date_from and p_as_of_date
    group by cr.competitor_name
  ),
  self_channel_rating as (
    select rc.competitor_name, avg(rr.rating) as period_rating
    from registered_competitors rc
    join channels sc on sc.name = rc.competitor_name or sc.code = rc.competitor_name
    join targets rt on rt.label = (
      case when sc.primary_target like '%유료방송가입가구%' then '전국 유료가구'
      else replace(sc.primary_target, '개인', '') end
    )
    join ratings rr on rr.channel_id = sc.id and rr.target_id = rt.id
    where rr.source_type = 'nielsen_daily'
      and rr.program_id is null
      and rr.broadcast_date between v_date_from and p_as_of_date
      and not exists (select 1 from nielsen_period_rows npr where npr.competitor_name = rc.competitor_name)
    group by rc.competitor_name
  ),
  self_channel_rank as (
    select rc.competitor_name, min(rk.rank) as best_rank
    from registered_competitors rc
    join channels sc on sc.name = rc.competitor_name or sc.code = rc.competitor_name
    join targets kt on kt.label = (
      case when sc.primary_target like '%유료방송가입가구%' then sc.primary_target
      else regexp_replace(sc.primary_target, '^수도권\s*', '') end
    )
    join ratings rk on rk.channel_id = sc.id and rk.target_id = kt.id
    where rk.source_type = 'nielsen_daily'
      and rk.program_id is null
      and rk.broadcast_date between v_date_from and p_as_of_date
      and not exists (select 1 from nielsen_period_rows npr where npr.competitor_name = rc.competitor_name)
    group by rc.competitor_name
  ),
  self_channel_period_fallback as (
    select scr.competitor_name, scr.period_rating, sck.best_rank
    from self_channel_rating scr
    left join self_channel_rank sck on sck.competitor_name = scr.competitor_name
  ),
  period_rows as (
    select * from nielsen_period_rows
    union all
    select * from self_channel_period_fallback
  ),
  nielsen_baseline as (
    select cr.competitor_name, avg(cr.rating) as avg_rating
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.source_type = 'nielsen_daily'
      and (
        (p_target_dow is null or p_target_weeks is null)
          and cr.broadcast_date between (v_date_from - p_baseline_days) and (v_date_from - 1)
        or
        (p_target_dow is not null and p_target_weeks is not null)
          and cr.broadcast_date in (select d from same_dow_dates(v_date_from - 1, p_target_dow, p_target_weeks))
      )
    group by cr.competitor_name
  ),
  self_channel_baseline as (
    select rc.competitor_name, avg(rr.rating) as avg_rating
    from registered_competitors rc
    join channels sc on sc.name = rc.competitor_name or sc.code = rc.competitor_name
    join targets rt on rt.label = (
      case when sc.primary_target like '%유료방송가입가구%' then '전국 유료가구'
      else replace(sc.primary_target, '개인', '') end
    )
    join ratings rr on rr.channel_id = sc.id and rr.target_id = rt.id
    where rr.source_type = 'nielsen_daily'
      and rr.program_id is null
      and (
        (p_target_dow is null or p_target_weeks is null)
          and rr.broadcast_date between (v_date_from - p_baseline_days) and (v_date_from - 1)
        or
        (p_target_dow is not null and p_target_weeks is not null)
          and rr.broadcast_date in (select d from same_dow_dates(v_date_from - 1, p_target_dow, p_target_weeks))
      )
      and not exists (select 1 from nielsen_baseline nb where nb.competitor_name = rc.competitor_name)
    group by rc.competitor_name
  ),
  baseline as (
    select * from nielsen_baseline
    union all
    select * from self_channel_baseline
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
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, baseline 대비 등락과 기간 내 최고 성적 프로그램까지 제공. 자사 KPI 타깃 동의어 대체는 기존 그대로. p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 baseline만 "그 요일의 최근 N주"로(오늘 자신은 제외), 없으면 기존 p_baseline_days 트레일링 창 그대로. 등록 경쟁채널이 Nielsen 경쟁채널 시트에 없는 자사 채널(예: ENA Play)이면 그 채널 자신의 ratings에서 시청률·등위를 끌어온다(2026-09-10, self-channel period fallback).';
