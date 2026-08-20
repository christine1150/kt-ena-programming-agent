-- Page 1 Original 리포트 화이트리스트: 관리자가 `채널기본정보.xlsx`의 "요일 별 리뷰 프로그램"
-- 시트에 적어둔, 요일별로 꼭 봐야 하는 오리지널 프로그램 목록. 사용자 지시: "Original 분석은
-- 그 프로그램들만 하면 된다" — 그날 방영된 아무 프로그램이나 잡아내지 않고, 이 화이트리스트에
-- 있는 프로그램만 시청률 데이터와 매칭해 분석한다(매칭 안 되면 그 프로그램은 그냥 안 나옴 —
-- "매월 넷째 주만 방영" 같은 조건부 편성을 코드로 흉내 낼 필요가 없다).
create table original_review_programs (
  id uuid primary key default gen_random_uuid(),
  day_of_week_iso int not null check (day_of_week_iso between 1 and 7), -- 1=월요일 ... 7=일요일
  program_name text not null,
  broadcast_channel_id uuid not null references channels(id) on delete cascade,
  broadcast_time time, -- null이면 시간 텍스트를 못 읽은 것 (관리자가 원문 수정 필요)
  note text,
  rerun_channel_id uuid references channels(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_original_review_programs_day on original_review_programs (day_of_week_iso);
comment on table original_review_programs is 'Page 1 Original 리포트 화이트리스트 — 채널기본정보.xlsx "요일 별 리뷰 프로그램" 시트. 매 업로드마다 전체 교체(Channel Master와 동일한 정책).';
