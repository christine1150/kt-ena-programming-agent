-- 시청률 자판기: ENA STORY 순환 편성 반영(2026-09-30, 사용자 선택 A안)
-- ENA STORY는 같은 회차를 하루 2~4회 돌리고(〈기막힌 이야기 실제상황〉·〈한블리〉 등) 〈인간극장〉은 3회 묶음을
-- 저녁에 새로 편성·다음 날 아침 재방하는 구조인데, 닐슨에 회차·본/재 표시가 없어 회차 시리즈 자동 판정이 안 됐다.
-- 채널 설정 행에 rotation_series를 켜서 "하루 여러 번 도는" 프로그램을 회차 시리즈처럼 취급한다.
-- 채널 행은 섹션 단위 병합이라 다른 섹션은 빈 객체로 두면 기본값을 그대로 쓴다.
insert into ideal_schedule_config (channel_id, weights, repeat_rules, expected_kpi, strategy, structure, targets, updated_by)
select id, '{}'::jsonb,
       '{"rotation_series": true, "rotation_min_days": 4, "rotation_min_ratio": 0.5}'::jsonb,
       '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'migration:ena-story-rotation'
from channels where code = 'ENA_STORY'
on conflict ((coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid)))
do update set repeat_rules = ideal_schedule_config.repeat_rules || excluded.repeat_rules,
              updated_by = excluded.updated_by, updated_at = now();
