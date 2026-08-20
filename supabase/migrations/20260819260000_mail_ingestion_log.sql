-- 개발 단위 20번(Nielsen 메일 자동 수집): Gmail에서 이미 처리한 메일을 기억해둬서
-- 같은 메일을 중복으로 다시 파싱·적재하지 않도록 하는 처리 이력 테이블.
create table mail_ingestion_log (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique, -- Gmail 메시지 ID
  subject text,
  received_at timestamptz,
  processed_at timestamptz not null default now(),
  status text not null check (status in ('processed', 'error', 'skipped')),
  file_names text[],
  error_message text
);
create index idx_mail_ingestion_log_received on mail_ingestion_log (received_at desc);
comment on table mail_ingestion_log is '개발 단위 20번: Gmail API로 가져온 Nielsen 일일 보고서 메일 중 이미 처리한 메시지 ID를 기록 — 중복 처리 방지 + 관리자 화면에 처리 이력 표시용.';
