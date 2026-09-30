-- 사용자 지시(2026-09-30, 최종): OLIFE 에피소드 편성 — "월화수목금 주중, 토일 주말 이렇게 에피소드를 다르게, 같은
-- 에피소드를 편성할 수 있게 바꾸는 것으로 하자" (직전에 요청한 4일 휴지 규칙은 철회).
--  - episode_periods: 에피소드 구간 — 주중(월~금)과 주말(토·일)은 서로 다른 에피소드를 쓴다
--  - episode_repeat_within_period: 같은 구간 안에서는 같은 에피소드를 다른 날에도 다시 편성할 수 있다
--  - 같은 에피소드 24시간 내 최대 3회(episode_cycle_max·episode_cycle_hours)는 유지, 휴지 일수는 0(없음)
update ideal_schedule_config
set structure = structure || '{"episode_rest_days":0,"episode_periods":[[1,2,3,4,5],[6,7]],"episode_repeat_within_period":true}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where structure ? 'episode_rest_days';
