-- Audience Intelligence Report Phase 12(2026-08-28, 계획서 J절 Phase 12) — 4개 신규 분석 축.
-- 전부 language sql(plpgsql 아님 — RETURNS TABLE 컬럼명과 겹치는 CTE/서브쿼리 컬럼에 별칭을
-- 안 붙이면 나는 "ambiguous" 런타임 오류를 이 프로젝트에서 여러 번 겪었다 — sql 언어로 짜면 이
-- 문제 자체가 생기지 않는다). 전부 순수 group-by/avg(루프 없음), 기존 함수의 WHERE절·hour
-- 정규화 CASE문을 그대로 재사용 — 새 시청률 계산이 아니라 이미 저장된 값을 다른 축으로 묶을 뿐.

-- 1) 타깟×시간대 — "어느 연령대가 어느 시간대에 몰리는지". get_hourly_rating_pattern과 정확히
--    같은 WHERE절(program_id is not null, start_time is not null, hour 정규화)에 타깃 라벨
--    필터만 더한다. skyUHD는 program_id not null 행 자체가 없어 항상 빈 결과(기존 관례와 동일).
create or replace function get_channel_demographic_hourblock_pattern(
  p_channel_code text,
  p_demographic_labels text[],
  p_date_from date,
  p_date_to date
)
returns table (
  demographic_label text,
  broadcast_hour int,
  avg_rating numeric,
  sample_count bigint
)
language sql
stable
as $$
  select
    t.label as demographic_label,
    (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as broadcast_hour,
    round(avg(r.rating)::numeric, 5) as avg_rating,
    count(*) as sample_count
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code and t.label = any(p_demographic_labels)
    and r.source_type in ('nielsen_daily', 'skyuhd')
    and r.program_id is not null and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by t.label, broadcast_hour
  order by t.label, broadcast_hour;
$$;
comment on function get_channel_demographic_hourblock_pattern is 'Audience Report Phase 12: 연령대×시간대 평균 시청률(get_hourly_rating_pattern과 동일 WHERE절에 타깃 필터만 추가). 어느 연령대가 어느 시간대에 몰리는지 분석용.';

-- 2) 기간 프로그램×타깟 — 기존 get_channel_demographic_program_highlights(단일 일자, 같은 요일
--    트레일링 baseline)를 기간 모드로 재설계: "기간 내 상위 N개 프로그램(KPI 타깟 기준) × 지정
--    연령대 × 5대 지표"를 이번 기간 평균 vs 직전 동일 길이 기간 평균으로 비교한다 — 이 프로젝트
--    전체가 이미 쓰는 "직전 동일 기간 비교" 관용구(periodReport의 prior_period_change_pct 등)
--    그대로. 노이즈 바닥 가드(demographic_program_highlights_noise_floor.sql)를 그대로 재사용.
create or replace function get_channel_period_demographic_program_highlights(
  p_channel_code text,
  p_kpi_target_label text,
  p_demographic_labels text[],
  p_date_from date,
  p_date_to date,
  p_prior_date_from date,
  p_prior_date_to date,
  p_top_n_programs int default 5
)
returns table (
  program_name text,
  demographic_label text,
  metric text,
  period_value numeric,
  prior_value numeric,
  period_days int,
  delta_pct numeric
)
language sql
stable
as $$
  with top_programs as (
    select p.canonical_name, avg(r.rating) as period_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = p_kpi_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.rating is not null
      and r.broadcast_date between p_date_from and p_date_to
    group by p.canonical_name
    order by avg(r.rating) desc
    limit p_top_n_programs
  ),
  demo_period as (
    select
      tp.canonical_name,
      t.label as demographic_label,
      avg(r.rating) as avg_rating, avg(r.share) as avg_share, avg(r.reach) as avg_reach,
      avg(r.time_spent_seconds) as avg_time_spent_seconds, avg(r.time_spent_share) as avg_time_spent_share,
      count(*) as days
    from top_programs tp
    join channels c on c.code = p_channel_code
    join ratings r on r.channel_id = c.id
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date between p_date_from and p_date_to
    join targets t on t.id = r.target_id and t.label = any(p_demographic_labels)
    join programs p2 on p2.id = r.program_id and replace(p2.canonical_name, ' ', '') = replace(tp.canonical_name, ' ', '')
    group by tp.canonical_name, t.label
  ),
  demo_prior as (
    select
      tp.canonical_name,
      t.label as demographic_label,
      avg(r.rating) as avg_rating, avg(r.share) as avg_share, avg(r.reach) as avg_reach,
      avg(r.time_spent_seconds) as avg_time_spent_seconds, avg(r.time_spent_share) as avg_time_spent_share
    from top_programs tp
    join channels c on c.code = p_channel_code
    join ratings r on r.channel_id = c.id
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date between p_prior_date_from and p_prior_date_to
    join targets t on t.id = r.target_id and t.label = any(p_demographic_labels)
    join programs p2 on p2.id = r.program_id and replace(p2.canonical_name, ' ', '') = replace(tp.canonical_name, ' ', '')
    group by tp.canonical_name, t.label
  ),
  unpivoted as (
    select dp.canonical_name as program_name, dp.demographic_label,
      'rating'::text as metric, dp.avg_rating as period_value, dpr.avg_rating as prior_value, dp.days as period_days
    from demo_period dp left join demo_prior dpr using (canonical_name, demographic_label)
    union all
    select dp.canonical_name, dp.demographic_label,
      'share', dp.avg_share, dpr.avg_share, dp.days
    from demo_period dp left join demo_prior dpr using (canonical_name, demographic_label)
    union all
    select dp.canonical_name, dp.demographic_label,
      'reach', dp.avg_reach, dpr.avg_reach, dp.days
    from demo_period dp left join demo_prior dpr using (canonical_name, demographic_label)
    union all
    select dp.canonical_name, dp.demographic_label,
      'time_spent_seconds', dp.avg_time_spent_seconds, dpr.avg_time_spent_seconds, dp.days
    from demo_period dp left join demo_prior dpr using (canonical_name, demographic_label)
    union all
    select dp.canonical_name, dp.demographic_label,
      'time_spent_share', dp.avg_time_spent_share, dpr.avg_time_spent_share, dp.days
    from demo_period dp left join demo_prior dpr using (canonical_name, demographic_label)
  )
  select
    program_name, demographic_label, metric,
    round(period_value::numeric, 5) as period_value,
    round(prior_value::numeric, 5) as prior_value,
    period_days::int,
    case when prior_value is not null and prior_value <> 0
      then round(((period_value - prior_value) / prior_value * 100)::numeric, 1) else null end as delta_pct
  from unpivoted
  where period_value is not null
    -- 노이즈 바닥(demographic_program_highlights_noise_floor.sql과 동일 원칙) — 연령대별
    -- 세분화는 패널 표본이 작아 prior_value가 우연히 0에 가까우면 등락률이 수천 %로 튄다.
    and (prior_value is null or prior_value >= (case metric
      when 'rating' then 0.05
      when 'reach' then 0.05
      when 'share' then 1
      when 'time_spent_share' then 1
      when 'time_spent_seconds' then 30
      else 0
    end))
    and (prior_value is null or prior_value = 0 or abs((period_value - prior_value) / prior_value) <= 3)
  order by abs(case when prior_value is not null and prior_value <> 0 then (period_value - prior_value) / prior_value else 0 end) desc;
