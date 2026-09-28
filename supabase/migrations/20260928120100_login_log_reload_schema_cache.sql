-- PostgREST(Supabase REST API) 스키마 캐시가 직전 마이그레이션(login_log.detail 컬럼 추가)을
-- 바로 인식하지 못해, 배포 직후 다운로드 로그 저장이 "column detail does not exist"로 계속
-- 실패했다(로컬 검토 중 실측). Supabase 문서가 안내하는 표준 해결책 — PostgREST에 스키마
-- 캐시를 다시 읽으라고 신호를 보낸다.
notify pgrst, 'reload schema';
