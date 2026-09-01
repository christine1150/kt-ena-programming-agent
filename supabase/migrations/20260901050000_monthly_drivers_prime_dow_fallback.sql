-- 후속 수정(2026-09-01): 20260901040000에서 main_prime_dow를 "이번 달 프라임 방영분의 최빈 요일"
-- 로만 계산했더니, 이번 달에 편성이 끊긴 프로그램(= 하락 요인으로 가장 중요한 케이스)은 이번 달
-- 프라임 방영이 0회라 요일이 항상 null로 나왔다 — 실측: ENA "닥터섬보이", ONCE "제빵왕김탁구"가
-- 프라임 주요 하락으로 정확히 잡혔는데 요일 칸만 비어 있었다.
-- 사용자 지시가 "요일별 20~24시 ... 특별한 등락이나 하락"이라 하락 쪽 요일이 오히려 더 필요하다.
-- 이번 달 프라임 요일이 없으면 전월 프라임 요일로 폴백한다(그 프로그램이 원래 어느 요일 프라임에
-- 있었는지를 알려주는 것이 목적이므로 의미가 정확히 맞는다). 나머지 로직은 20260901040000과 동일.
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
      count(*) filter (where b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to)::int as prime_airings,
      sum(b.dur) filter (where b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to) as prime_dur,
      sum(b.rt * b.dur) filter (where b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to) as prime_mass
    from base b
    group by b.cn, b.is_cur
  ),
  -- 이번 달 프라임 최빈 요일, 없으면 전월 프라임 최빈 요일로 폴백(이번 수정의 핵심).
  prime_dow as (
    select
      b.cn as cn,
      coalesce(
        mode() within group (order by b.dow) filter (where b.is_cur = 1),
        mode() within group (order by b.dow) filter (where b.is_cur = 0)
      ) as pdow
    from base b
    where b.bhour >= p_prime_hour_from and b.bhour < p_prime_hour_to
    group by b.cn
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
    round((v.rate_m - sb.base_rating)::numeric, 5)
  from piv v
  left join prime_dow pd on pd.cn = v.cn
  left join slot_base sb on sb.cn = v.cn
  order by abs(v.w_m * coalesce(v.rate_m, 0) - v.w_p * coalesce(v.rate_p, 0)) desc
  limit p_limit;
$$;
