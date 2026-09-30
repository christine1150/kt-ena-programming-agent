-- 사용자 지시(2026-09-30): 장르에 "사업형"(브랜디드 프로그램) 추가. 주요 콘텐츠 관리 분류 "사업형"과 같은 이름.
alter table program_genre_map drop constraint if exists program_genre_map_genre_check;
alter table program_genre_map add constraint program_genre_map_genre_check
  check (genre in ('드라마','오리지널 드라마','예능','오리지널 예능','영화','다큐·교양','여행','뉴스·시사','스포츠','음악','애니·키즈','사업형','홈쇼핑·기타','미분류'));
