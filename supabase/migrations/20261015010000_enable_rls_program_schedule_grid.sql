-- 보안 수정(2026-10-07, Supabase 보안 경고 rls_disabled_in_public 대응): program_schedule_grid 에 RLS 가 꺼져 있어 공개 anon 키로
-- 누구나 읽고 쓰고 지울 수 있었다. 이 앱은 서버(service_role)에서만 DB 에 접근하므로(20260826160000 과 같은 모델)
-- RLS 를 켜고 anon/authenticated 정책은 두지 않는다. 몇 번을 실행해도 같은 결과(멱등).
alter table program_schedule_grid enable row level security;