$$;
comment on function get_channel_period_demographic_program_highlights is 'Audience Report Phase 12: 기간 내 상위 N개 프로그램(KPI 타깟 기준) × 지정 연령대 × 5대 지표를 이번 기간 평균 vs 직전 동일 길이 기간 평균으로 비교. MODE B/C/D 전용(MODE A는 기존 get_channel_demographic_program_highlights의 같은 요일 트레일링 baseline을 그대로 씀).';

-- 3) 경쟁채널 편성 변화 이력 기간 누적 — 기존 get_competitor_schedule_changes(단일 as_of_date)와
--    동일한 CTE 패턴을 그대로 확장: baseline은 선택 기간 시작일 이전(p_date_from - N주 ~
--    p_date_from - 1)으로 한 번 고정하고, 선택 기간의 매일에 대해 같은 (요일, 시간대) baseline과
--    실제 편성을 비교해 "평소와 다르게 편성된" 날짜만 행으로 반환한다. 재방(<재>) 제외 필터도
--    기존 함수 그대로 재사용(새벽 재방송 로테이션은 항상 "평소와 다름"으로 잡히는 노이즈였음).
create or replace function get_competitor_schedule_change_log(
  p_channel_code text,
  p_date_from date,
  p_date_to date,
  p_lookback_weeks int default 4
)
returns table (
  competitor_name text,
  hour_block int,
  changed_date date,
  changed_program text,
  changed_rating numeric,
  usual_program text,
  usual_weeks_seen int
)
language sql
stable
as $$
  with our_channel as (
    select id from channels where code = p_channel_code
  ),
  actual_rows as (
    select
      cp.competitor_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hour_block,
      cp.broadcast_date,
      extract(isodow from cp.broadcast_date)::int as dow,
      cp.program_name,
      cp.rating
    from competitor_program_ratings cp, our_channel
    where cp.our_channel_id = our_channel.id
      and cp.broadcast_date between p_date_from and p_date_to
      and cp.program_name not like '%<재>%'
  ),
  history_rows as (
    select
      cp.competitor_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hour_block,
      extract(isodow from cp.broadcast_date)::int as dow,
      cp.program_name,
      cp.broadcast_date
    from competitor_program_ratings cp, our_channel
    where cp.our_channel_id = our_channel.id
      and cp.broadcast_date between (p_date_from - (p_lookback_weeks * 7)) and (p_date_from - 1)
      and cp.program_name not like '%<재>%'
  ),
  usual as (
    select distinct on (competitor_name, hour_block, dow)
      competitor_name, hour_block, dow, program_name as usual_program, count(distinct broadcast_date) as usual_weeks_seen
    from history_rows
    group by competitor_name, hour_block, dow, program_name
    order by competitor_name, hour_block, dow, count(distinct broadcast_date) desc
  )
  select
    a.competitor_name,
    a.hour_block,
    a.broadcast_date as changed_date,
    a.program_name as changed_program,
    round(a.rating::numeric, 5) as changed_rating,
    u.usual_program,
    coalesce(u.usual_weeks_seen, 0)::int as usual_weeks_seen
  from actual_rows a
  left join usual u on u.competitor_name = a.competitor_name and u.hour_block = a.hour_block and u.dow = a.dow
  where u.usual_program is distinct from a.program_name
  -- 실측 확인(2026-08-28): 경쟁채널 페어링이 채널당 1개뿐이라던 기존 comment는 낡은 것이었다 —
  -- 실제로는 채널당 5~14개 경쟁채널이 저장돼 있어(예: ENA 9개, ENA Play 9개), 넓은 기간(QTD 등)에서
  -- 변경 이력이 수천 건까지 나올 수 있다. PostgREST 기본 행 제한(보통 1000)에 암묵적으로 잘리면
  -- 어떤 날짜가 잘렸는지 알 수 없어(§ "빈 캡 없음" 원칙 위반) — 최신 날짜부터 최대 500건으로
  -- 명시적으로 제한한다(가장 최근 변화가 편성 판단에 가장 유용하다는 판단).
  order by a.broadcast_date desc, a.hour_block, a.competitor_name
  limit 500;
