-- 개발 단위 3번: 관리자 로그인 + PD 공유 링크 접근 제어
-- 관리자 계정 테이블만 새로 추가한다 (share_links는 개발 단위 2번에서 이미 생성됨).

create table admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null, -- bcrypt 해시 (평문 비밀번호는 저장하지 않음)
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
comment on table admins is '관리자 계정 (최소 2명, 로그인 전용 — 회원가입 기능 없음, scripts/seed-admin.mjs로만 추가)';
