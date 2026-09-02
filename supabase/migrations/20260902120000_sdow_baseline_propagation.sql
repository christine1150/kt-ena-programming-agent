-- 사용자 지시(2026-09-02): "Same Day of Week 분석 시 하위의 모든 메뉴, 즉 브리핑부터 경쟁채널
-- 분석까지 모두 선택한 기간의 내용으로 반영 해 주셔야 합니다." — 지금까지 SDoW(동요일 평균 분석)는
-- KPI 5카드와 브리핑 문장 한 줄에만 반영돼 있었고, 그 아래 오늘의 브리핑 AI 요약·WHO IS WATCHING?
-- 연령대별 등락·시간대별 그래프 기준선·TOP20/TOP5·COMPARED WITH? 경쟁채널 등락은 전부 각자의
-- 고정 창(최근 12주/8주/28일 trailing)을 그대로 쓰고 있었다.
--
-- 사용자 재확인(같은 날, 후속 질문): TOP20/TOP5처럼 순위형 리스트도 표본이 크게 줄어드는 것을
-- 알고도 "가능한 모든 섹션을 같은 요일만으로" 선택 — 이 마이그레이션은 그 범위를 반영한다.
--
-- 설계: 공용 헬퍼 same_dow_dates()로 "선택한 요일의 최근 N주 날짜"를 구하고(이미 배포된
-- get_channel_same_weekday_report와 동일한 규칙 — p_as_of_date 자신도 그 요일이면 포함해 최근
-- N개를 센다, 기존 관례와 일관성 유지), 대상 RPC마다 p_target_dow/p_target_weeks를 추가 파라미터로
-- 받아 값이 있으면 그 날짜 집합으로, 없으면(기존 호출부 전부) 원래 창 그대로 동작한다(하위호환).
--
-- 이번에 바꾸지 않는 것(구조적으로 "같은 요일 평균"과 안 맞아 제외, 정직하게 남겨둠):
--  - get_channel_dow_hourblock_pattern(요일×시간대 히트맵): 이미 7개 요일을 나란히 보여주는 게
--    목적이라, 한 요일로 좁히면 히트맵 자체의 비교 가치가 사라진다.
--  - get_root_cause_alert/get_competitor_schedule_changes/get_channel_stable_slot_patterns
--    (WHY? 연속 하락 감지, 경쟁채널 편성 변화, 편성 안정성): "N일 연속"/"N주 내내 같았는지" 같은
--    연속성 알고리즘이라, "같은 요일 평균"으로 바꾸면 완전히 다른 알고리즘을 새로 설계해야 한다.
--  - Fit Score/CONTENT FITS?: 이미 §U에서 "기간과 무관한 트레일링 12주 percentile"로 의도적 설계
--    확정(캡션에 이미 명시) — 별도 지시 없이 다시 바꾸지 않는다.
--  - get_channel_daypart_opportunity/get_channel_hourblock_opportunity(OPPORTUNITY?): 우리 채널
--    ×경쟁채널 두 축을 "전체 보유기간 vs 최근 구간"으로 비교하는 이중 창 구조라, 이미 sdow 성격의
--    "최근" 구간 개념(recentDays)이 따로 있고 "같은 요일만"을 얹으면 daypart(4시간 블록)×요일
--    조합의 표본이 극단적으로(주당 1일) 줄어 게이지 자체가 무의미해진다 — 별도 설계 필요, 이번엔 제외.

create or replace function same_dow_dates(p_as_of_date date, p_dow int, p_weeks int)
returns table (d date)
language sql
stable
as $$
  select gs::date as d
  from generate_series(p_as_of_date - (greatest(p_weeks, 1) * 7), p_as_of_date, interval '1 day') as gs
  where extract(dow from gs)::int = p_dow
  order by gs desc
  limit greatest(p_weeks, 1)
$$;
comment on function same_dow_dates is '지정한 요일(dow, Postgres extract(dow) 표준 0=일~6=토)의 최근 p_weeks개 과거 날짜(p_as_of_date 포함)를 반환 — SDoW(동요일 평균 분석) 계열 RPC들이 공용으로 쓰는 헬퍼(2026-09-02). get_channel_same_weekday_report(20260902040000)와 동일한 날짜 산출 규칙.';

