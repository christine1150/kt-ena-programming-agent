-- Page 2 기간별 브리핑 심화(사용자 지시, 2026-08-20 여섯 번째): "기간 설정 프리셋에 따라
-- 하단 보고서 내용이 달라져야 하고, 비교 기간 대비 시청률·점유율·연령대·시청시간·주요
-- 프로그램들이 어떻게 변했고 무엇이 전체 상승/하락을 이끌었는지 정확한 인사이트를 오늘의
-- 브리핑에 자세히 적어달라"는 지시. 전부 SQL이 실제로 집계한 값이고(CLAUDE.md: 암산 금지),
-- 프런트엔드는 문장만 조립한다(이 코드베이스의 기존 패턴 그대로).

-- 1) get_rating_period_report에 "전 기간"의 점유율·도달율·시청시간도 함께 내려주도록 확장한다
--    (지금까지는 시청률만 전/후 비교가 됐고 나머지 지표는 이번 기간 값만 있었음).
drop function if exists get_rating_period_report(text, text, date, date, int, date, date);

create or replace function get_rating_period_report(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_baseline_days int default 84,
  p_prior_date_from date default null,
  p_prior_date_to date default null
)
returns table (
  days_with_data bigint,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  avg_time_spent_share numeric,
  prior_period_avg_rating numeric,
  prior_period_change_pct numeric,
  prior_period_avg_share numeric,
  prior_period_avg_reach numeric,
  prior_period_avg_time_spent_seconds numeric,
  baseline_avg_rating numeric,
  baseline_change_pct numeric,
  best_date date,
  best_rating numeric,
  worst_date date,
  worst_rating numeric
)
language sql
stable
as $$
  with period as (
    select * from get_rating_summary(p_channel_code, p_target_label, p_date_from, p_date_to)
  ),
  prior as (
    select * from get_rating_summary(
      p_channel_code, p_target_label,
      coalesce(p_prior_date_from, p_date_from - (p_date_to - p_date_from + 1)),
      coalesce(p_prior_date_to, p_date_from - 1)
    )
  ),
  baseline as (
    select avg_rating as baseline_avg
    from get_rating_summary(p_channel_code, p_target_label, p_date_from - p_baseline_days, p_date_from - 1)
  ),
  extremes as (
    select r.broadcast_date, r.rating,
      row_number() over (order by r.rating desc) as rn_best,
      row_number() over (order by r.rating asc) as rn_worst
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between p_date_from and p_date_to
      and r.rating is not null
  )
  select
    period.days_with_data,
    round(period.avg_rating::numeric, 5),
    round(period.avg_share::numeric, 4),
    round(period.avg_reach::numeric, 4),
    round(period.avg_time_spent_seconds::numeric, 1),
    round(period.avg_time_spent_share::numeric, 4),
    round(prior.avg_rating::numeric, 5),
    pct_change(period.avg_rating, prior.avg_rating),
    round(prior.avg_share::numeric, 4),
    round(prior.avg_reach::numeric, 4),
    round(prior.avg_time_spent_seconds::numeric, 1),
    round(baseline.baseline_avg::numeric, 5),
    pct_change(period.avg_rating, baseline.baseline_avg),
    (select broadcast_date from extremes where rn_best = 1),
    (select round(rating::numeric, 5) from extremes where rn_best = 1),
    (select broadcast_date from extremes where rn_worst = 1),
    (select round(rating::numeric, 5) from extremes where rn_worst = 1)
  from period, prior, baseline;
$$;
comment on function get_rating_period_report is 'Page 2 기간 범위 선택 시 WHAT HAPPENED?/HOW DEEPLY?/브리핑에 쓰는 기간 요약: 기간 평균(시청률·점유율·도달율·시청시간), 직전 동일 길이 기간(또는 명시적으로 넘긴 p_prior_date_from/to) 대비(시청률·점유율·도달율·시청시간 전부), 최근 12주 평균 대비, 기간 중 최고/최저일.';

-- 2) 연령대별 기간 비교 — 이번 기간 vs 전 기간의 대표 연령대 구성비 변화.
create or replace function get_channel_period_demographics(
  p_channel_code text,
  p_demographic_labels text[],
  p_date_from date,
  p_date_to date,
  p_prior_date_from date,
  p_prior_date_to date
)
returns table (
  target_label text,
  period_avg_rating numeric,
  prior_avg_rating numeric,
  delta_pct numeric
)
language sql
stable
as $$
  with period as (
    select t.label, avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between p_date_from and p_date_to
    group by t.label
  ),
  prior as (
    select t.label, avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between p_prior_date_from and p_prior_date_to
    group by t.label
  )
  select
    coalesce(period.label, prior.label),
    round(period.avg_rating::numeric, 5),
    round(prior.avg_rating::numeric, 5),
    pct_change(period.avg_rating, prior.avg_rating)
  from period
  full outer join prior on prior.label = period.label;
$$;
comment on function get_channel_period_demographics is 'Page 2 기간별 브리핑: 대표 연령대별 이번 기간 vs 전 기간 평균 시청률·등락률.';

-- 3) 프로그램별 기간 비교("어떤 프로그램이 상승/하락을 이끌었는지") — 이번 기간과 전 기간 각각의
--    프로그램별 평균 시청률·방영횟수를 내고, |등락폭|이 큰 순으로 정렬한다. 상관관계 참고용이지
--    엄밀한 기여도 분해는 아니다(여러 프로그램이 동시에 바뀌면 "가장 크게 움직인 프로그램"이지
--    "그것 때문에 전체가 바뀌었다"는 인과 단정이 아님 — CLAUDE.md 원칙).
create or replace function get_channel_period_program_movers(
  p_channel_code text,
  p_program_target_label text,
  p_date_from date,
  p_date_to date,
  p_prior_date_from date,
  p_prior_date_to date,
  p_limit int default 20
)
returns table (
  canonical_name text,
  period_avg_rating numeric,
  period_air_count int,
  prior_avg_rating numeric,
  prior_air_count int,
  rating_delta numeric
)
language sql
stable
as $$
  with period as (
    select p.canonical_name, avg(r.rating) as avg_rating, count(*) as air_count
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.rating is not null
      and r.broadcast_date between p_date_from and p_date_to
    group by p.canonical_name
  ),
  prior as (
    select p.canonical_name, avg(r.rating) as avg_rating, count(*) as air_count
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.rating is not null
      and r.broadcast_date between p_prior_date_from and p_prior_date_to
    group by p.canonical_name
  )
  select
    coalesce(period.canonical_name, prior.canonical_name),
    round(period.avg_rating::numeric, 5),
    period.air_count::int,
    round(prior.avg_rating::numeric, 5),
    prior.air_count::int,
    round((coalesce(period.avg_rating, 0) - coalesce(prior.avg_rating, 0))::numeric, 5) as rating_delta
  from period
  full outer join prior on prior.canonical_name = period.canonical_name
  order by abs(coalesce(period.avg_rating, 0) - coalesce(prior.avg_rating, 0)) desc
  limit p_limit;
$$;
comment on function get_channel_period_program_movers is 'Page 2 기간별 브리핑: 프로그램별 이번 기간 vs 전 기간 평균 시청률·방영횟수, |등락폭| 큰 순. "가장 크게 움직인 프로그램" 참고 정보 — 인과관계 단정 아님.';
