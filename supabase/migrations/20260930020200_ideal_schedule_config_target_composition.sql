-- 이상적 1주일 편성 STEP 2 보강(2026-09-30): 가중치 20%인 "Target Audience" 항목의 정의 입력 추가.
-- target_fit = (프로그램의 num 타깃 시청률 ÷ den 타깃 시청률) ÷ (채널 전체의 같은 비율) — 프로그램 시청자
-- 구성이 채널 평균보다 핵심 타깃 쪽으로 얼마나 기울었는지(구성비 지수). 두 라벨 모두 타깃상세 시트에
-- 실제로 존재하는 표기(2026-09-30 DB 실측: ENA 17개·OLIFE 17개 타깃 라벨 확인).
-- Group B의 핵심 연령(num)은 채널 전략 확인 전까지의 초기값이며 이 설정 행에서만 바꾼다(코드 하드코딩 금지).
-- skyUHD는 타깃 세부가 없어 composition 없음 → 엔진이 해당 가중치를 빼고 나머지로 재정규화한다.
update ideal_schedule_config
set targets = '{"GROUP_A":{"kpi":"수도권 2049","extra":["수도권 2039","전국 유료가구"],"composition":{"num":"수도권 2049","den":"전국 유료가구"}},"GROUP_B":{"kpi":"전국 유료가구","extra":["전국 5064","수도권 2049"],"composition":{"num":"전국 5064","den":"전국 유료가구"}},"SKYUHD":{"kpi":null,"extra":[],"composition":null}}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where channel_id is null;

-- 장르 시드에서 규칙에 해당하지 않은 프로그램도 "관리자 보완 목록"으로 행을 남긴다 — 이때 출처를
-- 규칙으로 위장하지 않도록 source='NONE'(미분류, 근거 없음)을 허용한다.
alter table program_genre_map drop constraint if exists program_genre_map_source_check;
alter table program_genre_map add constraint program_genre_map_source_check
  check (source in ('FEATURED_CATEGORY','RULE_KEYWORD','RULE_CHANNEL','MANUAL','NONE'));
