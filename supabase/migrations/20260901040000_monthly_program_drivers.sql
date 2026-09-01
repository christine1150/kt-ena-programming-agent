-- 사용자 지시(2026-09-01): "주간/월간 리뷰 등은 합산 기여도로만 뽑으면 안 돼요. 전월 동시간
-- 평균 대비 기여가 있다던가, 특히 요일별 20시~24시 사이의 오리지널이나 주요 프로그램에서
-- 특별한 등락이나 하락이 있다던가 하는 부분도 모두 반영해야 해요."
--
-- 배경: 직전 로직은 get_channel_period_program_movers(회당 평균 등락)를 편성 횟수로 곱한
-- "합산 기여도"였는데, 이건 (a) 방영 길이를 무시해 30분물과 2시간물을 같은 무게로 세고,
-- (b) 채널의 실제 월간 시청률 변화와 수치적으로 연결되지 않으며(총합이 무엇과도 일치하지 않음),
-- (c) 편성이 늘어서 오른 것인지 프로그램이 잘돼서 오른 것인지 구분하지 못했다.
--
-- 이 함수는 그 대신 **채널 월간 평균 시청률 변화를 프로그램별로 정확히 분해**한다.
-- 채널의 프로그램 단위 월간 평균(방영시간 가중) = Σ(rating×분) / Σ(분) 이므로,
--   프로그램 k의 기여도  contribution_k = (rating_k 평균) × (k의 방영시간 점유율 w_k)
--   Σ_k contribution_k = 그 달 채널 평균          ← 항등식
--   Σ_k (contribution_k(이번달) − contribution_k(전월)) = 채널 평균의 실제 변화량  ← 항등식
-- 즉 여기서 나오는 contribution_delta는 "이 프로그램이 채널 월간 평균을 몇 %p 올렸/내렸는가"
-- 라는 검증 가능한 수치다(전 프로그램 합이 실제 변화량과 일치 — 임의 가중치가 아님).
--
-- 그 변화를 다시 두 원인으로 정확히 쪼갠다(합이 contribution_delta와 일치하는 항등 분해):
--   volume_effect      = (w_이번달 − w_전월) × rating_전월      … 편성량이 바뀌어서 생긴 몫
--   performance_effect = w_이번달 × (rating_이번달 − rating_전월) … 프로그램 성과가 바뀌어서 생긴 몫
-- 이걸로 "편성을 늘려서 오른 것"과 "작품이 잘돼서 오른 것"을 구분해 명시할 수 있다.
--
-- 추가로 사용자가 지목한 두 축을 함께 반환한다:
--   1) 전월 동시간대 평균 대비(slot_lift): 이 프로그램이 이번 달 방영된 시간대들이 전월에 내던
--      평균 성적(slot_baseline_rating)과 비교해 얼마나 더/덜 냈는지 — "그 시간대 원래 수준"
--      대비 실질 기여. 새 슬롯에 들어간 프로그램의 성패를 판단하는 축.
--   2) 프라임(기본 20~24시) 성과와 그 주력 요일(main_prime_dow): 오리지널·주요 편성이 몰린
--      구간의 등락만 따로 떼어 본다. 채널 전체 기여도는 작아도 프라임에서 크게 빠진 작품을
--      놓치지 않기 위함.
--
-- 방영 길이는 end_time − start_time(자정 넘김이면 +1440분)으로 계산한다 — 실측 확인 결과
-- ratings.end_time은 100% 채워져 있다(ENA 2026-08 기준 556행 전부).
-- 시간대 정규화는 이 프로젝트의 기존 관례(get_hourly_rating_pattern)와 동일하게 2시 미만은
-- +24로 밀어 방송일 기준 2~25시로 다룬다.
--
-- language sql(plpgsql 아님) + 모든 CTE 컬럼을 RETURNS TABLE 컬럼명과 다른 이름으로 두어
-- 이 프로젝트에서 반복됐던 "column reference is ambiguous" 런타임 오류를 원천 차단한다.
create or replace function get_channel_monthly_program_drivers(
  p_channel_code text,
  p_program_target_label text,
  p_date_from date,
  p_date_to date,
  p_prior_date_from date,
  p_prior_date_to date,
  p_prime_hour_from int default 20,
  p_prime_hour_to int default 24,
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
  slot_lift numeric
)
language sql
stable
as $$
  with base as (
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
      (case when r.broadcast_date between p_date_from and p_date_to then 1 else 0 end) as is_cur
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
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
  -- 세그먼트별 총 방영시간(점유율 w의 분모). 이 값이 0이면 그 달 자체가 비어 있는 것.
  seg_total as (
    select b.is_cur as sc, sum(b.dur) as tot_dur
    from base b group by b.is_cur
  ),
  -- 전월의 시간대별 평균 성적 — "전월 동시간 평균" 기준선.
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
      count(*) filter (where b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to)::int as prime_airings,
      sum(b.dur) filter (where b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to) as prime_dur,
      sum(b.rt * b.dur) filter (where b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to) as prime_mass
    from base b
    group by b.cn, b.is_cur
  ),
  -- 프라임 주력 요일 — 이번 달 프라임 방영분 중 가장 잦은 요일(없으면 null).
  prime_dow as (
    select b.cn as cn, mode() within group (order by b.dow) as pdow
    from base b
    where b.is_cur = 1 and b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to
    group by b.cn
  ),
  -- 이번 달 방영 시간대들의 전월 평균(방영시간 가중) — 기준선이 있는 시간대만 평균낸다.
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
    -- 기여도 변화 = w_m×r_m − w_p×r_p (없는 쪽은 0으로 — 신규 편성/종영을 그대로 반영)
    round((v.w_m * coalesce(v.rate_m, 0) - v.w_p * coalesce(v.rate_p, 0))::numeric, 6),
    -- 편성량 효과 + 성과 효과 = 기여도 변화 (항등 분해)
    round(((v.w_m - v.w_p) * coalesce(v.rate_p, coalesce(v.rate_m, 0)))::numeric, 6),
    round((v.w_m * (coalesce(v.rate_m, 0) - coalesce(v.rate_p, coalesce(v.rate_m, 0))))::numeric, 6),
    v.prime_air_m,
    v.prime_air_p,
    round(v.prime_rate_m::numeric, 5),
    round(v.prime_rate_p::numeric, 5),
    round((coalesce(v.prime_rate_m, 0) - coalesce(v.prime_rate_p, 0))::numeric, 5),
    pd.pdow,
    round(sb.base_rating::numeric, 5),
    round((v.rate_m - sb.base_rating)::numeric, 5)
  from piv v
  left join prime_dow pd on pd.cn = v.cn
  left join slot_base sb on sb.cn = v.cn
  order by abs(v.w_m * coalesce(v.rate_m, 0) - v.w_p * coalesce(v.rate_p, 0)) desc
  limit p_limit;
$$;
comment on function get_channel_monthly_program_drivers is
  '월간(또는 임의 기간) 리뷰의 "실질적 상승/하락 요인" 판정용 — 채널의 프로그램 단위 시간가중 평균 시청률 변화를 프로그램별로 정확히 분해한다(contribution_delta 전체 합 = 채널 평균의 실제 변화량, 항등식). 그 변화를 편성량 효과(volume_effect)와 성과 효과(performance_effect)로 다시 항등 분해하고, 전월 동시간대 평균 대비(slot_lift)와 프라임(기본 20~24시) 성과·주력 요일(main_prime_dow)을 함께 반환한다. 방영 길이 가중이라 30분물과 2시간물을 같은 무게로 세지 않는다. 2026-09-01 신설.';
