-- 보안 수정(2026-08-26, Supabase Security Advisor 경고 대응):
--   1) rls_disabled_in_public — public 스키마 테이블에 RLS가 꺼져 있어 API로 누구나 읽고
--      쓰고 지울 수 있음.
--   2) sensitive_columns_exposed — 민감 정보가 담긴 테이블이 제한 없이 노출됨(특히 admins:
--      관리자 로그인 이메일·비밀번호 해시).
--
-- 실측 확인(tmp_list_table_rls_status()): public 스키마 테이블 25개 전부 RLS 비활성, 정책
-- 0개 — 이 앱이 서버에서도 anon 키로 Supabase를 호출해왔는데(src/lib/supabase.ts), anon
-- 키는 브라우저 번들에 그대로 노출되는 공개 키라 RLS 없이는 Next.js 세션 검사를 완전히
-- 우회해 REST API로 직접 모든 테이블을 조작할 수 있었다.
--
-- 함께 적용한 수정: src/lib/supabase.ts를 service_role 키로 전환(이 파일은 서버 전용 코드
-- —API Route Handler/서버 lib—에서만 import됨을 코드 전수 확인, 클라이언트 컴포넌트에서
-- import하는 곳 없음). service_role은 RLS를 무시하고 항상 전체 접근하므로 앱은 지금처럼
-- 그대로 동작한다. 이 마이그레이션은 모든 테이블에 RLS를 켜고 anon/authenticated용
-- 정책은 하나도 두지 않는다 — 그러면 공개 anon 키만으로는 이제 아무 것도 못 건드리고,
-- 서버(service_role)만 계속 접근 가능해진다. Supabase Auth를 안 쓰는 앱이라(관리자 인증은
-- 자체 세션 쿠키, PD는 공유 링크) auth.uid() 기반 정책은 의미가 없어 만들지 않았다 —
-- "서버만 접근, 클라이언트 직접 접근 전면 차단"이 이 앱의 실제 접근 제어 모델과 일치한다.
alter table admins enable row level security;
alter table channels enable row level security;
alter table competitor_program_ratings enable row level security;
alter table competitor_ratings enable row level security;
alter table competitors enable row level security;
alter table daily_news_items enable row level security;
alter table featured_content enable row level security;
alter table file_uploads enable row level security;
alter table fit_score_config enable row level security;
alter table mail_ingestion_log enable row level security;
alter table market_ytd_rank_snapshot enable row level security;
alter table mart_competitive_score enable row level security;
alter table mart_flow_score enable row level security;
alter table mart_program_target_score enable row level security;
alter table mart_scheduling_fit_score enable row level security;
alter table mart_slot_score enable row level security;
alter table olife_epg_staging enable row level security;
alter table olife_episode_catalog enable row level security;
alter table original_review_programs enable row level security;
alter table program_episode_counters enable row level security;
alter table program_manual_reports enable row level security;
alter table programs enable row level security;
alter table ratings enable row level security;
alter table share_links enable row level security;
alter table target_goals enable row level security;
alter table targets enable row level security;

-- 진단용 임시 함수 정리(20260826150000).
drop function if exists tmp_list_table_rls_status();