-- ── 1) get_channel_daily_narrative: 오늘의 브리핑(규칙 기반 문장 + AI 요약 둘 다 이 RPC의
-- narrativeSignal 값을 그대로 근거로 씀, route.ts의 buildBriefingReportViaLlm 참고) + WHO IS
-- WATCHING? 연령대별 등락(같은 RPC를 28일 baseline으로 한 번 더 호출).
--
-- 실수 발견·정정(2026-09-02, 배포 전 pg_proc 조회로 확인): 이 함수의 실제 최신 정의는
-- 20260821060000_narrative_peak_hour_program.sql(today_peak_program_name/rating, decline_program_*
-- 필드, "같은 요일+같은 시간대(본방 슬롯)" 기준 program_baseline_weeks 로직 포함)인데, 초안 작성 시
-- 더 오래된 버전(20260820140000)을 베이스로 잘못 옮겨써 이 필드들을 통째로 없앨 뻔했다 — 배포 전
-- "function name is not unique" 오류로 실제 시그니처(7개 인자)를 재확인해 잡아냈다. 아래는 실제
-- 최신 정의를 그대로 베이스로 삼아 p_target_dow 파라미터 하나만 추가한다(새 p_target_weeks 파라미터를
-- 따로 만들지 않고, 이미 있던 p_program_baseline_weeks를 채널 단위 baseline에도 재사용 — SDoW가
-- 활성화되면 "그 요일의 최근 N주"라는 같은 N이 프로그램 단위·채널 단위 baseline 모두에 적용된다).
-- channel_rank_baseline/baseline_hourly(+baseline_peak)/top_program_baseline/today_programs_scored
-- (decline_program의 근거)/demo_baseline — p_target_dow가 있으면 same_dow_dates로, 없으면(기존
-- 호출부 전부) 원래 트레일링 창 그대로 100% 동일하게 동작한다(하위호환).
drop function if exists get_channel_daily_narrative(text, text, text, text[], date, int, int);

