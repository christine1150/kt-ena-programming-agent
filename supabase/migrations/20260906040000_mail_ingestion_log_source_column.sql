-- 사용자 지시(2026-09-06): Gmail 전달 우회 대신 네이버 메일(IMAP)을 직접 읽는 경로를
-- 추가한다(naverMailClient.ts). 두 소스가 같은 mail_ingestion_log를 공유하므로, 관리자
-- 화면에서 "이 처리 이력이 Gmail에서 온 건지 네이버에서 온 건지" 구분할 수 있게 컬럼을
-- 하나 추가한다 — 이미 message_id에 naver:/gmail: 접두사를 붙이지만, 화면에 그 원문
-- ID를 그대로 노출하기보다 별도 컬럼으로 명확히 보여주는 편이 낫다.
alter table mail_ingestion_log
  add column if not exists source text not null default 'gmail';
