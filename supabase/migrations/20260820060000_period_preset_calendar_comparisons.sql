-- 기간 설정 프리셋 확장(사용자 지시, 2026-08-20 세 번째): 오늘/어제/지난 7일/지난 1달/연간/직접
-- 선택에 이어 "전일 대비 오늘"/"전주 대비 이번주(WoW)"/"전월 대비 이번달(MoM)"/"전분기 대비
-- 이번분기(QoQ)"/"전년 동기 대비 이번년도 누적(YoY)" 5개 비교 분석 프리셋을 추가한다.
--
-- 이 프리셋들은 "이번 기간"(예: 이번주 = 이번주 월요일~오늘)과 "전 기간"(예: 전주 = 지난주
-- 월요일~지난주의 같은 요일)을 달력 기준으로 정확히 맞춰서 비교해야 한다 — 기존
-- get_rating_period_report의 "직전 동일 길이 기간"(선택 기간 시작일 바로 앞으로 같은 일수만큼)
-- 자동 계산 방식은 이 요구에 맞지 않는다(예: WoW에서 "이번주"가 4일(월~목)뿐이면 자동 계산은
-- "그 4일 바로 앞"인 지난주 목~일을 비교 대상으로 삼아버려 "지난주 월~목"과 비교되지 않는다).
-- 그래서 프런트엔드(ChannelDeepDive.tsx)가 달력 기준으로 정확히 계산한 "전 기간" 날짜를
-- p_prior_date_from/p_prior_date_to로 명시적으로 넘길 수 있도록 확장한다 — 안 넘기면(기존 호출)
-- 기존 자동 계산 그대로 동작해 지난 7일/1달/연간(YTD)의 "직전 동일 길이 기간 대비" 표시는
-- 그대로 유지된다.
--
-- 인자를 추가하면 Postgres가 "create or replace"를 오버로드(별도 함수)로 취급해 PostgREST가
-- 함수를 특정 못 하는 문제를 이전에 겪었다(20260820050000 참고) — 기존 시그니처를 먼저 지운다.
drop function if exists get_rating_period_report(text, text, date, date, int);

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
    select avg_rating as prior_avg
    from get_rating_summary(
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
    round(prior.prior_avg::numeric, 5),
    pct_change(period.avg_rating, prior.prior_avg),
    round(baseline.baseline_avg::numeric, 5),
    pct_change(period.avg_rating, baseline.baseline_avg),
    (select broadcast_date from extremes where rn_best = 1),
    (select round(rating::numeric, 5) from extremes where rn_best = 1),
    (select broadcast_date from extremes where rn_worst = 1),
    (select round(rating::numeric, 5) from extremes where rn_worst = 1)
  from period, prior, baseline;
$$;
comment on function get_rating_period_report is 'Page 2 기간 범위 선택 시 WHAT HAPPENED?/HOW DEEPLY?/브리핑에 쓰는 기간 요약: 기간 평균, 직전 동일 길이 기간(또는 명시적으로 넘긴 p_prior_date_from/to) 대비, 최근 12주 평균 대비, 기간 중 최고/최저일. date_from=date_to(단일 일자)에서도 정상 동작.';
