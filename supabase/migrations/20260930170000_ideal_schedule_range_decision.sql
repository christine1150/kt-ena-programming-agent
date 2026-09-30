-- 시청률 자판기 2단계(2026-09-30): 블록별 예상 범위·유지/교체 판단 저장 + 판단 기준 설정값.
-- 모두 추가(nullable) 컬럼이라 기존 실행·화면에 영향 없음.
--
-- 예상 범위(expected_low ~ expected_high): 기대값 × 과거 오차 배율(실측 ÷ 기대)의 하위·상위 분위.
--   range_basis = BACKTEST(이 채널 과거 주 검증 잔차) / TRAINING(검증 전 — 학습 기간 방영별 변동).
-- decision: 지난주 실제 편성 대비 판단(KEEP=차이가 작아 유지, CHANGE=뚜렷한 개선으로 교체, SAME=원래 같은 프로그램,
--   NEW=지난주 편성 없던 자리) + 차순위 후보와의 차이(확실도).

alter table ideal_schedule_blocks
  add column if not exists expected_low numeric,
  add column if not exists expected_high numeric,
  add column if not exists range_basis text,
  add column if not exists decision jsonb;

alter table ideal_schedule_candidates
  add column if not exists expected_low numeric,
  add column if not exists expected_high numeric,
  add column if not exists range_basis text;

-- 판단 기준(기본행). 코드에 하드코딩하지 않고 설정에서 관리 — 백테스트로 보정 예정.
--   decision_keep_current: 지난주 편성보다 기대값이 뚜렷하게 높지 않으면 유지
--   decision_min_rel_gain: 최소 개선율(지난주 편성 기대값 대비)
--   decision_z: 표준오차 배수(두 후보 기대값 차이가 z × 합성 표준오차 이하면 "차이 작음")
update ideal_schedule_config
set structure = structure || '{"decision_keep_current":true,"decision_min_rel_gain":0.03,"decision_z":1.0}'::jsonb,
    expected_kpi = expected_kpi || '{"range_low_q":0.1,"range_high_q":0.9,"range_min_rows":30}'::jsonb,
    updated_at = now()
where channel_id is null;
