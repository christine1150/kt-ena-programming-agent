-- 사용자 지시(2026-09-30): 이상적 1주일 편성 STEP 2 — 12주 Feature 입력 RPC 2종.
--
-- 설계 판단: Feature 집계(요일×시간 적합도·추세·안정성·수축 Expected KPI 등)는 계층이 많고 백테스트·
-- 결정론 테스트가 필요해, SQL에서는 "방영 1건 = 1행" 수준까지만 줄여서 넘기고 나머지는 TypeScript
-- 순수 함수(src/lib/idealSchedule/features.ts)에서 계산한다. 채널 1개 × 84일 × KPI+보조 타깃 방영
-- 건수는 수천 건 수준이라 전달 비용이 작다. PostgREST 행 수 제한(1000행)을 피하려고 jsonb 1개로 반환한다.
--
-- 미래 데이터 차단(Walk-forward 백테스트 핵심 규칙): 두 함수 모두 broadcast_date <= p_as_of_date를
-- SQL에서 강제한다. 호출부가 as_of 이후 데이터를 받을 방법이 없다.
--
-- NULL/0 구분: rating NULL은 그대로 NULL로, 0은 0으로 넘긴다(집계 쪽에서 NULL은 표본 제외, 0은 포함).
-- 방송 없음 = 행 부재.

-- ============================================================
-- 1) 자사 채널 방영 단위 데이터
--    p_target_labels NULL이면 채널 KPI 타깃(resolve_program_target_label)만.
--    skyUHD는 source_type='skyuhd', target_id 비어 있음(기존 규칙) → 타깃 필터 없이 '__SKYUHD__' 키로 반환.
-- ============================================================
create or replace function get_ideal_schedule_own_airings(
  p_channel_code text,
  p_as_of_date date,
  p_lookback_days int default 84,
  p_target_labels text[] default null
)
returns jsonb
language sql
stable
as $$
  with ch as (
    select c.id, c.code, c.primary_target,
      case when c.code = 'SKYUHD' then null else resolve_program_target_label(c.primary_target) end as kpi_label
    from channels c
    where c.code = p_channel_code
  ),
  win as (
    select (p_as_of_date - (p_lookback_days - 1)) as d_from, p_as_of_date as d_to
  ),
  base as (
    select
      r.broadcast_date,
      r.start_time,
      r.end_time,
      r.program_id,
      r.is_first_run,
      r.rating,
      r.share,
      r.reach,
      r.time_spent_seconds,
      case when ch.code = 'SKYUHD' then '__SKYUHD__' else t.label end as target_label
    from ratings r
    join ch on ch.id = r.channel_id
    cross join win
    left join targets t on t.id = r.target_id
    where r.broadcast_date between win.d_from and win.d_to
      and r.program_id is not null
      and r.start_time is not null
      and (
        (ch.code = 'SKYUHD' and r.source_type = 'skyuhd' and r.target_id is null)
        or (
          ch.code <> 'SKYUHD'
          and r.source_type = 'nielsen_daily'
          and t.label = any(coalesce(p_target_labels, array[ch.kpi_label]))
        )
      )
  ),
  airing as (
    select
      b.broadcast_date,
      b.start_time,
      max(b.end_time) as end_time,
      b.program_id,
      -- 같은 방영 행의 타깃별 행은 본/재 태그가 같다. 하나라도 true/false가 있으면 그 값을 쓴다.
      bool_or(b.is_first_run) filter (where b.is_first_run is not null) as is_first_run,
      jsonb_object_agg(
        b.target_label,
        jsonb_build_object('r', b.rating, 's', b.share, 'reach', b.reach, 'ts', b.time_spent_seconds)
      ) as metrics
    from base b
    group by b.broadcast_date, b.start_time, b.program_id
  )
  select jsonb_build_object(
    'channel_code', (select code from ch),
    'kpi_label', (select coalesce(kpi_label, '__SKYUHD__') from ch),
    'date_from', (select d_from from win),
    'date_to', (select d_to from win),
    'holidays', coalesce((
      select jsonb_agg(h.holiday_date order by h.holiday_date)
      from public_holidays h, win
      where h.holiday_date between win.d_from and win.d_to
    ), '[]'::jsonb),
    'dates_with_data', coalesce((
      select jsonb_agg(distinct a.broadcast_date) from airing a
    ), '[]'::jsonb),
    'airings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', a.broadcast_date,
          'start', to_char(a.start_time, 'HH24:MI:SS'),
          'end', to_char(a.end_time, 'HH24:MI:SS'),
          'program_id', a.program_id,
          'program_name', p.canonical_name,
          'first_run', a.is_first_run,
          'm', a.metrics
        )
        order by a.broadcast_date, a.start_time, a.program_id
      )
      from airing a
      join programs p on p.id = a.program_id
    ), '[]'::jsonb)
  );
