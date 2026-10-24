-- 감시 크론 실행 기록(2026-10-24, 사용자 지시)
--
-- 사용자 질문: "오늘 시청률 메일 왜 자동 확인 안됐어?" — 10/24 07:55 도착 메일이 09:26 수동 확인까지 미반영이었으나,
-- Vercel 실행 로그(보존 짧음)와 콘솔 출력만으로는 크론이 안 떴는지·이어 붙이기가 끊겼는지·메일함 접속이 실패했는지 가릴 수 없었다.
-- 감시 크론(watch-nielsen-mail)이 호출마다 시작 시각과 결과를 남겨 다음에는 원인을 DB에서 바로 본다.
-- 새 테이블만 추가한다(기존 테이블·함수 변경 없음). 서비스 롤로만 읽고 쓴다(RLS 켜고 정책 없음).

create table if not exists cron_run_log (
  id bigint generated always as identity primary key,
  job text not null,                    -- 크론 이름(예: watch-nielsen-mail)
  hop integer not null default 0,       -- 이어 붙이기 순번(0=Vercel 크론이 직접 호출)
  started_at timestamptz not null default now(),
  finished_at timestamptz,              -- 비어 있으면 끝나기 전에 중단된 호출(시간 초과 등)
  done boolean,                         -- 끝날 때 오늘 보고서가 반영된 상태였는가
  checks integer,                       -- 이 호출에서 메일함을 확인한 횟수
  processed_count integer,              -- 이 호출에서 새로 반영한 메일 수
  chained boolean,                      -- 다음 호출을 이어 붙였는가
  chain_status integer,                 -- 이어 붙인 호출이 8초 안에 돌려준 HTTP 상태(응답 없음=정상이면 비어 있음)
  message text,                         -- 마지막 메일 확인 결과 메시지
  error text                            -- 예외·실패 사유
);

create index if not exists cron_run_log_job_started_idx on cron_run_log (job, started_at desc);

alter table cron_run_log enable row level security;

comment on table cron_run_log is '크론 실행 기록(2026-10-24). 감시 크론이 호출마다 시작·종료·이어 붙이기 결과를 남겨, 메일 미반영 때 원인(미발사·이어 붙이기 끊김·접속 실패)을 가린다.';
