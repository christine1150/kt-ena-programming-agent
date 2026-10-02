-- 콘텐츠 구매 시뮬레이터 2단계: 예측 입력 RPC + 예측 스냅샷 + 구간 보정 테이블.
--
-- 설계 원칙(백테스트 하네스 2026-10-02 결과 반영):
--  - 대량 집계는 DB에서(채널×슬롯×윈도우 합계), 지수·수축·구간·신뢰도 계산은 TypeScript 결정론 함수가 한다.
--  - 모든 조회는 broadcast_date <= p_as_of 를 SQL에서 강제한다(미래 데이터 누수 차단, 백테스트와 실시간이 같은 RPC).
--  - 시청률 NULL은 표본 제외, 0은 실측 0으로 포함. 새 테이블(competitor_program_target_ratings)은 방영×타깃 행이라
--    반드시 target_label 로 먼저 거른다.
--  - 슬롯 = 요일유형(평일/토/일) × 3시간 블록(02-05 … 23-26). 자판기의 8대 시간대 경계와 같다.
--  - RETURNS TABLE 대신 jsonb 로 돌려줘 plpgsql 컬럼명 충돌(42702)을 피한다.

-- 슬롯 키: 'WD|6'(평일 20~23시) 형태. 00~01시 시작은 방송일의 24~25시대로 취급한다.
create or replace function purchase_slot(p_date date, p_start time)
returns text
language sql
immutable
as $$
  select (case extract(isodow from p_date)::int when 6 then 'SAT' when 7 then 'SUN' else 'WD' end)
         || '|'
         || ((case when extract(hour from p_start)::int < 2 then extract(hour from p_start)::int + 24 else extract(hour from p_start)::int end) - 2) / 3
$$;

create or replace function get_purchase_sim_inputs(
  p_group_keys text[],          -- 같은 콘텐츠로 묶인 프로그램 정규화 키(대문자, purchase_norm_key)
  p_own_channel_code text,      -- 구매 후 편성할 자사 채널 코드 (ENA_PLAY 등)
  p_target text,                -- 'A2049'(경쟁 개인2049 ↔ 자사 수도권 2049) | 'HH'(경쟁 유료방송가구 ↔ 자사 전국 유료가구)
  p_as_of date,                 -- 이 날짜(포함) 이전 데이터만 사용
  p_windows int[] default array[28, 84, 182, 364]
)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_comp_label text;
  v_own_label text;
  v_own_ch uuid;
  v_own_tid uuid;
  v_from date;
  v_out jsonb;
begin
  v_comp_label := case p_target when 'A2049' then '개인2049' when 'HH' then '유료방송가구' end;
  v_own_label := case p_target when 'A2049' then '수도권 2049' when 'HH' then '전국 유료가구' end;
  if v_comp_label is null then
    raise exception 'unsupported target %', p_target;
  end if;
  select ch.id into v_own_ch from channels ch where ch.code = p_own_channel_code;
  select tg.id into v_own_tid from targets tg where tg.label = v_own_label;
  select p_as_of - max(w) + 1 into v_from from unnest(p_windows) as w;

  with wins as (
    select w from unnest(p_windows) as w
  ),
  comp as (
    select c.competitor_name as ch, c.broadcast_date as d, purchase_slot(c.broadcast_date, c.start_time) as slot,
           c.rating as r, upper(c.norm_program_name) as k, (c.program_name like '%<재>%') as jae
    from competitor_program_target_ratings c
    where c.target_label = v_comp_label
      and c.broadcast_date between v_from and p_as_of
      and c.rating is not null
  ),
  prog_ch as (
    select distinct cp.ch from comp cp where cp.k = any (p_group_keys)
  ),
  chan_slots as (
    select ww.w, cp.ch, cp.slot, sum(cp.r) as cs_sum, count(*) as cs_n
    from comp cp
    join prog_ch pc on pc.ch = cp.ch
    join wins ww on cp.d >= p_as_of - ww.w + 1
    group by ww.w, cp.ch, cp.slot
  ),
  prog_slots as (
    select ww.w, cp.ch, cp.slot, sum(cp.r) as ps_sum, count(*) as ps_n, count(*) filter (where cp.jae) as ps_jae,
           min(cp.d) as first_d, max(cp.d) as last_d
    from comp cp
    join wins ww on cp.d >= p_as_of - ww.w + 1
    where cp.k = any (p_group_keys)
    group by ww.w, cp.ch, cp.slot
  ),
  own as (
    select r.broadcast_date as d, purchase_slot(r.broadcast_date, r.start_time) as slot, r.rating as r,
           purchase_norm_key(pr.canonical_name) as k
    from ratings r
    join programs pr on pr.id = r.program_id
    where r.channel_id = v_own_ch
      and r.target_id = v_own_tid
      and r.source_type = 'nielsen_daily'
      and r.broadcast_date between v_from and p_as_of
      and r.rating is not null
  ),
  own_chan_slots as (
    select ww.w, o.slot, sum(o.r) as cs_sum, count(*) as cs_n
    from own o join wins ww on o.d >= p_as_of - ww.w + 1
    group by ww.w, o.slot
  ),
  own_prog_slots as (
    select ww.w, o.slot, sum(o.r) as ps_sum, count(*) as ps_n, min(o.d) as first_d, max(o.d) as last_d
    from own o join wins ww on o.d >= p_as_of - ww.w + 1
    where o.k = any (p_group_keys)
    group by ww.w, o.slot
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'windows', to_jsonb(p_windows),
    'target', p_target,
    'own_channel', p_own_channel_code,
    'peer_chan_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'ch', t.ch, 'slot', t.slot, 'sum', t.cs_sum, 'n', t.cs_n)) from chan_slots t), '[]'::jsonb),
    'peer_prog_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'ch', t.ch, 'slot', t.slot, 'sum', t.ps_sum, 'n', t.ps_n, 'jae', t.ps_jae, 'first', t.first_d, 'last', t.last_d)) from prog_slots t), '[]'::jsonb),
    'own_chan_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'slot', t.slot, 'sum', t.cs_sum, 'n', t.cs_n)) from own_chan_slots t), '[]'::jsonb),
    'own_prog_slots', coalesce((select jsonb_agg(jsonb_build_object('w', t.w, 'slot', t.slot, 'sum', t.ps_sum, 'n', t.ps_n, 'first', t.first_d, 'last', t.last_d)) from own_prog_slots t), '[]'::jsonb),
    'comp_max_date', (select max(c2.broadcast_date) from competitor_program_target_ratings c2 where c2.broadcast_date <= p_as_of),
    'own_max_date', (select max(o2.d) from own o2)
  ) into v_out;
  return v_out;
