-- 시청률 자판기: 오리지널 본방 연계 재방 규칙(2026-10-01 사용자 확인)
-- 직전회차 재방(본방 바로 앞, 오리지널 드라마만 — 예능은 성과가 좋을 때만이라 강제하지 않음),
-- 직재방(본방 당일 밤, 오리지널 드라마·예능), 자매 채널 직재방(ENA DRAMA ← ENA). ENA Play는 반드시 지키는 규칙이 아니라 제외.
update ideal_schedule_config
   set structure = structure || '{"rerun_rules": {"prev_episode_genres": ["오리지널 드라마"], "same_night_genres": ["오리지널 드라마", "오리지널 예능"], "sister_sources": {"ENA_DRAMA": ["ENA"]}}}'::jsonb,
       updated_by = 'migration:rerun-rules', updated_at = now()
 where channel_id is null;
