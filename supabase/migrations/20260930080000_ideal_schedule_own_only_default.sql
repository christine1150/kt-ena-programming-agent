-- 사용자 지시(2026-09-30): "기본값은 선택한 채널 안의 편성 프로그램으로만 이상적 편성표를 도출하는거야.
-- 처음부터 경쟁사 컨텐츠를 섞으면 절대 안돼" — 경쟁 Benchmark 배치 방식에 NONE(자사 프로그램만: 경쟁 프로그램·
-- 장르 원형을 후보·대체 후보·요약 어디에도 넣지 않음)을 추가하고 기본값으로 둔다. SUGGEST_ONLY(대체 후보로만
-- 제안)·MIX(편성 분 일부 배치)는 사용자가 명시적으로 켰을 때만.
update ideal_schedule_config
set strategy = strategy || '{"benchmark_placement":"NONE"}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where channel_id is null;

-- 채널별 설정 행이 SUGGEST_ONLY를 복사해 갖고 있으면 같은 원칙으로 기본값 교정
update ideal_schedule_config
set strategy = strategy || '{"benchmark_placement":"NONE"}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where channel_id is not null and strategy->>'benchmark_placement' = 'SUGGEST_ONLY';

alter table ideal_schedule_runs drop constraint if exists ideal_schedule_runs_benchmark_placement_check;
alter table ideal_schedule_runs add constraint ideal_schedule_runs_benchmark_placement_check
  check (benchmark_placement in ('NONE','SUGGEST_ONLY','MIX'));
