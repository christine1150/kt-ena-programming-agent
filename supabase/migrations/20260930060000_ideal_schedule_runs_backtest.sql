-- 이상적 1주일 편성 STEP 4(2026-09-30): 실행 결과·대체 후보·백테스트 저장소. 설계 문서 D-1·I절.
--
-- - ideal_schedule_runs: 실행 1회(입력 파라미터·설정 스냅샷·입력 지문·요약·충돌 목록). 같은 입력·같은 설정이면
--   input_fingerprint가 같고 엔진 결과도 같다(결정론).
-- - ideal_schedule_blocks: 편성 블록. layer='IDEAL'은 엔진 결과, layer='CURRENT'는 비교 기준인 현재(실제) 편성을
--   같은 모델로 평가한 값 — 비교 화면이 DB만 읽고 그릴 수 있게 함께 저장한다.
--   모든 수치는 엔진 계산값 그대로(LLM·화면이 새로 계산하지 않음). reasons는 선정 이유 구조화 데이터 —
--   자연어 설명은 반드시 이 값만 근거로 만든다.
-- - ideal_schedule_candidates: 블록별 대체 후보 상위 N(Swap 화면).
-- - ideal_schedule_backtest_runs/results: Walk-forward 백테스트(대상 주 이후 데이터는 모델에 쓰지 않음).
-- 기존 테이블 변경 없음. RLS: 서버(service_role)만 접근(20260909010000과 같은 모델).

create table ideal_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  week_start date not null,
  as_of_date date not null,
  structure_mode text not null check (structure_mode in ('KEEP_CURRENT','AI_OPTIMIZED')),
  strategy_mode text not null check (strategy_mode in ('AUTO','MATCH','COUNTER','MIX')),
  benchmark_placement text not null check (benchmark_placement in ('SUGGEST_ONLY','MIX')),
  competitor_names text[] not null default '{}',
  competitor_target_mode text,
  optimize_target_label text not null, -- 이 편성안이 최적화한 타깃(채널 KPI 또는 사용자가 고른 타깃)
  optimize_target_is_channel_kpi boolean not null,
  config_snapshot jsonb not null,
  input_fingerprint text not null,
  objective numeric,
  summary jsonb not null,
  conflicts jsonb not null default '[]'::jsonb,
  resolution jsonb not null default '{}'::jsonb, -- 대체됨·중복·비활성·경고
  gaps jsonb not null default '[]'::jsonb,
  empty_slots jsonb not null default '[]'::jsonb,
  current_week_start date, -- CURRENT 레이어로 쓴 실제 편성 주
  status text not null check (status in ('DONE','CONFLICT')),
  needs_recalc boolean not null default false, -- Swap 후 합계·이웃 점수가 갱신되지 않은 상태
  parent_run_id uuid references ideal_schedule_runs(id) on delete set null,
  engine_ms int,
  created_by text,
  created_at timestamptz not null default now()
);
create index idx_ideal_schedule_runs_channel on ideal_schedule_runs (channel_id, week_start, created_at desc);
comment on table ideal_schedule_runs is '이상적 1주일 편성 실행 1회(2026-09-30). 기대값은 "최근 12주 데이터 기반 기대 시청률"이며 실제 미래 시청률 예측이 아니다.';

