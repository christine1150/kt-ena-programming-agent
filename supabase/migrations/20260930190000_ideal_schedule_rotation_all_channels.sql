-- 시청률 자판기: 순환 편성 판정을 전 채널 기본값으로(2026-09-30)
-- 사용자가 준 7개 채널 주간편성표 확인 결과, 모든 채널이 같은 프로그램을 기본 한도(하루 3회·주 14회)보다 많이 돌린다
-- (ENA 〈신병4〉 주 37회·하루 8회, skyUHD 〈우영우〉 주 36회, ONCE 〈왕가네 식구들〉 주 25회 등).
-- 그래서 ENA STORY에만 켰던 rotation_series를 기본행에 켠다 — 한도는 무제한이 아니라 12주 관측 최대치까지.
update ideal_schedule_config
   set repeat_rules = repeat_rules || '{"rotation_series": true, "rotation_min_days": 4, "rotation_min_ratio": 0.5}'::jsonb,
       updated_by = 'migration:rotation-all-channels', updated_at = now()
 where channel_id is null;
