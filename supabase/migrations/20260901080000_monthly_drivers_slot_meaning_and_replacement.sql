-- 사용자 지시(2026-09-01): "월간 시청률 분석에서 상승 견인 및 하락 요인이 된 컨텐츠들 확인이
-- 맞는지 재확인 필요. 처음부터 복합적으로 재검토 필요." 구체적으로 지적한 문제 2가지:
--
-- (1) "ENA Play의 <캐리어하나로 떠나는 주문 짐쌀라비움>은 동시간대 대비 0.004인데 상승을
--     견인했다고 나옴. 이 경우는 동시간대 전월의 평균을 보고, 그것보다 상승 또는 하락했을 때
--     의미가 있다고 해야" — 기존 로직(20260901040000)은 slot_lift(전월 동시간대 평균 대비)를
--     "표시"만 하고 "선정 기준"으로는 안 썼다. contribution_delta(채널 기여도) 1위라는 이유만으로
--     슬롯 차원에서는 사실상 변화가 없는(0.004) 프로그램이 "상승 견인"으로 뽑혔다 — 이번
--     마이그레이션은 SQL을 바꾸지 않는다(값은 이미 다 있음, route.ts에서 이 값으로 게이트를
--     추가). 대신 아래 (2)를 위한 값을 새로 낸다.
--
-- (2) "ENA Play와 Drama 모두 쯔양몇기가 빠져서 하락 요인이라고 적었는데... 어떤것을 넣었길래
--     시청률이 빠졌는지를 적어줘야함" / "ONCE의 하나뿐인내편도 빠지고 나서 뭐가 들어갔는데,
--     컨텐츠 교체 이후로 하락을 가져왔는지 분석해서 작성해주어야 함" — 편성이 크게 줄거나
--     종영된 프로그램의 "원래 자리"(요일×시간대, 8구간)에 이번 달 무엇이 대신 들어왔는지 알아야
--     한다. 기존 함수는 main_prime_dow(프라임 20~24시 한정)만 냈지, 프라임이 아닌 시간대를
--     포함한 "일반 주력 슬롯"(요일+시간대구간)은 내지 않았다.
--
-- 반영: get_channel_monthly_program_drivers에 main_slot_dow/main_slot_hour_block(일반 주력
-- 슬롯, 이번 달 우선·없으면 전월 — main_prime_dow와 같은 coalesce 패턴이지만 프라임 제한 없음)
-- 2개 컬럼을 추가한다. RETURNS TABLE 컬럼이 늘어나 create or replace로는 안 되므로(반환형
-- 변경은 Postgres가 replace를 막는다) drop 후 재생성한다. 시간대구간(2,5,8,11,14,17,20,23)
-- 정의는 get_channel_dow_hourblock_pattern과 동일(이 프로젝트 관례 그대로 재사용).
--
-- 그 주력 슬롯에 "지금 무엇이 들어왔는지"는 별도 함수 get_channel_slot_current_occupant로 낸다
-- (프로그램별 함수가 아니라 채널+요일+시간대구간 단위 조회라 별도 함수가 자연스럽다 — 여러
-- 프로그램의 옛 슬롯을 재사용할 수도 있고, 호출부(route.ts)가 필요한 만큼만 부른다).
drop function if exists get_channel_monthly_program_drivers(text, text, date, date, date, date, int, int, int);
create function get_channel_monthly_program_drivers(
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
  slot_lift numeric,
  main_slot_dow int,
  main_slot_hour_block int
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
  -- 일반 주력 슬롯(프라임 한정 아님) — 요일×3시간구간(02,05,08,11,14,17,20,23)을 하나의 정수
  -- (요일*100+구간시작시각)로 인코딩해 mode()로 최빈값을 뽑고 다시 분해한다. 이번 달 우선,
  -- 이번 달에 방영이 아예 없으면(종영) 전월 최빈 슬롯으로 폴백 — main_prime_dow와 같은 원칙.
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
  '월간(또는 임의 기간) 리뷰의 "실질적 상승/하락 요인" 판정용 — 채널의 프로그램 단위 시간가중 평균 시청률 변화를 프로그램별로 정확히 분해한다(contribution_delta 전체 합 = 채널 평균의 실제 변화량, 항등식). volume_effect/performance_effect 항등 분해, slot_lift(전월 동시간대 평균 대비), prime_rating_delta·main_prime_dow(프라임 20~24시 성과·주력 요일), main_slot_dow·main_slot_hour_block(일반 주력 슬롯 — 요일×3시간구간, 프라임 한정 아님, 종영 시 전월 슬롯으로 폴백)을 반환. 2026-09-01(20260901080000) main_slot_* 추가.';

-- 슬롯 대체 콘텐츠 조회 — 어떤 프로그램의 주력 슬롯(요일+시간대구간)에 이번 달 무엇이 편성됐는지.
-- get_channel_monthly_program_drivers가 낸 main_slot_dow/main_slot_hour_block을 그대로 넘겨
-- 부른다. 다른 함수들과 같은 8구간 정의 재사용, 순수 group-by(새 계산 아님).
create or replace function get_channel_slot_current_occupant(
  p_channel_code text,
  p_program_target_label text,
  p_date_from date,
  p_date_to date,
  p_dow int,
  p_hour_block int
)
returns table (
  canonical_name text,
  air_count int,
  avg_rating numeric
)
language sql
stable
as $$
  select
    p.canonical_name as cn,
    count(*)::int as ac,
    round(avg(r.rating)::numeric, 5) as ar
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
    and extract(isodow from r.broadcast_date)::int = p_dow
    and (2 + 3 * floor((
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) - 2
    ) / 3.0))::int = p_hour_block
    and r.broadcast_date between p_date_from and p_date_to
  group by p.canonical_name
  order by count(*) desc, avg(r.rating) desc
  limit 2;
$$;
comment on function get_channel_slot_current_occupant is
  '월간 리뷰 하락 요인의 "대체 콘텐츠" 분석용(2026-09-01) — 특정 채널·요일·시간대구간(8구간)에 지정 기간 동안 실제로 방영된 프로그램을 편성 횟수·평균 시청률 순으로 최대 2개 반환. 편성이 크게 줄거나 종영된 프로그램의 이전 주력 슬롯에 지금 무엇이 들어왔는지 확인하는 데 쓴다.';