create or replace function get_channel_daily_narrative(
  p_channel_code text,
  p_target_label text,
  p_program_target_label text,
  p_demographic_labels text[],
  p_as_of_date date,
  p_baseline_days int default 28,
  p_program_baseline_weeks int default 8,
  p_target_dow int default null
)
returns table (
  today_rating numeric,
  baseline_avg_rating numeric,
  rating_delta_pct numeric,
  today_rank int,
  baseline_avg_rank numeric,
  today_share numeric,
  baseline_avg_share numeric,
  today_peak_hour int,
  today_peak_rating numeric,
  today_peak_program_name text,
  today_peak_program_rating numeric,
  baseline_peak_hour int,
  baseline_peak_rating numeric,
  top_program_name text,
  top_program_rating numeric,
  top_program_start_time time,
  top_program_baseline_avg numeric,
  top_program_baseline_days int,
  decline_program_name text,
  decline_program_rating numeric,
  decline_program_start_time time,
  decline_program_baseline_avg numeric,
  decline_program_baseline_days int,
  decline_program_delta_pct numeric,
  demographics jsonb,
  dow_baseline_avg_rating numeric
)
language sql
stable
as $$
  with baseline_range as (
    select (p_as_of_date - p_baseline_days) as from_date, (p_as_of_date - 1) as to_date
  ),
  program_baseline_range as (
    select (p_as_of_date - (p_program_baseline_weeks * 7)) as from_date, (p_as_of_date - 1) as to_date
  ),
  channel_rank_today as (
    select r.rating, r.rank, r.share
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date = p_as_of_date
    limit 1
  ),
  channel_rank_baseline as (
    select avg(r.rating) as avg_rating, avg(r.rank) as avg_rank, avg(r.share) as avg_share
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and (
        p_target_dow is null
          and r.broadcast_date between (select from_date from baseline_range) and (select to_date from baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
  ),
  channel_rank_dow_baseline as (
    select avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id, baseline_range br
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between br.from_date and br.to_date
      and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
  ),
  today_hourly as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.broadcast_date = p_as_of_date
    group by hr
  ),
  baseline_hourly as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and (
        p_target_dow is null
          and r.broadcast_date between (select from_date from baseline_range) and (select to_date from baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
    group by hr
  ),
  today_peak as (
    select hr, avg_rating from today_hourly order by avg_rating desc nulls last limit 1
  ),
  baseline_peak as (
    select hr, avg_rating from baseline_hourly order by avg_rating desc nulls last limit 1
  ),
  today_peak_top_program as (
    select p.canonical_name, r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, today_peak tpk
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
      and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) = tpk.hr
    order by r.rating desc
    limit 1
  ),
  today_top_program as (
    select p.canonical_name, r.rating, r.start_time
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
    order by r.rating desc
    limit 1
  ),
  top_program_baseline as (
    select avg(r.rating) as avg_rating, count(*) as days
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, today_top_program ttp
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and replace(p.canonical_name, ' ', '') = replace(ttp.canonical_name, ' ', '')
      and r.rating is not null
      and r.start_time is not null and ttp.start_time is not null
      and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end)
        = (case when extract(hour from ttp.start_time) < 2 then extract(hour from ttp.start_time)::int + 24 else extract(hour from ttp.start_time)::int end)
      and r.is_first_run is distinct from false
      and (
        p_target_dow is null
          and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
          and r.broadcast_date between (select from_date from program_baseline_range) and (select to_date from program_baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
  ),
  today_programs as (
    select p.canonical_name, r.rating, r.start_time
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
  ),
  today_programs_scored as (
    select
      tpr.canonical_name, tpr.rating, tpr.start_time,
      pb.avg_rating as baseline_avg, pb.days as baseline_days,
      case when pb.avg_rating is not null and pb.avg_rating <> 0
        then ((tpr.rating - pb.avg_rating) / pb.avg_rating * 100) else null end as delta_pct
    from today_programs tpr
    left join lateral (
      select avg(r2.rating) as avg_rating, count(*) as days
      from ratings r2
      join channels c2 on c2.id = r2.channel_id
      left join targets t2 on t2.id = r2.target_id
      join programs p2 on p2.id = r2.program_id
      where c2.code = p_channel_code and (t2.label = p_program_target_label or r2.target_id is null)
        and r2.source_type in ('nielsen_daily', 'skyuhd')
        and replace(p2.canonical_name, ' ', '') = replace(tpr.canonical_name, ' ', '')
        and r2.rating is not null
        and r2.start_time is not null and tpr.start_time is not null
        and (case when extract(hour from r2.start_time) < 2 then extract(hour from r2.start_time)::int + 24 else extract(hour from r2.start_time)::int end)
          = (case when extract(hour from tpr.start_time) < 2 then extract(hour from tpr.start_time)::int + 24 else extract(hour from tpr.start_time)::int end)
        and r2.is_first_run is distinct from false
        and (
          p_target_dow is null
            and extract(isodow from r2.broadcast_date) = extract(isodow from p_as_of_date)
            and r2.broadcast_date between (select from_date from program_baseline_range) and (select to_date from program_baseline_range)
          or
          p_target_dow is not null
            and r2.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
        )
    ) pb on true
  ),
  worst_program as (
    select canonical_name, rating, start_time, baseline_avg, baseline_days, delta_pct
    from today_programs_scored
    where delta_pct is not null and baseline_days >= 3 and delta_pct <= -30 and baseline_avg >= 0.05
    order by delta_pct asc
    limit 1
  ),
  demo_today as (
    select t.label, r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date = p_as_of_date
  ),
  demo_baseline as (
    select t.label, avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and (
        p_target_dow is null
          and r.broadcast_date between (select from_date from baseline_range) and (select to_date from baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
    group by t.label
  )
  select
    crt.rating as today_rating,
    round(crb.avg_rating::numeric, 5) as baseline_avg_rating,
    case when crb.avg_rating is not null and crb.avg_rating <> 0
      then round(((crt.rating - crb.avg_rating) / crb.avg_rating * 100)::numeric, 1) else null end as rating_delta_pct,
    crt.rank as today_rank,
    round(crb.avg_rank::numeric, 1) as baseline_avg_rank,
    crt.share as today_share,
    round(crb.avg_share::numeric, 4) as baseline_avg_share,
    tp.hr as today_peak_hour,
    round(tp.avg_rating::numeric, 5) as today_peak_rating,
    tpt.canonical_name as today_peak_program_name,
    round(tpt.rating::numeric, 5) as today_peak_program_rating,
    bp.hr as baseline_peak_hour,
    round(bp.avg_rating::numeric, 5) as baseline_peak_rating,
    ttp.canonical_name as top_program_name,
    round(ttp.rating::numeric, 5) as top_program_rating,
    ttp.start_time as top_program_start_time,
    round(tpb.avg_rating::numeric, 5) as top_program_baseline_avg,
    tpb.days::int as top_program_baseline_days,
    wp.canonical_name as decline_program_name,
    round(wp.rating::numeric, 5) as decline_program_rating,
    wp.start_time as decline_program_start_time,
    round(wp.baseline_avg::numeric, 5) as decline_program_baseline_avg,
    wp.baseline_days::int as decline_program_baseline_days,
    round(wp.delta_pct::numeric, 1) as decline_program_delta_pct,
    (
      select jsonb_agg(jsonb_build_object(
        'label', dt.label,
        'today', dt.rating,
        'baseline_avg', db.avg_rating,
        'delta_pct', case when db.avg_rating is not null and db.avg_rating <> 0
          then round(((dt.rating - db.avg_rating) / db.avg_rating * 100)::numeric, 1) else null end
      ))
      from demo_today dt
      left join demo_baseline db on db.label = dt.label
    ) as demographics,
    round(crd.avg_rating::numeric, 5) as dow_baseline_avg_rating
  from channel_rank_today crt
  full outer join channel_rank_baseline crb on true
  left join channel_rank_dow_baseline crd on true
  left join today_peak tp on true
  left join today_peak_top_program tpt on true
  left join baseline_peak bp on true
  left join today_top_program ttp on true
  left join top_program_baseline tpb on true
  left join worst_program wp on true;
$$;
comment on function get_channel_daily_narrative is '채널 일일 인사이트(줄글)용 신호 계산. 채널 단위 지표는 p_baseline_days(기본 28일) 평균과, 프로그램(top_program/decline_program) 단위는 "같은 요일+같은 시간대(본방 슬롯)"로 좁힌 최근 p_program_baseline_weeks(기본 8주) 평균과 비교. p_target_dow(2026-09-02, SDoW)가 있으면 채널 단위 baseline도 "그 요일의 최근 p_program_baseline_weeks주"로 통일(같은 N주 파라미터를 재사용) — 없으면(기존 호출부 전부) 기존 동작 그대로.';

-- ── 2) get_hourly_rating_pattern: 시간대별 그래프의 "연한 기준선"(12주 baseline overlay) 호출에
-- p_target_dow/p_target_weeks가 있으면 date_from~date_to 범위 대신 same_dow_dates로 좁힌다.
-- "오늘의 실제 프로파일"(당일 date_from=date_to 호출)은 이 파라미터를 안 넘기므로 영향 없다.
-- 새 파라미터 2개가 추가돼 시그니처가 바뀌므로(4개→6개), create or replace만으로는 기존 4개짜리와
-- 겹쳐 "not unique" 오류가 난다 — 먼저 명시적으로 drop.
drop function if exists get_hourly_rating_pattern(text, text, date, date);

create or replace function get_hourly_rating_pattern(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_target_dow int default null,
  p_target_weeks int default null
)
returns table (
  broadcast_hour int,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  program_count bigint
)
language sql
stable
as $$
  select
    (case when extract(hour from r.start_time) < 2
          then extract(hour from r.start_time)::int + 24
          else extract(hour from r.start_time)::int
     end) as broadcast_hour,
    avg(r.rating) as avg_rating,
    avg(r.share) as avg_share,
    avg(r.reach) as avg_reach,
    avg(r.time_spent_seconds) as avg_time_spent_seconds,
    count(*) as program_count
  from ratings r
  join channels c on c.id = r.channel_id
  left join targets t on t.id = r.target_id
  where c.code = p_channel_code
    and (t.label = p_target_label or r.target_id is null)
    and r.source_type in ('nielsen_daily', 'skyuhd')
    and r.program_id is not null
    and r.start_time is not null
    and (
      (p_target_dow is null or p_target_weeks is null) and r.broadcast_date between p_date_from and p_date_to
      or
      (p_target_dow is not null and p_target_weeks is not null)
        and r.broadcast_date in (select d from same_dow_dates(p_date_to, p_target_dow, p_target_weeks))
    )
  group by broadcast_hour
  order by broadcast_hour
$$;
comment on function get_hourly_rating_pattern is 'Page 2 시간대별 그래프(02~25시) 원자료. p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 p_date_from~p_date_to 대신 "그 요일의 최근 N주"만 집계(주로 12주 기준선 overlay 호출에 사용) — 없으면(기존 호출부 전부) 기존 날짜 범위 그대로.';

-- ── 3) get_channel_top_programs / get_channel_top_share_programs: TOP20/TOP5 점유율. 사용자가
-- 표본이 크게 줄어드는 것(84일→N일)을 알고도 명시적으로 선택했다 — p_target_dow/p_target_weeks가
-- 있으면 p_window_days 트레일링 대신 same_dow_dates로.
drop function if exists get_channel_top_programs(text, text, date, int, int);

create function get_channel_top_programs(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84,
  p_limit int default 20,
  p_target_dow int default null,
  p_target_weeks int default null
)
returns table (
  program_name text,
  avg_rating numeric,
  avg_share numeric,
  air_count int,
  top_daypart text,
  most_common_start_hour int
)
language sql
stable
as $$
  with base as (
    select
      p.canonical_name,
      r.rating,
      r.share,
      daypart_of(r.start_time) as daypart,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and (
        (p_target_dow is null or p_target_weeks is null)
          and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
        or
        (p_target_dow is not null and p_target_weeks is not null)
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_target_weeks))
      )
  ),
  daypart_counts as (
    select canonical_name, daypart, count(*) as cnt
    from base
    group by canonical_name, daypart
  ),
  daypart_mode as (
    select distinct on (canonical_name) canonical_name, daypart
    from daypart_counts
    order by canonical_name, cnt desc, daypart
  ),
  hour_counts as (
    select canonical_name, hr, count(*) as cnt
    from base
    group by canonical_name, hr
  ),
  hour_mode as (
    select distinct on (canonical_name) canonical_name, hr
    from hour_counts
    order by canonical_name, cnt desc, hr
  )
  select
    b.canonical_name as program_name,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    round(avg(b.share)::numeric, 4) as avg_share,
    count(*)::int as air_count,
    dm.daypart as top_daypart,
    hm.hr as most_common_start_hour
  from base b
  left join daypart_mode dm on dm.canonical_name = b.canonical_name
  left join hour_mode hm on hm.canonical_name = b.canonical_name
  group by b.canonical_name, dm.daypart, hm.hr
  order by avg(b.rating) desc
  limit p_limit;
