-- 사용자 지시(2026-09-09): "30일간 재로그인하지 않아도 접속하면 기록을 남게 할 수는 있어?"
-- PD 세션은 30일간 유지되므로 그 기간 동안은 재로그인이 없어 login_log에 아무 기록도
-- 남지 않았다 — 관리자가 "이 계정이 오늘도 실제로 접속했는지"를 알 방법이 없었다.
--
-- 기존 login_log(로그인 성공 이력)를 그대로 재사용하되, 로그인 없이 기존 세션으로 들어온
-- 경우를 구분할 수 있도록 event_type을 추가한다('login'=실제 로그인 폼 통과, 'access'=세션
-- 쿠키만으로 접속 — src/app/page.tsx가 하루 1회로 제한해 남긴다). 기존 행은 전부 실제
-- 로그인이었으므로 'login'으로 기본값 채운다.
alter table login_log add column event_type text not null default 'login' check (event_type in ('login', 'access'));

comment on column login_log.event_type is '''login''=로그인 폼 통과, ''access''=기존 세션으로 접속(하루 1회로 제한해 기록).';
