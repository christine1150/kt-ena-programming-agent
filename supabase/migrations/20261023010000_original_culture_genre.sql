-- 사용자 지시(2026-10-23): 장르 "오리지널 교양"을 "오리지널 예능"에서 분리해 추가한다(첫 작품 <결이 다른 전쟁사>).
-- 상위 묶음은 다큐·교양(types.ts GENRE_FAMILY). 오리지널 드라마·예능과 같이 반복 한도를 적용하지 않는다.
alter table program_genre_map drop constraint if exists program_genre_map_genre_check;
alter table program_genre_map add constraint program_genre_map_genre_check
  check (genre in ('드라마','오리지널 드라마','영미 드라마','중국 드라마','예능','오리지널 예능','오리지널 교양','영화','다큐·교양','여행','뉴스·시사','스포츠','음악','애니·키즈','사업형','홈쇼핑·기타','미분류'));

update ideal_schedule_config
   set repeat_rules = repeat_rules || '{"uncapped_genres": ["오리지널 드라마", "오리지널 예능", "오리지널 교양"]}'::jsonb,
       updated_by = 'migration:original-culture-genre', updated_at = now()
 where channel_id is null;
