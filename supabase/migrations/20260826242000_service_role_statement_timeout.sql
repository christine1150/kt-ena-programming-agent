-- 성능 수정 후속(2026-08-26) — 생성 컬럼+인덱스로 바꾼 뒤에도 get_program_cross_channel_reach가
-- service_role로 실행 시 8초 부근에서 계속 57014(statement timeout)로 실패했다. 20260820040000이
-- anon/authenticated 역할의 statement_timeout을 3초/8초 기본값에서 20초로 이미 올려둔 것과 같은
-- 문제 — service_role만 그때 빠졌던 것으로 보인다(이 앱 서버 코드는 항상 service_role로 Supabase에
-- 접근함, src/lib/supabase.ts). 같은 판단(공개 미인증 트래픽이 이 role을 직접 두드리는 구조가
-- 아니라 서버 코드에서만 씀 — 안전하게 넉넉히 올려도 됨)을 그대로 적용한다.
alter role service_role set statement_timeout = '20s';
