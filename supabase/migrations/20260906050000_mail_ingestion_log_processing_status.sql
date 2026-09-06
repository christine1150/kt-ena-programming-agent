-- 자체 발견 버그 수정(2026-09-06, 동시성): runNielsenMailIngestion()이 "먼저 적재하고
-- 나중에 처리 기록을 남기는" 순서라, 두 실행이 겹치면(수동 테스트와 스케줄 트리거가
-- 겹치거나, 두 스케줄러가 비슷한 시각에 겹쳐 실행되는 경우) 같은 메일을 동시에 두 번
-- 적재할 수 있었다(실측: 2026-09-06에 겹친 두 호출이 서로 다른 날짜를 나눠 처리해
-- 이번엔 충돌하지 않았지만, 같은 메일을 두 번 집었다면 시청률이 중복 적재됐을 것).
--
-- 고침: message_id를 "먼저 선점(claim)"하는 행을 status='processing'으로 즉시 삽입해
-- 유니크 제약(message_id) 위반으로 "이미 다른 실행이 선점했음"을 감지한 뒤에만 실제
-- 적재를 진행하도록 mailIngestionRunner.ts를 재구성한다 — 이 마이그레이션은 그 중간
-- 상태값을 허용하도록 status 체크 제약만 넓힌다(기존 세 값은 그대로 유지).
alter table mail_ingestion_log drop constraint mail_ingestion_log_status_check;
alter table mail_ingestion_log add constraint mail_ingestion_log_status_check
  check (status = any (array['processing', 'processed', 'error', 'skipped']));
