-- 사용자 지시(2026-08-25): 채널기본정보.xlsx "요일 별 리뷰 프로그램" 시트를 새 폼으로 다시
-- 작성했다 — 기존(요일|프로그램명|본방채널|본방시간|비고|직재방채널, 요일별로 묶인 표) 대신
-- "분류|타이틀|본방 채널|동시방송|직후 재방|첫 방송일자|매주 반복 편성|예상 회차|종영일" 평평한
-- 표. 기존 컬럼(day_of_week_iso/program_name/broadcast_channel_id/broadcast_time/note/
-- rerun_channel_id/sort_order)은 새 폼에서도 "매주 반복 편성" 텍스트를 파싱해 그대로 채울 수
-- 있어 유지하고, 새 폼에만 있는 정보(분류/동시방송/첫방송일자/예상회차/종영일)만 컬럼을
-- 추가한다 — 기존 로직(get_original_content_daily 등)은 day_of_week_iso 등 기존 컬럼만
-- 참조하므로 전혀 안 건드려도 된다(Delta-Only).
alter table original_review_programs
  add column if not exists category text,
  add column if not exists simulcast_channel_id uuid references channels(id) on delete set null,
  add column if not exists first_broadcast_date date,
  -- 예상 회차: 대부분 숫자(8/12 등)지만 "계속"/"정기" 같은 자유 텍스트도 실제로 있어 text로 저장.
  add column if not exists expected_episode_count text,
  add column if not exists series_end_date date;
comment on column original_review_programs.category is '분류(오리지널 드라마/오리지널 예능/독점 예능/사업형 등) — 새 시트 폼(2026-08-25)에서 추가.';
comment on column original_review_programs.simulcast_channel_id is '동시방송 채널(본방과 같은 시각에 함께 방영) — rerun_channel_id(직후 재방, 본방 종료 후)와는 다른 개념.';
comment on column original_review_programs.first_broadcast_date is '첫 방송일자 — program_episode_counters 자동 seed(1회=이 날짜)에 사용, 기존에 수동으로 확인해 seed된 프로그램은 덮어쓰지 않음.';
comment on column original_review_programs.series_end_date is '종영일(예정) — 참고용, 자동 판단(예: 종영 후 자동 제외)에는 아직 쓰지 않음.';
