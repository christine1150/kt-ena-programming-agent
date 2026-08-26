-- 로그인 이력 테이블 (2026-08-26 사용자 지시: "관리자는 로그인 이력을 볼 수 있는 별도
-- 관리 및 확인 페이지를 만들어줘"). 관리자(admins)·PD(pd_users) 로그인이 성공할 때마다
-- 한 행씩 쌓인다 — 실패한 로그인 시도는 남기지 않는다(누가 언제 실제로 접속했는지가
-- 목적이지, 침입 탐지가 목적이 아니라서).
create table login_log (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin', 'pd')),
  actor_id uuid not null,     -- admins.id 또는 pd_users.id (외래키를 걸지 않음: 계정이
                               -- 삭제돼도 "누가 로그인했었는지" 이력은 남아 있어야 하므로)
  actor_name text not null,   -- 표시용 — 관리자는 이메일, PD는 이름
  ip text,
  user_agent text,
  logged_in_at timestamptz not null default now()
);
comment on table login_log is '관리자·PD 로그인 성공 이력. 계정 삭제와 무관하게 이력을 남기기 위해 actor_id에 외래키를 걸지 않는다.';

create index login_log_logged_in_at_idx on login_log (logged_in_at desc);

-- 20260826160000/20260826210000과 동일한 보안 모델: RLS를 켜고 anon/authenticated
-- 정책은 두지 않는다(서버 service_role만 접근, Supabase Auth 미사용).
alter table login_log enable row level security;
