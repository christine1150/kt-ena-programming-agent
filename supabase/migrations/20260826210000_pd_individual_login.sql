-- PD 개별 로그인 도입 (2026-08-26 사용자 지시).
-- 지금까지 PD는 개인 구분 없는 공유 링크(share_links)로만 접속했다. 이제 PD마다
-- 이름을 ID, 사번을 초기 비밀번호로 하는 개별 계정을 추가한다. 기존 공유 링크
-- 방식은 그대로 두고(Delta-Only), 개별 로그인을 병행 수단으로 추가하는 것이다.
--
-- admins 테이블과 같은 패턴을 그대로 따른다 — 평문 비밀번호는 저장하지 않고
-- bcrypt 해시만 저장하며, 회원가입 화면 없이 scripts/seed-pd-users.mjs로만
-- 계정을 추가/재설정한다.
create table pd_users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,        -- 로그인 ID로 쓰는 이름(예: 이진경)
  employee_no text not null unique, -- 사번 — 초기 비밀번호로만 쓰이고 평문 저장은 안 함
  password_hash text not null,      -- bcrypt 해시
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
comment on table pd_users is 'PD 개별 로그인 계정(이름=ID, 사번=초기 비밀번호). 회원가입 기능 없음 — scripts/seed-pd-users.mjs로만 추가/재설정.';

-- 20260826160000과 동일한 보안 모델을 그대로 적용한다: RLS를 켜고 anon/authenticated
-- 정책은 두지 않는다. 이 앱은 Supabase Auth를 쓰지 않아(로그인은 자체 세션 쿠키로
-- 처리 — src/lib/session.ts) auth.uid() 기반 정책이 애초에 의미가 없다. 서버(API
-- Route)는 항상 service_role 키로 접근해 RLS를 우회하므로, "서버만 접근, 공개 anon
-- 키로는 무엇도 못 건드림"이 이 테이블에도 그대로 적용된다.
alter table pd_users enable row level security;
