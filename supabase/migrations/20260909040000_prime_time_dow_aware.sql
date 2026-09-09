-- 프라임(주요시간) 정의를 요일 구분형으로 통일(2026-09-09, 사용자 지시)
--
-- 사용자 확정: 주요시간은 평일 19~23시, 토·일·공휴일 18~23시. 경계는 기존 관례대로 반열림.
-- 그리고 "통일하되 Fit Score까지 전부" — 예외 없이 전 시스템을 이 정의 하나로 맞춘다.
--
-- 그 전까지 프라임은 세 가지로 갈라져 있었다:
--   · 20~24시 — get_channel_monthly_program_drivers 기본 파라미터, page1/route.ts, PPT 덱
--   · 17~23시 — Fit Score 전이성 판정(fit-score/route.ts)과 그 UI 문구
--   · 요일 구분 없음 — 세 정의 모두 평일/주말을 구분할 방법 자체가 없었다
--
-- 이 마이그레이션이 하는 일: get_channel_monthly_program_drivers를 요일 구분 프라임으로 재정의한다.
-- 프라임 파라미터가 2개(from/to) → 4개(평일 from/to, 주말 from/to)로 바뀌므로 drop 후 재생성한다.
-- RETURNS TABLE 20개 컬럼은 그대로 유지 — 호출부의 타입·표시 로직은 건드리지 않는다.
--
-- Fit Score 전이성 판정(fit-score/route.ts)은 SQL을 바꾸지 않는다. 그쪽이 쓰는
-- get_program_slot_efficiency는 여러 날짜를 시각(hour) 하나로 집계한 결과라 애초에 요일 정보가
-- 없고, 판정 로직도 "강세 슬롯의 hour가 프라임 시각 목록에 드는가"라는 멤버십 검사뿐이다.
-- 그래서 하드코딩돼 있던 [17..22] 배열을 primeTime.ts의 PRIME_HOURS_UNION(평일·주말 프라임의
-- 합집합 = 18~22시)으로 교체하는 것으로 통일한다. 이 함수의 집계 단위를 (요일×시각)으로 바꾸면
-- 슬롯당 표본이 쪼개져 GOLDEN/WEAK SLOT 판정(minAirCount 2, 중앙값 기준선)이 함께 흔들리므로
-- 건드리지 않는다 — Delta-Only.
-- 정직하게 밝히는 한계: 이 집계 단위에서는 "평일 18시(비프라임)"와 "토요일 18시(프라임)"를
-- 구분할 수 없어 합집합으로 판정한다.
--
-- 공휴일은 public_holidays(20260909030000)를 left join해 판정한다. 미등록 날짜는 추정하지 않고
-- 평일로 처리된다 — 억지 추정 금지(CLAUDE.md No Hallucination).

