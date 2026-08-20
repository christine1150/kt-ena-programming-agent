-- 사용자 지시(2026-08-20): "오늘의 브리핑은 타깃상세 탭의 5대 지표(시청률/점유율/도달율/
-- 시청시간/시청시간 비율)까지 포함해 편성 Intelligence 수준으로 올려달라" — 참고 예시는
-- "수요일 22시 [프로그램 X]의 수도권 여성 30대 시청시간 비율이 81.2%(평소 대비 +14.5%p)"처럼
-- 프로그램×연령대×지표 단위의 이상치를 짚는 형태였다.
--
-- §1.3 타깃상세 시트는 같은 프로그램 블록(같은 channel_id·broadcast_date·start_time)에 P2049·
-- 여20대·남20대 등 연령대별 타깃 행이 나란히 저장돼 있다(target-filter-fix 마이그레이션 주석
-- 참고) — 오늘 방영된 상위 N개 프로그램에 대해, 지정한 연령대 목록 전체 × 5개 지표를 그
-- 프로그램의 "본방 슬롯"(같은 요일+시간대, get_channel_daily_narrative/Fit Score MART와 동일
-- 정의) 최근 N주 평균과 비교해 편차가 큰 것만 후보로 낸다 — 새 개념을 만들지 않고 이미 검증된
-- "본방 슬롯" 패턴을 연령대·지표 축으로만 확장한다.
create or replace function get_channel_demographic_program_highlights(
  p_channel_code text,
  p_kpi_target_label text,
  p_demographic_labels text[],
  p_as_of_date date,
  p_top_n_programs int default 3,
  p_program_baseline_weeks int default 8
)
returns table (
  program_name text,
  program_start_time time,
  demographic_label text,
  metric text,
  today_value numeric,
  baseline_avg numeric,
  baseline_days int,
  delta_pct numeric
)
language sql
stable
as $$
  with top_programs as (
    select p.canonical_name, r.start_time, r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = p_kpi_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
    order by r.rating desc
    limit p_top_n_programs
  ),
  demo_today as (
    select
      tp.canonical_name, tp.start_time as program_start_time,
      t.label as demographic_label,
      r.rating, r.share, r.reach, r.time_spent_seconds, r.time_spent_share
    from top_programs tp
    join channels c on c.code = p_channel_code
    join ratings r on r.channel_id = c.id
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.start_time = tp.start_time
    join targets t on t.id = r.target_id and t.label = any(p_demographic_labels)
    join programs p2 on p2.id = r.program_id and replace(p2.canonical_name, ' ', '') = replace(tp.canonical_name, ' ', '')
  ),
  demo_baseline as (
    select
      dt.canonical_name, dt.program_start_time, dt.demographic_label,
      avg(r2.rating) as avg_rating, avg(r2.share) as avg_share, avg(r2.reach) as avg_reach,
      avg(r2.time_spent_seconds) as avg_time_spent_seconds, avg(r2.time_spent_share) as avg_time_spent_share,
      count(*) as days
    from demo_today dt
    join channels c on c.code = p_channel_code
    join targets t2 on t2.label = dt.demographic_label
    join ratings r2 on r2.channel_id = c.id and r2.target_id = t2.id
      and r2.source_type = 'nielsen_daily' and r2.program_id is not null
      and r2.broadcast_date between (p_as_of_date - (p_program_baseline_weeks * 7)) and (p_as_of_date - 1)
      and r2.start_time is not null
      and extract(isodow from r2.broadcast_date) = extract(isodow from p_as_of_date)
      and (case when extract(hour from r2.start_time) < 2 then extract(hour from r2.start_time)::int + 24 else extract(hour from r2.start_time)::int end)
        = (case when extract(hour from dt.program_start_time) < 2 then extract(hour from dt.program_start_time)::int + 24 else extract(hour from dt.program_start_time)::int end)
      and r2.is_first_run is distinct from false
      and exists (
        select 1 from programs p3 where p3.id = r2.program_id
          and replace(p3.canonical_name, ' ', '') = replace(dt.canonical_name, ' ', '')
      )
    group by dt.canonical_name, dt.program_start_time, dt.demographic_label
  ),
  unpivoted as (
    select dt.canonical_name as program_name, dt.program_start_time, dt.demographic_label,
      'rating'::text as metric, dt.rating as today_value, db.avg_rating as baseline_avg, db.days as baseline_days
    from demo_today dt join demo_baseline db using (canonical_name, program_start_time, demographic_label)
    union all
    select dt.canonical_name, dt.program_start_time, dt.demographic_label,
      'share', dt.share, db.avg_share, db.days
    from demo_today dt join demo_baseline db using (canonical_name, program_start_time, demographic_label)
    union all
    select dt.canonical_name, dt.program_start_time, dt.demographic_label,
      'reach', dt.reach, db.avg_reach, db.days
    from demo_today dt join demo_baseline db using (canonical_name, program_start_time, demographic_label)
    union all
    select dt.canonical_name, dt.program_start_time, dt.demographic_label,
      'time_spent_seconds', dt.time_spent_seconds, db.avg_time_spent_seconds, db.days
    from demo_today dt join demo_baseline db using (canonical_name, program_start_time, demographic_label)
    union all
    select dt.canonical_name, dt.program_start_time, dt.demographic_label,
      'time_spent_share', dt.time_spent_share, db.avg_time_spent_share, db.days
    from demo_today dt join demo_baseline db using (canonical_name, program_start_time, demographic_label)
  )
  select
    program_name, program_start_time, demographic_label, metric,
    round(today_value::numeric, 5) as today_value,
    round(baseline_avg::numeric, 5) as baseline_avg,
    baseline_days::int,
    case when baseline_avg is not null and baseline_avg <> 0
      then round(((today_value - baseline_avg) / baseline_avg * 100)::numeric, 1) else null end as delta_pct
  from unpivoted
  where today_value is not null and baseline_days >= 3
  order by abs(case when baseline_avg is not null and baseline_avg <> 0 then (today_value - baseline_avg) / baseline_avg else 0 end) desc;
$$;
comment on function get_channel_demographic_program_highlights is '오늘의 브리핑 고도화(2026-08-20): 오늘 방영된 상위 N개 프로그램 × 지정 연령대 × 5대 지표(시청률/점유율/도달율/시청시간/시청시간비율)를 그 프로그램의 "본방 슬롯"(같은 요일+시간대) 최근 N주 평균과 비교, 편차 큰 순으로 반환. 표본 3일 미만은 제외(INSUFFICIENT_SAMPLE 취급). 클라이언트에서 임계값 넘는 상위 몇 개만 문장화한다.';