$$;
comment on function get_channel_top_programs is 'Page 2 시청률 상위 콘텐츠 TOP20. 창 안에 편성 5회 미만인 프로그램은 상위 후보에서 제외(2026-09-02, get_channel_killer_content_daypart와 별개 함수). p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 p_window_days 트레일링 대신 "그 요일의 최근 N주"만 집계.';

drop function if exists get_channel_top_share_programs(text, text, date, int, int);

create function get_channel_top_share_programs(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84,
  p_limit int default 5,
  p_target_dow int default null,
  p_target_weeks int default null
)
returns table (
  program_name text,
  avg_rating numeric,
  avg_share numeric,
  air_count int
)
language sql
stable
as $$
  with base as (
    select p.canonical_name, r.rating, r.share
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null and r.share is not null
      and (
        (p_target_dow is null or p_target_weeks is null)
          and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
        or
        (p_target_dow is not null and p_target_weeks is not null)
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_target_weeks))
      )
  )
  select
    canonical_name as program_name,
    round(avg(rating)::numeric, 5) as avg_rating,
    round(avg(share)::numeric, 4) as avg_share,
    count(*)::int as air_count
  from base
  group by canonical_name
  order by avg(share) desc
  limit p_limit;
$$;
comment on function get_channel_top_share_programs is 'TOP20(시청률 기준) 화면 아래 "TOP20에는 없지만 점유율은 상위인" 콘텐츠. p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 p_window_days 트레일링 대신 "그 요일의 최근 N주"만 집계.';

