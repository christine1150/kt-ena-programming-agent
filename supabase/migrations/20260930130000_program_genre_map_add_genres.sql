-- 사용자 지시(2026-09-30): 장르 분류 보완에 "오리지널 드라마", "오리지널 예능", "여행"을 추가("여행은 교양 중 여행
-- 장르"). 세부 장르이며 상위 장르 묶음은 코드(types.ts GENRE_FAMILY)에서 오리지널 드라마→드라마, 오리지널 예능→예능,
-- 여행→다큐·교양으로 둔다(경쟁 대응 MATCH/COUNTER·장르 편중은 상위 묶음 기준).
alter table program_genre_map drop constraint if exists program_genre_map_genre_check;
alter table program_genre_map add constraint program_genre_map_genre_check
  check (genre in ('드라마','오리지널 드라마','예능','오리지널 예능','영화','다큐·교양','여행','뉴스·시사','스포츠','음악','애니·키즈','홈쇼핑·기타','미분류'));
