-- 회고 리뷰(2026-08-20)에서 실제로 재현·확인한 근본 원인: 앱은 서버에서도 anon 키로
-- Supabase를 호출한다(src/lib/supabase.ts, 접근 제어는 Next.js 세션 쿠키로 앱 레이어에서
-- 함) — PostgREST가 이 요청을 anon 역할로 처리하는데, anon 역할의 statement_timeout이
-- 3초로 설정돼 있었다(authenticated는 8초). refresh_fit_score_mart()처럼 채널 6개를 도는
-- 무거운 콜드 계산은 직접 연결 테스트로도 편도 4~5초가 걸려 이 3초 제한에 쉽게 걸린다
-- ("canceling statement due to statement timeout" 500 에러를 브라우저로 직접 재현·확인).
-- 함수 안에서 set_config로 statement_timeout을 늘리는 시도(20260820030000)는 효과가 없었다
-- — Postgres는 최상위 SQL 문(PostgREST가 보낸 "select refresh_fit_score_mart(...)" 자체)의
-- 타임아웃 타이머를 그 문이 시작되기 전 세션 기본값으로 이미 걸어두기 때문에, 함수 내부에서
-- 값을 바꿔도 이미 걸린 타이머에는 반영되지 않는다(재현 테스트로 확인: 함수 내부 set_config는
-- 남겨두되, 근본 수정은 역할 자체의 기본값을 올리는 것). 이 앱은 공개 미인증 트래픽이 anon
-- 키로 직접 DB를 두드리는 구조가 아니라(모든 화면이 Next.js 세션/공유링크로 먼저 걸러짐),
-- 역할 단위로 넉넉히 올려도 안전하다고 판단해 20초로 늘린다.
alter role anon set statement_timeout = '20s';
alter role authenticated set statement_timeout = '20s';