create table ideal_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references ideal_schedule_runs(id) on delete cascade,
  layer text not null default 'IDEAL' check (layer in ('IDEAL','CURRENT')),
  weekday int not null check (weekday between 1 and 7),
  start_min numeric not null,
  end_min numeric not null,
  program_id uuid references programs(id) on delete set null,
  candidate_key text not null,
  program_key text not null,
  program_name text not null,
  content_type text not null check (content_type in ('OWN','COMPETITOR_BENCHMARK','ARCHETYPE')),
  source_channel text,
  genre text,
  airing_type text,
  status text not null check (status in ('LOCKED','REQUIRED','AI','MANUAL_OVERRIDE','CURRENT')),
  locked boolean not null default false,
  time_changed boolean,
  expected_kpi numeric,
  expected_kpi_type text check (expected_kpi_type in ('HISTORICAL_EXPECTED','BENCHMARK_TRANSFER')),
  expected_share numeric,
  expected_time_spent numeric,
  baseline numeric,
  confidence_score numeric,
  sample_count int,
  fallback_level int,
  strategy_type text check (strategy_type in ('MATCH','COUNTER','NEUTRAL')),
  competitor_slot_strength numeric,
  benchmark_index numeric,
  match_score numeric,
  counter_score numeric,
  fitness_score numeric,
  block_value numeric,
  score_components jsonb,
  penalties jsonb,
  reasons jsonb,
  constraint_ref jsonb,
  actual_kpi numeric, -- CURRENT 레이어가 실제 방영 주일 때 실측값(비교용)
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (run_id, layer, weekday, start_min)
);
create index idx_ideal_schedule_blocks_run on ideal_schedule_blocks (run_id, layer, weekday, start_min);

create table ideal_schedule_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references ideal_schedule_runs(id) on delete cascade,
  block_id uuid not null references ideal_schedule_blocks(id) on delete cascade,
  rank int not null,
  candidate jsonb not null, -- 후보 식별(키·이름·유형·장르·runtime·출처 채널·Benchmark 정보)
  expected_kpi numeric,
  expected_kpi_type text,
  expected_share numeric,
  expected_time_spent numeric,
  confidence_score numeric,
  sample_count int,
  fallback_level int,
  fitness_score numeric,
  block_value numeric,
  target_score numeric,
  slot_fit numeric,
  strategy_type text,
  strategy jsonb,
  score_components jsonb,
  penalties jsonb,
  reasons jsonb,
  unique (block_id, rank)
);
create index idx_ideal_schedule_candidates_block on ideal_schedule_candidates (block_id, rank);

create table ideal_schedule_backtest_runs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  params jsonb not null, -- 구조 모드·전략·경쟁사·최적화 타깃 등
  config_snapshot jsonb not null,
  summary jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create table ideal_schedule_backtest_results (
  id uuid primary key default gen_random_uuid(),
  backtest_run_id uuid not null references ideal_schedule_backtest_runs(id) on delete cascade,
  week_start date not null,
  as_of_date date not null, -- 모델에 쓴 마지막 날짜(= week_start − 1)
  ideal_run_id uuid references ideal_schedule_runs(id) on delete set null,
  target_label text not null,
  actual_airing_count int not null,
  actual_avg_rating numeric, -- 실제 편성의 실측(편성 분 가중)
  expected_actual_schedule numeric, -- 같은 모델로 본 실제 편성의 기대값
  expected_ideal numeric, -- 이상적 편성의 기대값
  actual_avg_share numeric,
  expected_ideal_share numeric,
  actual_avg_time_spent numeric,
  expected_ideal_time_spent numeric,
  calibration_mae numeric, -- 방영별 |기대 − 실측| 평균(모델 정확도, 검증 가능한 지표)
  calibration_bias numeric, -- 방영별 (기대 − 실측) 평균
  calibration_n int,
  detail jsonb,
  created_at timestamptz not null default now(),
  unique (backtest_run_id, week_start)
);
comment on table ideal_schedule_backtest_results is 'Walk-forward 백테스트 주별 결과(2026-09-30). 이상적 편성의 "실측"은 관측할 수 없으므로 expected_ideal − actual_avg_rating은 참고치이고, 검증 가능한 지표는 calibration(실제 편성 기대값 vs 실측)이다.';

alter table ideal_schedule_runs enable row level security;
alter table ideal_schedule_blocks enable row level security;
alter table ideal_schedule_candidates enable row level security;
alter table ideal_schedule_backtest_runs enable row level security;
alter table ideal_schedule_backtest_results enable row level security;
