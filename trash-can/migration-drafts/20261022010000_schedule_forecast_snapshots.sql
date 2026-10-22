-- 편성표 기반 시청률 예측의 고정 기록(기능 2, 2026-10-22 작성) — ⚠️ 운영 적용 전 사용자 승인 필요(docs/ena-features-plan.md §7).
--
-- 목적: "그때 무엇을 예측했는가"를 나중에 모델·별칭·원천 자료가 바뀌어도 그대로 보존하고, 방송 후 실적과의 대조를 추가 전용으로 남긴다.
-- 설계 원칙
--  - 완료된 예측은 수정·삭제할 수 없다(트리거). 새 예측은 새 행. 실행 중(running)과 완료(completed)를 구분한다.
--  - 재시도·중복 요청: idempotency_key 유일 — 같은 편성표 버전·모델·파라미터·데이터 마감·목적이면 같은 행으로 수렴한다.
--  - 입력 해시만 저장하고 재현 가능하다고 하지 않는다: input_snapshot(편성표 칸·매칭·규칙 버전 원문)을 함께 저장한다.
--    편성표 원본(program_schedule_grid)은 재업로드로 바뀌므로 별도 버전 테이블을 두지 않고 스냅샷에 칸 전체를 넣는다(최소 스키마).
--  - 실적 정정은 과거 예측을 바꾸지 않는다: 리뷰는 매번 새 행이며, 당시 쓴 실적 행 id·값·적재 시각을 스냅샷으로 남긴다.
--  - 서비스 롤 외 접근 차단(RLS + 권한 회수). API가 세션을 확인한 뒤 서버에서만 읽고 쓴다.

create table if not exists schedule_forecast_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (char_length(idempotency_key) = 64),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  channel_code text not null check (char_length(channel_code) <= 40),
  target_label text not null check (char_length(target_label) <= 80),
  week_start date not null,
  -- 예측에 쓸 수 있던 자료의 마지막 방송일(데이터 마감) — 방송일까지 남은 기간은 칸별 date와 비교해 계산
  data_cutoff date not null,
  model_version text not null,
  model_params jsonb not null default '{}'::jsonb,
  code_version text not null,
  purpose text not null check (purpose in ('PLAN_FORECAST', 'PLAN_UPDATE', 'BACKTEST')),
  -- 편성 출처: 업로드 편성표 주 / AI 편성안 실행 / 작업본. 참조는 FK 없이(원본이 지워져도 기록은 남음)
  plan_source text not null check (plan_source in ('SCHEDULE_GRID', 'IDEAL_RUN', 'WORKING_COPY')),
  plan_ref text not null check (char_length(plan_ref) <= 120),
  -- AI 제안 예측과 PD 수정안 예측을 잇는다(같은 주의 앞선 예측)
  parent_forecast_id uuid references schedule_forecast_runs(id),
  input_snapshot jsonb not null,
  input_fingerprint text not null check (char_length(input_fingerprint) = 64),
  -- 일·주 집계(편성시간 가중 예상, 덮인 분·부분 예측 여부 포함)
  aggregates jsonb,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  actor_role text check (actor_role in ('admin', 'pd')),
  actor_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
comment on table schedule_forecast_runs is '편성표 예측 실행(고정 기록). completed 이후 수정·삭제 불가. 칸별 값은 schedule_forecast_values.';
create index if not exists schedule_forecast_runs_week_idx on schedule_forecast_runs (channel_code, week_start, created_at desc);

create table if not exists schedule_forecast_values (
  id uuid primary key default gen_random_uuid(),
  forecast_id uuid not null references schedule_forecast_runs(id),
  slot_key text not null check (char_length(slot_key) <= 200),
  broadcast_date date not null,
  start_min int not null check (start_min between 0 and 1800),
  end_min int check (end_min is null or end_min between 0 and 1800),
  end_approximated boolean not null default false,
  program_name text not null check (char_length(program_name) <= 300),
  program_id uuid,
  expected numeric,
  low numeric,
  high numeric,
  grade text check (grade is null or grade in ('A', 'B', 'C', 'ASSUMED')),
  evidence_airings int not null default 0,
  unique (forecast_id, slot_key)
);
comment on table schedule_forecast_values is '예측 칸별 값(고정). 부모 실행이 running일 때만 넣을 수 있고 이후 수정·삭제 불가.';

