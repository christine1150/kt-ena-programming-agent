-- 관리자 운영 품질 단계 05(2026-10-06): 수동 잠금·변경 이력·뉴스 이전 버전.
-- 아래 테이블은 코드가 best-effort로 읽고 쓴다 — 이 마이그레이션이 적용되기 전에도 기존 업로드·저장은 그대로 동작하며,
-- 적용 전에는 수동 목표 보호와 뉴스 버전 복구가 작동하지 않는다(화면에 '미적용'으로 표시).

-- 1) 수동 잠금: 운영자가 직접 정한 값을 재업로드가 조용히 지우지 못하게 한다.
create table if not exists admin_field_locks (
  id uuid primary key default gen_random_uuid(),
  field text not null,                 -- 예: target_goal
  lock_key text not null,              -- 예: ENA:2026 (채널코드:연도)
  value jsonb not null,                -- 잠긴 값(예: {"target_rank":30,"target_rating":0.2})
  locked_by text not null,             -- 변경자(이메일)
  locked_at timestamptz not null default now(),
  effective_from date,                 -- 적용일
  reason text not null default '',     -- 근거
  released_at timestamptz,             -- 해제 시각(해제해도 행은 남긴다)
  released_by text
);
create unique index if not exists uq_admin_field_locks_active on admin_field_locks (field, lock_key) where released_at is null;
alter table admin_field_locks enable row level security;
comment on table admin_field_locks is '운영자 수동 잠금. released_at이 null인 행이 현재 유효한 잠금이다. 재업로드가 잠긴 값을 덮으려 하면 건너뛰고 결과에 알린다.';

-- 2) 변경 이력: 누가·언제·어떤 값을·무엇에서 무엇으로 바꿨는지.
create table if not exists admin_change_log (
  id uuid primary key default gen_random_uuid(),
  field text not null,
  lock_key text not null,
  action text not null,                -- manual_set / upload_write / upload_skipped_locked / release
  old_value jsonb,
  new_value jsonb,
  source text not null,                -- manual_admin / channel_master_file ...
  actor text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_change_log_key on admin_change_log (field, lock_key, created_at desc);
alter table admin_change_log enable row level security;

-- 3) 뉴스 이전 버전: 전체 교체 전에 현재 목록을 통째로 보관해 복구할 수 있게 한다.
create table if not exists daily_news_versions (
  id uuid primary key default gen_random_uuid(),
  items jsonb not null,                -- 교체 직전의 daily_news_items 전체
  item_count int not null,
  saved_by text not null,
  saved_at timestamptz not null default now(),
  reason text not null default 'replace'   -- replace / restore
);
create index if not exists idx_daily_news_versions_saved on daily_news_versions (saved_at desc);
alter table daily_news_versions enable row level security;
