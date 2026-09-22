-- 20260922080000의 임시 디버그 함수 정리 — get_channel_daily_narrative의 0.05 노이즈 필터가
-- skyUHD를 영구히 걸러내는 문제를 조사하는 데만 썼고, 조사가 끝나 더는 필요 없다.
drop function if exists debug_narrative_program_candidates(text, text, date, int, int);