end;
$$;

-- 같은 요일·시간대의 경쟁 편성(표시 전용 — 예측값에는 반영하지 않음: 경쟁 강도 보정은 백테스트 검증 전).
create or replace function get_purchase_sim_competition(
  p_isodow int,
  p_start_hour int,             -- 방송일 기준 시(00~01시는 24~25)
  p_target text,
  p_as_of date,
  p_window_days int default 91,
  p_limit int default 8
)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_label text;
  v_out jsonb;
begin
  v_label := case p_target when 'A2049' then '개인2049' when 'HH' then '유료방송가구' end;
  select coalesce(jsonb_agg(t order by t.avg_rating desc), '[]'::jsonb) into v_out
  from (
    select c.competitor_name as ch,
           regexp_replace(c.program_name, '<[^>]*>', '', 'g') as program,
           round(avg(c.rating)::numeric, 5) as avg_rating,
           count(*)::int as n
    from competitor_program_target_ratings c
    where c.target_label = v_label
      and c.rating is not null
      and c.broadcast_date between p_as_of - p_window_days + 1 and p_as_of
      and extract(isodow from c.broadcast_date)::int = p_isodow
      and (case when extract(hour from c.start_time)::int < 2 then extract(hour from c.start_time)::int + 24 else extract(hour from c.start_time)::int end) = p_start_hour
    group by c.competitor_name, regexp_replace(c.program_name, '<[^>]*>', '', 'g')
    having count(*) >= 2
    order by avg(c.rating) desc
    limit greatest(p_limit, 1)
  ) t;
  return v_out;
end;
$$;

-- 예측 스냅샷(재현·사후 비교용). 실시간 예측과 백테스트가 같은 테이블을 쓴다(is_backtest 로 구분).
create table rating_predictions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text,
  model_version text not null,
  as_of date not null,                       -- prediction_cutoff_date: 이 날짜 이후 데이터는 쓰지 않음
  own_channel_code text not null,
  target text not null check (target in ('A2049', 'HH')),
  program_group_key text not null,
  program_name text not null,
  identity_confidence numeric,
  scheduled_isodow int,
  scheduled_start text,                      -- "HH:MM"
  slot text not null,
  case_type text not null check (case_type in ('PEER', 'OWN', 'OWN_PEER', 'NONE')),
  baseline_rating numeric,                   -- 편성 슬롯 자사 기준값(그 프로그램 제외 평균)
  content_index numeric,                     -- 최종 콘텐츠 지수(슬롯 평균 대비 배수)
  peer_index numeric,
  own_index numeric,
  own_weight numeric,
  prediction_rating numeric,
  prediction_low numeric,
  prediction_high numeric,
  interval_level numeric,                    -- 구간 수준(예: 0.8 = 80%)
  confidence text,                           -- HIGH | MEDIUM | LOW | INSUFFICIENT
  sample_counts jsonb,
  components jsonb,                          -- 계산 근거 전체(화면 "왜 이 숫자인가")
  is_backtest boolean not null default false,
  backtest_run_id text,
  case_key text,                             -- 백테스트 케이스 식별(월|채널|프로그램)
  actual_rating numeric,
  absolute_error numeric,
  relative_error numeric,
  actual_filled_at timestamptz
);
create index rating_predictions_bt_idx on rating_predictions (is_backtest, backtest_run_id);
create index rating_predictions_prog_idx on rating_predictions (own_channel_code, program_group_key, created_at desc);
alter table rating_predictions enable row level security;
comment on table rating_predictions is '구매 시뮬레이터 예측 스냅샷(2026-10-02). model_version·as_of 로 재현하고, 방송 후 actual_rating 을 채워 오차를 기록한다.';

-- 예측 구간 보정: 백테스트 잔차 ln((실제+eps)/(예측+eps))의 분위수. 구간은 임의 ±% 가 아니라 이 값에서 나온다.
create table purchase_sim_calibration (
  id uuid primary key default gen_random_uuid(),
  model_version text not null,
  target text not null,
  scenario text not null,                    -- PEER | OWN_PEER 등(증거 유형) × 시청률 수준
  n int not null,
  q05 numeric, q10 numeric, q25 numeric, q50 numeric, q75 numeric, q90 numeric, q95 numeric,
  mae_log numeric,
  backtest_run_id text,
  created_at timestamptz not null default now(),
  unique (model_version, target, scenario)
);
alter table purchase_sim_calibration enable row level security;
comment on table purchase_sim_calibration is '구매 시뮬레이터 예측 구간 보정(백테스트 잔차 분위수). scripts/backtest-purchase-sim.mts 가 채운다.';
