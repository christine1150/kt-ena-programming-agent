-- 시청률 자판기: 편성표 회차 반영(B안) 옵션 기록(2026-10-01)
-- 업로드된 주간 편성표 회차로 과거 방영 회차를 채우고 차주 편성안에 회차 흐름을 이었는지 — 다시 계산할 때 같은 조건을 쓰기 위해 저장
alter table ideal_schedule_runs add column if not exists plan_episodes boolean not null default false;
comment on column ideal_schedule_runs.plan_episodes is '편성표 회차 반영(B안) 사용 여부 — program_schedule_grid 회차로 과거 방영 회차 채움·차주 회차 흐름 표시';