-- ── 4) get_competitor_insight_report: COMPARED WITH? 등록 경쟁채널의 "12주 평균 대비" — baseline
-- CTE만 p_target_dow/p_target_weeks가 있으면 same_dow_dates로(오늘 실제 값인 period_rows는 그대로).
-- v_date_from - 1을 기준일로 넘겨 기존처럼 "오늘 자신은 baseline에서 제외"하는 규칙을 유지한다.
-- 새 파라미터 2개가 추가돼 시그니처가 바뀌므로(5개→7개) 먼저 명시적으로 drop.
drop function if exists get_competitor_insight_report(text, text, date, int, date);

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
      and (
        (p_target_dow is null or p_target_weeks is null)
          and cr.broadcast_date between (v_date_from - p_baseline_days) and (v_date_from - 1)
        or
        (p_target_dow is not null and p_target_weeks is not null)
          and cr.broadcast_date in (select d from same_dow_dates(v_date_from - 1, p_target_dow, p_target_weeks))
      )
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
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, baseline 대비 등락과 기간 내 최고 성적 프로그램까지 제공. 자사 KPI 타깃 동의어 대체는 기존 그대로. p_target_dow/p_target_weeks(2026-09-02, SDoW)가 둘 다 있으면 baseline만 "그 요일의 최근 N주"로(오늘 자신은 제외), 없으면 기존 p_baseline_days 트레일링 창 그대로.';
