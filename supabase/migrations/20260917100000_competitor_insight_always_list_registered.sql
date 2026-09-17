-- 버그 수정(2026-09-17, 사용자 제보 "ONCE 경쟁채널에 KBS Story가 추가됐는데, 세부 내역이
-- 없더라도 가진 모든 DB 내에서 모든 기간의 경쟁채널로 인식하게 해줘") — 지금까지
-- get_competitor_insight_report()의 period_rows는 competitor_ratings(Nielsen 외부 경쟁채널
-- 시트)에 그 기간·타깃 조합의 행이 "실제로 존재하는" 경쟁채널만 담았다(nielsen_period_rows가
-- competitor_ratings를 INNER JOIN으로 몰고 갔기 때문). 그래서 KBS Story처럼 등록은 됐지만
-- 선택한 기간에 아직 데이터가 없는(또는 그 기간엔 원본 파일 자체에 등장하지 않는) 경쟁채널은
-- COMPARED WITH? 표에서 통째로 사라졌다 — "등록된 경쟁채널"이라는 사실 자체가 기간별 데이터
-- 유무에 좌우된 것이 문제였다.
--
-- 고침: period_rows를 competitors 테이블(registered_competitors, 기간과 무관한 등록 목록)이
-- 직접 구동하도록 바꾸고, Nielsen 데이터(nielsen_period_rows)와 자사 채널 폴백
-- (self_channel_period_fallback)은 LEFT JOIN + coalesce로만 값을 채운다. 이러면 데이터가 아예
-- 없는 기간에도 등록된 경쟁채널명 자체는 항상 행으로 나오고(시청률/등위는 null → 화면에서
-- "-"로 표시), 데이터가 있는 기간·경쟁채널은 기존과 동일하게 값이 채워진다. 나머지 CTE(baseline,
-- top_program 계열)는 이미 LEFT JOIN으로 period_rows를 참조하고 있어 그대로 둔다.
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
    -- 등록된 경쟁채널 전체를 기준으로 삼고(rc), 실데이터는 있으면 채우고 없으면 null로 둔다
    -- (2026-09-17 수정 — 이전엔 competitor_ratings에 행이 있어야만 여기 등장했다).
    select
      rc.competitor_name,
      coalesce(npr.period_rating, scpf.period_rating) as period_rating,
      coalesce(npr.best_rank, scpf.best_rank) as best_rank
    from registered_competitors rc
    left join nielsen_period_rows npr on npr.competitor_name = rc.competitor_name
    left join self_channel_period_fallback scpf on scpf.competitor_name = rc.competitor_name
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
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, baseline 대비 등락과 기간 내 최고 성적 프로그램까지 제공. 자사 KPI 타깃 동의어 대체는 기존 그대로. p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 baseline만 "그 요일의 최근 N주"로(오늘 자신은 제외), 없으면 기존 p_baseline_days 트레일링 창 그대로. 등록 경쟁채널이 Nielsen 경쟁채널 시트에 없는 자사 채널(예: ENA Play)이면 그 채널 자신의 ratings에서 시청률·등위를 끌어온다(2026-09-10, self-channel period fallback). 선택한 기간에 데이터가 아예 없는 등록 경쟁채널(예: 최근 등록된 KBS Story를 과거 기간으로 조회)도 시청률/등위 null로 목록에는 항상 포함한다(2026-09-17, 등록=인식 원칙).';