drop function if exists get_channel_monthly_program_drivers(text, text, date, date, date, date, int, int, int);
create function get_channel_monthly_program_drivers(
  p_channel_code text,
  p_program_target_label text,
  p_date_from date,
  p_date_to date,
  p_prior_date_from date,
  p_prior_date_to date,
  p_weekday_prime_from int default 19,
  p_weekday_prime_to int default 23,
  p_weekend_prime_from int default 18,
  p_weekend_prime_to int default 23,
  p_limit int default 40
)
returns table (
  canonical_name text,
  period_airings int,
  prior_airings int,
  period_avg_rating numeric,
  prior_avg_rating numeric,
  period_airtime_share numeric,
  prior_airtime_share numeric,
  contribution_delta numeric,
  volume_effect numeric,
  performance_effect numeric,
  period_prime_airings int,
  prior_prime_airings int,
  period_prime_avg_rating numeric,
  prior_prime_avg_rating numeric,
  prime_rating_delta numeric,
  main_prime_dow int,
  slot_baseline_rating numeric,
  slot_lift numeric,
  main_slot_dow int,
  main_slot_hour_block int
)
language sql
stable
as $$
  -- raw: 방영시간(자정 넘김은 epoch 추출 후 숫자 +1440 — time에 interval을 더하면 Postgres가
  -- 24시간으로 wrap해 음수가 되므로 반드시 이 순서여야 한다, 20260826030000에 문서화된 함정)와
  -- 방송 시간대(2시 미만 +24), 요일, 주말·공휴일 여부를 먼저 만든다.
  with raw as (
    select
      p.canonical_name as cn,
      r.rating as rt,
      (case when r.end_time > r.start_time
            then extract(epoch from (r.end_time - r.start_time)) / 60.0
            else extract(epoch from (r.end_time - r.start_time)) / 60.0 + 1440 end) as dur,
      (case when extract(hour from r.start_time) < 2
            then extract(hour from r.start_time)::int + 24
            else extract(hour from r.start_time)::int end) as bhour,
      extract(isodow from r.broadcast_date)::int as dow,
      (extract(isodow from r.broadcast_date) >= 6 or h.holiday_date is not null) as is_weekendlike,
      (case when r.broadcast_date between p_date_from and p_date_to then 1 else 0 end) as is_cur
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    left join public_holidays h on h.holiday_date = r.broadcast_date
    where c.code = p_channel_code
      and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily'
      and r.program_id is not null
      and r.rating is not null
      and r.start_time is not null
      and r.end_time is not null
      and (r.broadcast_date between p_date_from and p_date_to
        or r.broadcast_date between p_prior_date_from and p_prior_date_to)
  ),
  -- base: 요일 유형에 맞는 프라임 창을 적용해 행마다 프라임 여부를 확정한다.
  base as (
    select
      w.cn, w.rt, w.dur, w.bhour, w.dow, w.is_cur,
      (case when w.is_weekendlike
            then w.bhour >= p_weekend_prime_from and w.bhour < p_weekend_prime_to
            else w.bhour >= p_weekday_prime_from and w.bhour < p_weekday_prime_to end) as is_prime
    from raw w
  ),
  seg_total as (
    select b.is_cur as sc, sum(b.dur) as tot_dur
    from base b group by b.is_cur
  ),
  prior_hour as (
    select b.bhour as ph, sum(b.rt * b.dur) / nullif(sum(b.dur), 0) as hour_avg
    from base b where b.is_cur = 0 group by b.bhour
  ),
  agg as (
    select
      b.cn as cn,
      b.is_cur as sc,
      count(*)::int as airings,
      sum(b.dur) as dur_sum,
      sum(b.rt * b.dur) as mass,
      count(*) filter (where b.is_prime)::int as prime_airings,
      sum(b.dur) filter (where b.is_prime) as prime_dur,
      sum(b.rt * b.dur) filter (where b.is_prime) as prime_mass
    from base b
    group by b.cn, b.is_cur
  ),
  prime_dow as (
    select
      b.cn as cn,
      coalesce(
        mode() within group (order by b.dow) filter (where b.is_cur = 1),
        mode() within group (order by b.dow) filter (where b.is_cur = 0)
      ) as pdow
    from base b
    where b.is_prime
    group by b.cn
  ),
  slot_code as (
    select b.cn as cn, b.is_cur as sc,
      (b.dow * 100 + (2 + 3 * floor((b.bhour - 2) / 3.0))::int) as scode
    from base b
  ),
  main_slot as (
    select s.cn as cn,
      coalesce(
        mode() within group (order by s.scode) filter (where s.sc = 1),
        mode() within group (order by s.scode) filter (where s.sc = 0)
      ) as slot_code_val
    from slot_code s
    group by s.cn
  ),
  slot_base as (
    select b.cn as cn,
      sum(ph.hour_avg * b.dur) / nullif(sum(b.dur), 0) as base_rating
    from base b
    join prior_hour ph on ph.ph = b.bhour
    where b.is_cur = 1
    group by b.cn
  ),
  piv as (
    select
      a.cn as cn,
      coalesce(max(a.airings) filter (where a.sc = 1), 0) as air_m,
      coalesce(max(a.airings) filter (where a.sc = 0), 0) as air_p,
      max(a.mass / nullif(a.dur_sum, 0)) filter (where a.sc = 1) as rate_m,
      max(a.mass / nullif(a.dur_sum, 0)) filter (where a.sc = 0) as rate_p,
      coalesce(max(a.dur_sum / nullif((select s.tot_dur from seg_total s where s.sc = 1), 0)) filter (where a.sc = 1), 0) as w_m,
      coalesce(max(a.dur_sum / nullif((select s.tot_dur from seg_total s where s.sc = 0), 0)) filter (where a.sc = 0), 0) as w_p,
      coalesce(max(a.prime_airings) filter (where a.sc = 1), 0) as prime_air_m,
      coalesce(max(a.prime_airings) filter (where a.sc = 0), 0) as prime_air_p,
      max(a.prime_mass / nullif(a.prime_dur, 0)) filter (where a.sc = 1) as prime_rate_m,
      max(a.prime_mass / nullif(a.prime_dur, 0)) filter (where a.sc = 0) as prime_rate_p
    from agg a
    group by a.cn
  )
  select
    v.cn,
    v.air_m,
    v.air_p,
    round(v.rate_m::numeric, 5),
    round(v.rate_p::numeric, 5),
    round(v.w_m::numeric, 6),
    round(v.w_p::numeric, 6),
    round((v.w_m * coalesce(v.rate_m, 0) - v.w_p * coalesce(v.rate_p, 0))::numeric, 6),
    round(((v.w_m - v.w_p) * coalesce(v.rate_p, coalesce(v.rate_m, 0)))::numeric, 6),
    round((v.w_m * (coalesce(v.rate_m, 0) - coalesce(v.rate_p, coalesce(v.rate_m, 0))))::numeric, 6),
    v.prime_air_m,
    v.prime_air_p,
    round(v.prime_rate_m::numeric, 5),
    round(v.prime_rate_p::numeric, 5),
    round((coalesce(v.prime_rate_m, 0) - coalesce(v.prime_rate_p, 0))::numeric, 5),
    pd.pdow,
    round(sb.base_rating::numeric, 5),
    round((v.rate_m - sb.base_rating)::numeric, 5),
    (ms.slot_code_val / 100),
    (ms.slot_code_val % 100)
  from piv v
  left join prime_dow pd on pd.cn = v.cn
  left join slot_base sb on sb.cn = v.cn
  left join main_slot ms on ms.cn = v.cn
  order by abs(v.w_m * coalesce(v.rate_m, 0) - v.w_p * coalesce(v.rate_p, 0)) desc
  limit p_limit;
$$;
comment on function get_channel_monthly_program_drivers is
  '월간(또는 임의 기간) 리뷰의 "실질적 상승/하락 요인" 판정용 — 채널의 프로그램 단위 시간가중 평균 시청률 변화를 프로그램별로 정확히 분해한다(contribution_delta 전체 합 = 채널 평균의 실제 변화량, 항등식). volume_effect/performance_effect 항등 분해, slot_lift(전월 동시간대 평균 대비), prime_rating_delta·main_prime_dow(프라임 성과·주력 요일), main_slot_dow·main_slot_hour_block(일반 주력 슬롯). 2026-09-09: 프라임을 요일 구분형(평일 19~23시 / 토·일·공휴일 18~23시, public_holidays 참조)으로 재정의.';
