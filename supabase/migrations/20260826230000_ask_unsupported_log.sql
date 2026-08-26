-- /api/ask 사각지대(미지원 질문) 로그 (2026-08-26 사용자 지시: "/api/ask Intent 확장
-- 프로젝트" — 규칙 기반·9-Intent 분류기·Function Calling 세 경로 전부 답을 못 찾은
-- 질문을 쌓아, 어떤 질문 유형을 다음에 Intent로 추가할지 데이터로 판단하기 위함.
create table ask_unsupported_log (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  reason text not null, -- 'no_intent_matched' | 'missing_required_parameter' | 'llm_fallback_failed'
  asker_role text,       -- 'admin' | 'pd' (getCurrentSession().role) — 없으면 null
  asker_name text,       -- 관리자는 이메일, PD는 이름(추후 개별 로그인 계정과 매칭용)
  created_at timestamptz not null default now()
);
comment on table ask_unsupported_log is '/api/ask가 끝까지 답을 못 찾은 질문 이력 — Intent 확장 우선순위 판단용(2026-08-26).';

create index ask_unsupported_log_created_at_idx on ask_unsupported_log (created_at desc);

-- 기존 로그 테이블들과 동일한 보안 모델: RLS 켜고 anon/authenticated 정책은 두지 않음
-- (서버 service_role만 접근, Supabase Auth 미사용).
alter table ask_unsupported_log enable row level security;
