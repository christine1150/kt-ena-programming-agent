-- 예측 시청률 시스템용(사용자 지시 2026-10-02): 경쟁채널 프로그램별 3개 타깃(개인2049/개인2039/유료방송가구) 전체.
--
-- 배경: competitor_program_ratings는 Nielsen 일별 파일 §1.2 경쟁채널 시트에서 시청률 3칸 중 첫 번째
-- 타깃만 저장한다(MBC·SBS·tvN·JTBC 등은 개인2049만, 가구·2039는 시트에 있는데 DB엔 없었음 — 채널 일 단위
-- competitor_ratings에는 가구·2039가 있음). 그 테이블은 50여 개 RPC가 "프로그램×시간당 1행"을 전제로
-- 쓰고 있어 행을 늘리면 집계가 어긋날 수 있으므로 기존 테이블은 그대로 두고(Delta-Only, 신규 추가만),
-- 3개 타깃을 모두 담는 별도 테이블을 만든다.
--
-- 경쟁채널의 성과는 우리 채널과 무관하므로 our_channel_id를 두지 않는다(같은 경쟁채널이 여러 자사 채널에
-- 등록돼도 1행). target_label은 시트 헤더 그대로("개인2049", "개인2039", "유료방송가구" 등) — 시트의
-- KBS1·MBC·SBS 유료방송가구는 수도권, 나머지는 전국 기준이다(시트 머리글).
create table competitor_program_target_ratings (
  id uuid primary key default gen_random_uuid(),
  broadcast_date date not null,
  competitor_name text not null,
  start_time time not null,
  end_time time,
  program_name text not null,
  norm_program_name text generated always as (
    regexp_replace(regexp_replace(program_name, '<본>|<재>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g')
  ) stored,
  target_label text not null,
  rating numeric,
  share numeric,
  created_at timestamptz not null default now(),
  unique (broadcast_date, competitor_name, start_time, program_name, target_label)
);
create index competitor_program_target_ratings_norm_idx on competitor_program_target_ratings (norm_program_name, broadcast_date);
create index competitor_program_target_ratings_channel_idx on competitor_program_target_ratings (competitor_name, broadcast_date);
alter table competitor_program_target_ratings enable row level security;
comment on table competitor_program_target_ratings is '경쟁채널 프로그램 단위 시청률의 3개 타깃 전체(2026-10-02). competitor_program_ratings(첫 타깃만)와 별개 — 예측 시청률 시스템이 가구·2039까지 쓰기 위한 테이블.';
