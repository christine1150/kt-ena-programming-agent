-- 사용자 지시(2026-09-30): OLIFE 에피소드 편성에서 "7일 휴지 규칙은 없애도 돼" — 같은 에피소드 규칙은 사용자가 정한
-- "24시간 내 최대 3회"(episode_cycle_max·episode_cycle_hours)만 남기고, 제가 임의로 두었던 휴지 일수를 0으로 끈다.
update ideal_schedule_config
set structure = structure || '{"episode_rest_days":0}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where structure ? 'episode_rest_days';
