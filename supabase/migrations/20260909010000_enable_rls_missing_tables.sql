-- 보안 수정(2026-09-09, Supabase Security Advisor 경고 대응: "Table publicly accessible" /
-- rls_disabled_in_public) — 2026-08-26에 이미 한 차례 전 테이블 RLS를 켰었지만(마이그레이션
-- 20260826160000), 그 이후 새로 만든 테이블 5개가 각자의 생성 마이그레이션에서
-- `enable row level security` 구문을 빠뜨려 다시 공개 상태로 남아 있었다(Management API로 직접
-- 확인: channel_affinity_snapshot / nielsen_period_rank / channel_monthly_genre_trend /
-- channel_monthly_program_trend / channel_monthly_narrative 5개, 나머지 테이블은 전부 정상).
--
-- 20260826160000·20260902150000(channel_monthly_content_review)와 완전히 동일한 접근 제어
-- 모델을 그대로 적용한다: 서버(service_role 키, src/lib/supabase.ts)만 접근하고 anon/
-- authenticated용 정책은 두지 않는다 — 이 앱의 관리자 인증은 Supabase Auth가 아니라 자체
-- 세션 쿠키라 auth.uid() 기반 정책이 의미가 없고, service_role은 RLS를 무시하므로 서버
-- 쪽 동작에는 영향이 없다(anon 키로 REST API를 직접 두드리는 경로만 차단된다).
alter table channel_affinity_snapshot enable row level security;
alter table nielsen_period_rank enable row level security;
alter table channel_monthly_genre_trend enable row level security;
alter table channel_monthly_program_trend enable row level security;
alter table channel_monthly_narrative enable row level security;
