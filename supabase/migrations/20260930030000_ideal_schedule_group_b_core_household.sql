-- 사용자 정정(2026-09-30): "그룹 B는 전국 가구야 핵심 연령이" — Group B(OLIFE·ONCE·ENA Story)의 핵심 타깃은
-- 별도 연령대가 아니라 KPI인 전국 유료가구 그 자체다. 20260930020200에서 초기값으로 넣은 "전국 5064"
-- 구성비 정의를 제거한다. 구성비(num÷den)가 가구÷가구로 항상 1이 되어 의미가 없으므로 composition=null →
-- 엔진은 Target Audience 항목을 빼고 나머지 가중치로 재정규화한다(skyUHD와 같은 처리).
update ideal_schedule_config
set targets = jsonb_set(
      targets,
      '{GROUP_B}',
      '{"kpi":"전국 유료가구","extra":[],"composition":null}'::jsonb
    ),
    updated_by = 'migration',
    updated_at = now()
where channel_id is null;
