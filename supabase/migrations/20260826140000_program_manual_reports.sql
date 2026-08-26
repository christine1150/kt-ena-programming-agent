-- 사용자 지시(2026-08-26): "오늘 1페이지 <주요 컨텐츠 리뷰>는 내가 작성한 보고서 내용으로
-- 덮어써서 반영하자 — 이 분석이 우선되게 작성 후 Open AI를 통해 인사이트도 함께 적어줘."
-- PD가 직접 작성한 회차별 상세 리뷰 엑셀(예: "26년 오리지널드라마시청률분석-신병4사보타주
-- 2회.xlsx")을 업로드하면, 그 안의 헤드라인 문구·분당 시청률·경쟁 프로그램 순위(PD가 직접
-- 1분 단위로 뽑아 SQL의 프로그램 단위 매칭보다 더 정확하게 파악한 값)를 그대로 저장해뒀다가,
-- Page 1의 해당 프로그램·날짜 카드가 이 값이 있으면 자동 계산 대신 우선 사용한다(없으면
-- 기존처럼 자동 계산 그대로 — Delta-Only, 기존 동작 보존).
create table program_manual_reports (
  id uuid primary key default gen_random_uuid(),
  -- programs.canonical_name과 같은 정규화 기준(공백·문장부호 제거)으로 매칭 — 채널별로
  -- canonical_name이 갈릴 수 있어 channel_id로 특정 채널까지 고정한다.
  channel_id uuid not null references channels(id),
  canonical_name_normalized text not null,
  broadcast_date date not null,
  episode_number int,
  -- PD가 직접 쓴 헤드라인 문구(요약/타깃시청률/플랫폼시청률/경쟁상황 등) — 원문 그대로 저장,
  -- 절대 재작성하지 않는다(사용자 원문이 최우선).
  headline_bullets jsonb not null default '[]'::jsonb,
  -- 분당 시청률 — [{time:"22:00", rating:0.121}, ...] (이 프로그램 자기 채널의 실측값만).
  minute_ratings jsonb,
  -- PD가 별도로(분단위 등) 직접 집계해 SQL 프로그램 단위 매칭보다 더 정확한 동시간대 경쟁
  -- 순위 — [{rank, channel_name, target_rating, household_rating}, ...].
  competitor_rank_snapshot jsonb,
  -- 동시간대 경쟁 프로그램 원본 목록(참고용 표시) — [{program_name, channel_code, start_time,
  -- end_time, target_rating, share, household_rating}, ...].
  competitor_programs jsonb,
  source_file_name text,
  created_at timestamptz not null default now(),
  unique (channel_id, canonical_name_normalized, broadcast_date)
);
comment on table program_manual_reports is 'PD가 직접 작성한 회차별 상세 리뷰(엑셀 업로드) — Page 1 주요 컨텐츠 리뷰가 자동 계산 대신 이 값을 우선 사용한다(2026-08-26). 없으면 기존 자동 계산 그대로 동작.';

create index program_manual_reports_lookup_idx on program_manual_reports (channel_id, canonical_name_normalized, broadcast_date);
