-- KT ENA 편성 AI Agent — 최소 스키마 (개발 단위 2번)
-- SCHEMA.md 설계를 그대로 반영. 필요할 때마다 새 마이그레이션으로 확장한다.

create extension if not exists "pgcrypto";

-- 1. 채널 마스터
create table channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- 'ENA','ENA_DRAMA','ENA_PLAY','ENA_STORY','OLIFE','ONCE','SKYUHD'
  name text not null,
  market text, -- '수도권' | '전국'
  primary_target text, -- KPI 타깃 (예: '수도권 개인2049')
  is_full_analysis boolean not null default true, -- skyUHD는 false
  logo_path text,
  theme_color text,
  prime_time_start time,
  prime_time_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table channels is '채널 마스터 (7개 채널 + 시장구분·목표·프라임타임·로고)';

-- 2. 경쟁채널 마스터
create table competitors (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  competitor_name text not null,
  is_internal_comparison boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table competitors is '채널별 경쟁채널 목록 (Competitor Master)';

-- 3. 프로그램 마스터
create table programs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  canonical_name text not null, -- 정규화된 이름 (회차·<본> 제거)
  raw_name text not null,       -- 원본 그대로 보존
  episode_number int,
  first_run boolean,            -- <본> 표시가 있으면 true(본방)
  created_at timestamptz not null default now()
);
comment on table programs is '프로그램 마스터 (정규화된 이름 + 원본명 보존)';

-- 4. 타깃 세그먼트 마스터
create table targets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- '2049','M30','F20','유료가구' 등
  label text not null,
  gender text,
  age_min int,
  age_max int
);
comment on table targets is '타깃 세그먼트 마스터';

-- 5. 시청률 (핵심 Fact 테이블)
create table ratings (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('nielsen_daily','skyuhd','annual_2025')),
  channel_id uuid not null references channels(id) on delete cascade,
  program_id uuid references programs(id) on delete set null,
  target_id uuid references targets(id) on delete set null,
  broadcast_date date not null,
  start_time time,
  end_time time,
  rating numeric,
  share numeric,
  reach numeric,
  time_spent_seconds int,
  time_spent_share numeric,
  rank int,
  created_at timestamptz not null default now()
);
comment on table ratings is '시청률 데이터 (Nielsen 일별/skyUHD/2025년 연간, source_type으로 구분). NULL과 0은 반드시 구분한다.';
create index idx_ratings_channel_date on ratings (channel_id, broadcast_date);
create index idx_ratings_program on ratings (program_id);
create index idx_ratings_source_type on ratings (source_type);

-- 6. 목표 시청률
create table target_goals (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  year int not null,
  target_rank text, -- 숫자 등위 또는 "경쟁채널 중 2위" 같은 텍스트
  target_rating numeric,
  created_at timestamptz not null default now(),
  unique (channel_id, year)
);
comment on table target_goals is '채널별 연도별 목표 시청률·목표 등위';

-- 7. 관리자 지정 주요 콘텐츠
create table featured_content (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  category text not null, -- 오리지널드라마 | 독점예능 | 오리지널예능 | 브랜디드 | 구매예능
  broadcast_schedule_text text,
  broadcast_day_of_week text[],
  broadcast_time time,
  broadcast_start_date date,
  broadcast_end_date date,
  created_at timestamptz not null default now()
);
comment on table featured_content is '관리자가 직접 지정한 주요 콘텐츠 (킬러 콘텐츠는 ratings 집계로 계산, 테이블 없음)';

-- 8. 업로드 파일 이력 (데이터 품질 검증)
create table file_uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_type text not null check (file_type in (
    'nielsen_daily','skyuhd','annual_2025','target_rating','channel_master','competitor_master'
  )),
  reference_date date,
  file_hash text,
  status text not null default 'pending' check (status in ('pending','processed','error')),
  error_message text,
  uploaded_at timestamptz not null default now()
);
comment on table file_uploads is '업로드된 원본 파일 이력 (파일·구조·값·완전성 검증 결과 추적용)';

-- 9. PD 공유 링크
create table share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
comment on table share_links is 'PD가 접속하는 고정 공유 링크 (관리자가 재발급/무효화 가능)';
