-- 닐슨 수집 단계 01(2026-10-06): 수집 배치 원장 + 메일 재시도 횟수.
-- 원본 파일 해시·기간·파서 버전·개정(revision)·단계(수신→파싱→검증→반영)·재수신 차이를 남긴다.
-- 원장 기록은 최선 노력(best-effort)이라 이 마이그레이션이 적용되기 전에도 적재 자체는 기존대로 동작한다.
create table if not exists nielsen_ingest_batches (
  id uuid primary key default gen_random_uuid(),
  file_sha256 text not null,
  file_name text not null,
  kind text not null check (kind in ('daily','period_weekly','period_monthly','annual')),
  period_from date,
  period_to date,
  parser_version text not null,
  adapter_status text not null default 'verified' check (adapter_status in ('verified','provisional')),
  source text not null default 'manual' check (source in ('manual','mail')),
  source_ref text,                      -- 메일이면 mail_ingestion_log.message_id
  revision int not null default 1,      -- 같은 종류·기간의 반영 개정 번호
  supersedes_batch_id uuid references nielsen_ingest_batches(id),
  status text not null check (status in ('received','parsed','validated','applied','partial','failed','skipped_duplicate')),
  stage_log jsonb not null default '[]'::jsonb,   -- [{stage, at}]
  sheet_meta jsonb,                     -- 원본 시트명·타깃 헤더 + 정규화 결과 요약
  row_counts jsonb,
  diff jsonb,                           -- 같은 기간 이전 반영본과의 차이
  warnings jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_nielsen_ingest_batches_period on nielsen_ingest_batches (kind, period_from, period_to, received_at desc);
create index if not exists idx_nielsen_ingest_batches_sha on nielsen_ingest_batches (file_sha256);
comment on table nielsen_ingest_batches is '닐슨 파일 수집 배치 원장(해시·기간·파서 버전·개정·단계·차이). 행 단위 출처는 (종류, 기간)의 최신 applied 배치로 추적한다.';
alter table nielsen_ingest_batches enable row level security;

-- 메일 재시도: error 상태 메일을 일정 간격으로 다시 처리하되 상한에 닿으면 자동 재시도를 멈춘다(dead-letter = error + attempt_count 상한).
alter table mail_ingestion_log add column if not exists attempt_count int not null default 1;
comment on column mail_ingestion_log.attempt_count is '처리 시도 횟수. status=error이고 상한(코드 MAIL_MAX_ATTEMPTS) 이상이면 자동 재시도 중단(관리자 확인 대상).';
