-- 버그 수정(2026-08-25, 사용자 제보 "COMPARED WITH?에서 DRAMAcube가 0으로 나오고, 각 채널의
-- 시청률도 이상해" 조사 결과): ENA/ENA Drama/ENA Play(Group A, KPI="수도권 2049")는 등록 경쟁채널
-- (JTBC2/Dramax/DRAMAcube/SBS funE/KBS JOY/tvN SHOW/MBC드라마넷 등) 중 "수도권 2049" target_id로
-- 저장된 competitor_ratings 행이 단 하나도 없다(실측 확인, 2026-08-25) — CLAUDE.md에 이미 문서화된
-- "Channel Master('수도권 개인2049') / 타깃상세 시트('수도권 2049') / 랭킹 시트('개인2049')" 3중
-- 표기 차이 중, "랭킹 시트" 표기(개인2049, "수도권" 접두어 없음)에 대한 동의어 매핑이 targetResolution.ts
-- 어디에도 실제로 구현돼 있지 않았던 게 원인이다(문서는 있는데 코드가 없었음). competitor_ratings는
-- ①전체 채널 랭킹 시트(parseRankSheet) 파싱 결과라 정확히 이 "랭킹 시트" 표기를 쓴다.
--
-- 이 함수는 그동안 "정확히 일치하는 target_id가 없으면, 그 경쟁채널들이 그날 가장 많이 가진
-- target_id로 대체"하는 임시방편 폴백만 갖고 있었다 — Group A 채널들은 항상 이 폴백을 타면서,
-- 그날그날 우연히 표본이 가장 많은 엉뚱한 타깃(예: 여자3039, 수도권 유료방송가입가구 등, 날짜마다
-- 바뀔 수 있음)로 조용히 비교되고 있었다. 화면은 "경쟁채널과 비교하면?"이라고만 보여줄 뿐 실제
-- 비교 타깃을 전혀 알려주지 않아, "우리 채널(수도권 2049 기준)"과 "경쟁채널(엉뚱한 타깃 기준)"이
-- 같은 표에 섞여 나온 것 — 이게 "시청률이 이상하다" 제보의 진짜 원인이다.
--
-- 검증(2026-08-25): ENA Drama 자사 데이터에서 "개인2049"(랭킹 시트, ratings.target_id)와
-- "수도권 2049"(타깃상세 시트, ratings.target_id)의 일별 시청률이 2026-08-18~24 전체 기간 완전히
-- 동일함을 확인 — 즉 "수도권 " 접두어만 뗀 "개인2049"가 진짜 동의어임이 실측으로 확인됐다.
--
-- 고친 내용: (1) 정확히 일치 실패 시, 먼저 "수도권 " 접두어를 뗀 라벨로 재시도(검증된 동의어) —
-- 이 경우도 실패해야만 기존 최후 수단 폴백(그날 가장 표본이 많은 target_id)을 쓴다. (2) 실제로
-- 어떤 타깃으로 비교했는지 resolved_target_label 컬럼으로 항상 함께 반환 — 폴백이 발동된 경우
-- 화면에서 안내 문구를 보여줄 수 있게 한다(반환 타입이 바뀌어 drop 후 재생성 필요).
drop function if exists get_competitor_insight_report(text, text, date, int, date);

create function get_competitor_insight_report(
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
    -- 1순위: 검증된 동의어("수도권 " 접두어 제거, 예: "수도권 개인2049"→"개인2049") 먼저 시도.
    select id into v_synonym_target_id from targets where label = regexp_replace(p_target_label, '^수도권\s*', '');
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
    tp.air_count as top_program_air_count,
    v_resolved_target_label as resolved_target_label
  from period_rows pr
  left join baseline bl on bl.competitor_name = pr.competitor_name
  left join top_program tp on tp.competitor_name = pr.competitor_name
  order by pr.best_rank asc nulls last;
end;
$$;
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, 최근 12주 평균 대비 등락과 기간 내 최고 성적 프로그램까지 제공. 자사 KPI 타깃(p_target_label)에 해당하는 competitor_ratings가 없으면 (1) "수도권 " 접두어를 뗀 검증된 동의어로 먼저 재시도하고 (2) 그래도 없으면 그 경쟁채널들이 실제로 가장 많이 가진 target_id로 대체하며, 어느 경우든 실제 사용된 타깃 라벨을 resolved_target_label로 항상 반환한다(2026-08-25 — Group A 채널이 매번 조용히 엉뚱한 타깃으로 비교되던 버그 수정, CLAUDE.md 문서화된 "랭킹 시트 개인2049" 동의어를 실제로 구현).';
