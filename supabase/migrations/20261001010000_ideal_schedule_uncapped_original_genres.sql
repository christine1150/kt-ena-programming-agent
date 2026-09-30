-- 시청률 자판기: 오리지널 드라마·오리지널 예능은 반복 한도 없음(사용자 규칙 2026-10-01)
-- "오리지널 드라마와 오리지널 예능은 방영 횟수에 제한이 없어. 잘 나오면 많이 틀어도 돼."
-- 하루·주 반복 한도를 적용하지 않고, 몇 번 틀지는 기대값으로만 정한다.
update ideal_schedule_config
   set repeat_rules = repeat_rules || '{"uncapped_genres": ["오리지널 드라마", "오리지널 예능"]}'::jsonb,
       updated_by = 'migration:uncapped-original-genres', updated_at = now()
 where channel_id is null;
