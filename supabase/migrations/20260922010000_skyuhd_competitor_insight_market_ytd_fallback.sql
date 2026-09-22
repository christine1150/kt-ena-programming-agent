-- 사용자 제보(2026-09-20/22): "COMPARED WITH?에서 ASIA UHD·SBS F!L UHD(→SBS NEX로 개명)만
-- 시청률/순위가 '—'로 나온다." 원인 확인 결과, get_competitor_insight_report()의
-- nielsen_period_rows는 competitor_ratings(source_type='nielsen_daily')에서 값을 찾는데,
-- skyUHD의 등록 경쟁채널 중 UXN/UMAX/UHD Dream TV는 다른 채널의 Nielsen 경쟁채널 시트에
-- 우연히 함께 등장해 데이터가 있었지만, ASIA UHD/SBS NEX는 어떤 채널의 Nielsen 시트에도
-- 등장하지 않아 원천적으로 일별 데이터가 없다(실측 확인: competitor_ratings에 두 이름 모두
-- 0건). self_channel_period_fallback도 이 두 채널이 channels 테이블에 별도 채널로 등록돼
-- 있지 않아 적용되지 않는다. 결국 이 둘은 관리자가 올리는 "누적 채널 순위" 파일
-- (market_ytd_rank_snapshot)에만 존재하는데, 지금까지 그 데이터를 끌어오는 경로가 아예
-- 없었다 — 그래서 항상 null(화면엔 "—")이었다.
--
-- 고침: get_competitor_insight_report에 p_market_ytd_target_label 파라미터를 추가하고,
-- nielsen_period_rows·self_channel_period_fallback 둘 다 값이 없는 등록 경쟁채널만
-- market_ytd_rank_snapshot(그 채널명의 가장 최근 업로드 스냅샷)에서 시청률·순위를 보충한다.
-- 이 스냅샷은 특정 시점 하나만 있는 누적치라 12주 baseline은 만들 수 없으므로(값을 지어내지
-- 않음, CLAUDE.md 원칙) baseline_avg_rating/delta_pct는 그대로 null로 남긴다 — 화면에는
-- 시청률·순위만 채워지고 등락률은 "—"로 표시된다.
--
-- 함께 정리: get_channel_market_ytd_competitor_snapshot의 "SBS F!L UHD" → "SBS FIL UHD"
-- 특수문자 별칭은 competitors.competitor_name이 이미 "SBS NEX"로 개명되어(2026-09) 더 이상
-- 어떤 값과도 매칭되지 않는 죽은 코드가 됐다 — 제거한다(원본 데이터·매칭 로직 모두 이제는
-- 별도 별칭 없이 직접 일치).
create or replace function get_channel_market_ytd_competitor_snapshot(
  p_channel_code text,
  p_target_label text
)
returns table (
  channel_name text,
  rank int,
  rating numeric,
  is_self boolean,
  date_from date,
  date_to date
)
language sql
stable
as $$
  with self_row as (
    select c.name as competitor_name, true as is_self
    from channels c
    where c.code = p_channel_code
  ),
  comp_rows as (
    select comp.competitor_name, false as is_self
    from competitors comp
    join channels c on c.id = comp.channel_id and c.code = p_channel_code
  ),
  all_rows as (
    select * from self_row
    union all
    select * from comp_rows
  ),
  latest_snapshot as (
    select distinct on (lower(mkt.channel_name))
      mkt.channel_name, mkt.rank, mkt.rating, mkt.date_from, mkt.date_to
    from market_ytd_rank_snapshot mkt
    where mkt.target_label = p_target_label
    order by lower(mkt.channel_name), mkt.date_to desc
  )
  select ls.channel_name, ls.rank, ls.rating, ar.is_self, ls.date_from, ls.date_to
  from all_rows ar
  join latest_snapshot ls
    on lower(ls.channel_name) = lower(ar.competitor_name)
  order by ls.rank asc;
$$;
comment on function get_channel_market_ytd_competitor_snapshot is 'skyUHD처럼 일별 competitor_ratings가 없는 채널을 위한 COMPARED WITH? 대체 데이터 — 관리자가 업로드한 시장 전체 누적 순위 파일(market_ytd_rank_snapshot)에서 그 채널과 등록 경쟁채널 전부의 "가장 최근 업로드된" 순위·시청률을 순위순으로 반환한다. 대소문자 차이는 자동으로 흡수한다(2026-09-22: "SBS F!L UHD" 특수문자 별칭은 해당 채널이 "SBS NEX"로 개명되며 죽은 코드가 되어 제거).';

drop function if exists get_competitor_insight_report(text, text, date, int, date, int, int);

create or replace function get_competitor_insight_report(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_baseline_days int default 84,
  p_date_from date default null,
  p_target_dow int default null,
  p_target_weeks int default null,
  p_market_ytd_target_label text default null
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
  -- 신규(2026-09-22): 일별 데이터가 전혀 없는 등록 경쟁채널(예: ASIA UHD, SBS NEX)만
  -- market_ytd_rank_snapshot(관리자가 올린 누적 채널 순위 파일)의 "가장 최근 업로드된" 값으로
  -- 보충한다. 특정 시점 하나뿐인 값이라 baseline(12주 평균)은 만들지 않는다.
  market_ytd_fallback as (
    select distinct on (lower(mkt.channel_name))
      rc.competitor_name, mkt.rank as best_rank, mkt.rating as period_rating
    from registered_competitors rc
    join market_ytd_rank_snapshot mkt
      on lower(mkt.channel_name) = lower(rc.competitor_name)
     and mkt.target_label = p_market_ytd_target_label
    where p_market_ytd_target_label is not null
      and not exists (select 1 from nielsen_period_rows npr where npr.competitor_name = rc.competitor_name)
      and not exists (select 1 from self_channel_period_fallback scpf where scpf.competitor_name = rc.competitor_name)
    order by lower(mkt.channel_name), mkt.date_to desc
  ),
  period_rows as (
    select
      rc.competitor_name,
      coalesce(npr.period_rating, scpf.period_rating, myf.period_rating) as period_rating,
      coalesce(npr.best_rank, scpf.best_rank, myf.best_rank) as best_rank
    from registered_competitors rc
    left join nielsen_period_rows npr on npr.competitor_name = rc.competitor_name
    left join self_channel_period_fallback scpf on scpf.competitor_name = rc.competitor_name
    left join market_ytd_fallback myf on myf.competitor_name = rc.competitor_name
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
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, baseline 대비 등락과 기간 내 최고 성적 프로그램까지 제공. 등록 경쟁채널이 일별 Nielsen 데이터가 전혀 없는 채널(예: skyUHD의 ASIA UHD/SBS NEX)이면, p_market_ytd_target_label을 넘겼을 때 관리자가 올린 누적 채널 순위 파일(market_ytd_rank_snapshot)의 가장 최근 값으로 시청률·순위만 보충한다(baseline·등락률은 계산 불가라 null, 2026-09-22 추가). 그 외 로직(self-channel fallback, 등록=인식 원칙 등)은 기존과 동일.';