create table if not exists schedule_forecast_reviews (
  id uuid primary key default gen_random_uuid(),
  forecast_id uuid not null references schedule_forecast_runs(id),
  -- 대조에 쓴 실적: ratings 행 id·값·적재 시각(정정 추적), 공식 채널 하루 값
  actuals_snapshot jsonb not null,
  matches jsonb not null,
  metrics jsonb not null,
  note text check (note is null or char_length(note) <= 1000),
  -- 판단 기록과 연결(action_review_events.action_id, 선택)
  action_id text check (action_id is null or char_length(action_id) <= 120),
  actor_role text check (actor_role in ('admin', 'pd', 'system')),
  actor_id text,
  created_at timestamptz not null default now()
);
comment on table schedule_forecast_reviews is '예측 사후 대조(추가 전용). 실적이 정정되면 새 리뷰 행을 남기고 이전 행은 그대로 둔다.';
create index if not exists schedule_forecast_reviews_forecast_idx on schedule_forecast_reviews (forecast_id, created_at desc);

create table if not exists forecast_model_events (
  id uuid primary key default gen_random_uuid(),
  model_version text not null,
  event text not null check (event in ('CANDIDATE', 'VALIDATED', 'APPROVED', 'APPLIED', 'REVERTED', 'REJECTED')),
  evidence jsonb not null default '{}'::jsonb,
  actor_role text check (actor_role in ('admin', 'system')),
  actor_id text,
  created_at timestamptz not null default now()
);
comment on table forecast_model_events is '예측 모델 후보·검증·승인·적용·복귀 이력(추가 전용). 활성 모델은 자동으로 바뀌지 않는다.';

-- 불변 규칙 -------------------------------------------------------------
create or replace function schedule_forecast_runs_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'schedule_forecast_runs는 삭제할 수 없습니다.';
  end if;
  if old.status <> 'running' then
    raise exception '완료·실패한 예측 기록은 수정할 수 없습니다(새 예측을 만드세요).';
  end if;
  -- running → completed/failed 전환만 허용, 식별·입력 필드는 바꿀 수 없다
  if new.idempotency_key <> old.idempotency_key or new.input_fingerprint <> old.input_fingerprint or new.input_snapshot <> old.input_snapshot
     or new.model_version <> old.model_version or new.data_cutoff <> old.data_cutoff or new.week_start <> old.week_start then
    raise exception '예측 입력은 바꿀 수 없습니다.';
  end if;
  return new;
end;
$$;
drop trigger if exists schedule_forecast_runs_guard on schedule_forecast_runs;
create trigger schedule_forecast_runs_guard before update or delete on schedule_forecast_runs for each row execute function schedule_forecast_runs_guard();

create or replace function schedule_forecast_values_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'schedule_forecast_values는 수정·삭제할 수 없습니다.';
  end if;
  select status into v_status from public.schedule_forecast_runs where id = new.forecast_id;
  if v_status is distinct from 'running' then
    raise exception '실행 중인 예측에만 값을 넣을 수 있습니다.';
  end if;
  return new;
end;
$$;
drop trigger if exists schedule_forecast_values_guard on schedule_forecast_values;
create trigger schedule_forecast_values_guard before insert or update or delete on schedule_forecast_values for each row execute function schedule_forecast_values_guard();

create or replace function forecast_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '%는 추가 전용입니다(수정·삭제·비우기 불가).', tg_table_name;
end;
$$;
drop trigger if exists schedule_forecast_reviews_append_only on schedule_forecast_reviews;
create trigger schedule_forecast_reviews_append_only before update or delete on schedule_forecast_reviews for each row execute function forecast_append_only();
drop trigger if exists forecast_model_events_append_only on forecast_model_events;
create trigger forecast_model_events_append_only before update or delete on forecast_model_events for each row execute function forecast_append_only();
-- TRUNCATE는 행 트리거로 막히지 않아 문장 트리거를 따로 둔다
drop trigger if exists schedule_forecast_runs_no_truncate on schedule_forecast_runs;
create trigger schedule_forecast_runs_no_truncate before truncate on schedule_forecast_runs for each statement execute function forecast_append_only();
drop trigger if exists schedule_forecast_values_no_truncate on schedule_forecast_values;
create trigger schedule_forecast_values_no_truncate before truncate on schedule_forecast_values for each statement execute function forecast_append_only();
drop trigger if exists schedule_forecast_reviews_no_truncate on schedule_forecast_reviews;
create trigger schedule_forecast_reviews_no_truncate before truncate on schedule_forecast_reviews for each statement execute function forecast_append_only();
drop trigger if exists forecast_model_events_no_truncate on forecast_model_events;
create trigger forecast_model_events_no_truncate before truncate on forecast_model_events for each statement execute function forecast_append_only();

-- 접근: 서비스 롤만(과거 RLS 누락 사고가 있어 권한도 명시적으로 회수 — 이중 방어)
alter table schedule_forecast_runs enable row level security;
alter table schedule_forecast_values enable row level security;
alter table schedule_forecast_reviews enable row level security;
alter table forecast_model_events enable row level security;
revoke all on schedule_forecast_runs, schedule_forecast_values, schedule_forecast_reviews, forecast_model_events from anon, authenticated;
