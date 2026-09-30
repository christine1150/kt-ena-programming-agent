-- 이상적 1주일 편성 STEP 3(2026-09-30): 경쟁 Benchmark 배치 방식 설정 추가.
-- 실데이터 점검 결과 경쟁 프로그램의 "지수 전이 가정" 기대값을 자사 실측 기대값과 같은 조건으로 경쟁시키면
-- AI 배치 128개 중 118개가 경쟁 프로그램으로 채워져 자사 편성안으로 쓸 수 없었다. 가정값이 실측 기반 편성을
-- 밀어내지 않도록 기본은 제안 전용(SUGGEST_ONLY: 대체 후보·강세 슬롯 제안으로만 표시)으로 두고, 사용자가
-- "Benchmark Mix"를 켠 경우(MIX)에만 AI 편성 분의 benchmark_max_share 이내로 배치한다.
-- 0.2는 초기값(운영 중 조정 대상)이며 이 설정 행에서만 바꾼다.
update ideal_schedule_config
set strategy = strategy || '{"benchmark_placement":"SUGGEST_ONLY","benchmark_max_share":0.2}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where channel_id is null;