$$;
comment on function get_ideal_schedule_own_airings is '이상적 1주일 편성 Feature 입력(2026-09-30): 자사 채널의 as_of 이전 N일 방영 1건=1원소 jsonb(타깃별 rating/share/reach/시청시간). broadcast_date<=as_of를 SQL에서 강제(백테스트 미래 데이터 차단). skyUHD는 source_type=skyuhd·타깃 없음으로 분기.';

-- ============================================================
-- 2) 경쟁채널 데이터 — 프로그램 단위 방영(competitor_program_ratings) + 채널 단위 일별(competitor_ratings)
--    같은 (경쟁채널, 날짜, 시작시각)이 여러 자사 시트에 중복 수록된 경우 시청률 있는 쪽 우선
--    (get_competitor_week_schedule과 동일 규칙).
--    타깃 선택(2049/가구/둘 다)은 사용자 규칙(2026-09-30)에 따라 TS에서 자사 KPI와 비교해 고른다 —
--    여기서는 보유한 타깃을 모두 넘긴다.
-- ============================================================
create or replace function get_ideal_schedule_competitor_data(
  p_competitor_names text[],
  p_as_of_date date,
  p_lookback_days int default 84
)
returns jsonb
language sql
stable
as $$
  with win as (
    select (p_as_of_date - (p_lookback_days - 1)) as d_from, p_as_of_date as d_to
  ),
  prog as (
    select distinct on (cp.competitor_name, cp.broadcast_date, cp.start_time)
      cp.competitor_name, cp.broadcast_date, cp.start_time, cp.end_time,
      cp.program_name, cp.target_label, cp.rating, cp.share
    from competitor_program_ratings cp, win
    where cp.competitor_name = any(p_competitor_names)
      and cp.broadcast_date between win.d_from and win.d_to
    order by cp.competitor_name, cp.broadcast_date, cp.start_time, cp.rating desc nulls last
  ),
  daily as (
    select cr.competitor_name, cr.broadcast_date, t.label as target_label, cr.rating, cr.share
    from competitor_ratings cr
    join targets t on t.id = cr.target_id
    cross join win
    where cr.competitor_name = any(p_competitor_names)
      and cr.broadcast_date between win.d_from and win.d_to
  )
  select jsonb_build_object(
    'date_from', (select d_from from win),
    'date_to', (select d_to from win),
    'airings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'competitor', p.competitor_name,
          'date', p.broadcast_date,
          'start', to_char(p.start_time, 'HH24:MI:SS'),
          'end', to_char(p.end_time, 'HH24:MI:SS'),
          'program_name', p.program_name,
          'target_label', p.target_label,
          'r', p.rating,
          's', p.share
        )
        order by p.competitor_name, p.broadcast_date, p.start_time
      )
      from prog p
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'competitor', d.competitor_name,
          'date', d.broadcast_date,
          'target_label', d.target_label,
          'r', d.rating,
          's', d.share
        )
        order by d.competitor_name, d.broadcast_date, d.target_label
      )
      from daily d
    ), '[]'::jsonb)
  );
$$;
comment on function get_ideal_schedule_competitor_data is '이상적 1주일 편성 경쟁 Benchmark 입력(2026-09-30): 선택 경쟁채널의 as_of 이전 N일 프로그램 단위 방영 + 채널 단위 일별(보유 타깃 전부). broadcast_date<=as_of를 SQL에서 강제.';

-- competitor_program_ratings는 (our_channel_id, broadcast_date) 인덱스만 있어 경쟁채널명 기준 조회용 보강
create index if not exists idx_competitor_program_ratings_name_date
  on competitor_program_ratings (competitor_name, broadcast_date);
