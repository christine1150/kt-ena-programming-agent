-- 이상적 1주일 편성 STEP 4(2026-09-30): 화면의 [저장] 버튼 — 실행은 생성 즉시 기록되지만(재현·백테스트용),
-- 사용자가 "편성안으로 남기겠다"고 고른 실행만 목록에서 구분할 수 있게 이름·저장 시각을 둔다.
alter table ideal_schedule_runs
  add column if not exists title text,
  add column if not exists saved_at timestamptz,
  add column if not exists saved_by text;
create index if not exists idx_ideal_schedule_runs_saved on ideal_schedule_runs (channel_id, saved_at desc) where saved_at is not null;