$$;
comment on function get_competitor_schedule_change_log is 'Audience Report Phase 12: get_competitor_schedule_changes(단일 일자)의 기간 누적 버전 — baseline을 p_date_from 이전 N주로 고정하고, 선택 기간 매일 (요일,시간대) baseline과 실제 편성이 다른 날만 반환. 경쟁채널 페어링은 채널당 여러 개일 수 있음(실측 확인, 최대 5~14개) — 최신 날짜부터 최대 500건.';

-- 4) 슬롯 중복 점검(요일 인식) — get_hourly_program_titles를 직접 고치면 Page 2 그래프 등 요일
--    구분이 필요 없는 기존 용도에 영향 위험이 있어(Delta-Only), 포트폴리오 슬롯 중복 전용으로
--    별도 함수를 추가한다. get_hourly_program_titles와 동일한 WHERE절에 dow만 group by에 추가.
create or replace function get_hourly_program_titles_by_dow(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  dow int,
  broadcast_hour int,
  program_names text
)
language sql
stable
as $$
  select
    extract(isodow from r.broadcast_date)::int as dow,
    (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as broadcast_hour,
    string_agg(distinct p.canonical_name, ' / ' order by p.canonical_name) as program_names
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  join programs p on p.id = r.program_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by dow, broadcast_hour
  order by dow, broadcast_hour;
$$;
comment on function get_hourly_program_titles_by_dow is 'Audience Report Phase 12: get_hourly_program_titles의 요일 인식 버전 — 포트폴리오 슬롯 중복 점검(computeSlotOverlap)이 같은 시간대라도 요일이 다르면 중복으로 안 잡도록 dow를 group by에 추가.';
