-- 사용자 지시(2026-09-30): "OLIFE 같은 에피소드는 24시간 내 최대 세 번" — 20260930090000에서 임의로 둔
-- "같은 에피소드 주 1회(episode_weekly_cap)"를 없애고, 같은 에피소드의 편성은 최대 episode_cycle_max회이며
-- 그 편성들이 episode_cycle_hours시간 안에 모여 있어야 한다는 규칙으로 바꾼다(본방 후 24시간 안 재방 포함).
-- episode_rest_days(기준일 전 최근 방영 에피소드의 휴지 일수)는 사용자 규칙과 별개의 가정이라 설정값으로 유지.
update ideal_schedule_config
set structure = (structure - 'episode_weekly_cap') || '{"episode_cycle_max":3,"episode_cycle_hours":24}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where channel_id is null;

update ideal_schedule_config
set structure = (structure - 'episode_weekly_cap') || '{"episode_cycle_max":3,"episode_cycle_hours":24}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where channel_id is not null and structure ? 'episode_weekly_cap';
