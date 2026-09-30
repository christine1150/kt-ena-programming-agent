-- 사용자 지시(2026-09-30): 자사 채널에서 분류한 장르를 7개 자사 채널 공통으로 적용, 경쟁채널은 네이버 검색으로 분류.
-- OWN_COMMON: 다른 자사 채널의 관리자·주요 콘텐츠 분류를 이어받은 행(자기 근거가 아니므로 다수결 투표에서 제외).
-- NAVER_SEARCH: 네이버 검색 결과의 방송 장르 표기로 분류한 행(규칙 시드가 다시 돌아도 덮어쓰지 않음).
alter table program_genre_map drop constraint if exists program_genre_map_source_check;
alter table program_genre_map add constraint program_genre_map_source_check
  check (source in ('FEATURED_CATEGORY','RULE_KEYWORD','RULE_CHANNEL','MANUAL','OWN_COMMON','NAVER_SEARCH','NONE'));
