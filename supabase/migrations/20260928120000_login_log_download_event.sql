-- 사용자 지시(2026-09-28): "다운을 받으면 관리자 모드에서 로그인 이력 내에서 누가
-- 다운로드를 받았는지도 로그를 남겨줘" — 추석 연휴 성과 분석 보고서(핵심판/상세판) 다운로드를
-- 기존 login_log(로그인·접속 이력)에 'download' 이벤트로 함께 남긴다.
-- event_type 체크 제약은 20260826220000에서 컬럼과 함께 만들어졌고 20260909020000에서 한 번
-- 재정의됐다 — 실제 제약 이름을 추측해 드롭하는 대신 event_type을 언급하는 체크 제약을
-- pg_constraint에서 찾아 지운 뒤 'download'를 포함해 다시 만든다.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'login_log'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%event_type%';
  if cname is not null then
    execute format('alter table login_log drop constraint %I', cname);
  end if;
end $$;

alter table login_log add constraint login_log_event_type_check
  check (event_type in ('login', 'access', 'download'));

alter table login_log add column if not exists detail text;
comment on column login_log.detail is '다운로드 이벤트(event_type=''download'')일 때 어떤 자료를 받았는지 — 예: "2026 추석 연휴 시청률 성과 분석(핵심판)"';
