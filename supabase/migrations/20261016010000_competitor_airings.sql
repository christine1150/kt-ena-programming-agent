-- 경쟁 채널 편성 단위 자료(사용자 지시 2026-10-13: "경쟁 채널의 편성 단위 데이터는 엑셀로 올릴 수 있게 PD의 담당 채널(ENA Play)에").
-- 기존 competitor_program_ratings 는 채널당 경쟁채널 1개뿐이라(마이그레이션 20260819190000 주석) 편성 겹침·편성 가능 구간 같은 분석을 할 수 없다.
-- 이 테이블은 PD 가 엑셀로 올린 "경쟁 채널 × 방송일 × 시작 시각 × 프로그램" 단위를 담는다. 시청률은 비어 있을 수 있다(미래 편성·미집계).
-- 기존 테이블·함수는 건드리지 않는 신규 추가만 한다. 서버(service_role)만 접근하므로 RLS 를 켜고 정책은 두지 않는다(20260826160000, 20261015010000 과 같은 모델).
-- 몇 번을 실행해도 같은 결과(멱등).

create table if not exists competitor_airings (
  id uuid primary key default gen_random_uuid(),
  our_channel_id uuid not null references channels(id) on delete cascade,
  competitor_name text not null,
  broadcast_date date not null,
  -- 방송일 시작(00:00)부터의 분. 방송일은 02:00~26:00 기준이라 00:30 은 1470(24:30)으로 저장한다. 시각 계산(겹침·구간)을 쉽게 하려고 time 대신 분 정수를 쓴다.
  start_minute int not null check (start_minute between 0 and 1799),
  end_minute int check (end_minute is null or (end_minute > start_minute and end_minute <= 1800)),
  program_name text not null,
  -- 회차·<본>/<재> 태그를 뗀 프로그램 키(programNameMatch.normalizeProgramCanonicalName 와 같은 규칙)
  program_key text not null,
  episode_no int,
  is_rerun boolean,
  -- 시청률(% 단위). 비어 있으면 편성 예정 또는 미집계.
  rating numeric check (rating is null or (rating >= 0 and rating <= 100)),
  target_label text,
  batch_id uuid not null,
  source_file text,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (our_channel_id, competitor_name, broadcast_date, start_minute, program_key)
);
create index if not exists idx_competitor_airings_lookup on competitor_airings (our_channel_id, competitor_name, broadcast_date);
create index if not exists idx_competitor_airings_batch on competitor_airings (batch_id);
comment on table competitor_airings is '경쟁 채널 편성 단위 자료 — PD 가 엑셀로 올린 (경쟁채널 × 방송일 × 시작 × 프로그램). 같은 경쟁채널·같은 방송일을 다시 올리면 그 날짜는 새 파일 내용으로 바뀐다.';

-- 올린 이력(파일 단위). 화면의 "최근 반영" 표시용이며 되돌리기 기능을 붙일 때 batch_id 로 찾는다.
create table if not exists competitor_airing_batches (
  batch_id uuid primary key,
  our_channel_id uuid not null references channels(id) on delete cascade,
  file_name text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  row_count int not null default 0,
  replaced_count int not null default 0,
  competitor_count int not null default 0,
  date_from date,
  date_to date
);
create index if not exists idx_competitor_airing_batches_channel on competitor_airing_batches (our_channel_id, uploaded_at desc);
comment on table competitor_airing_batches is '경쟁 채널 편성 자료 업로드 이력(파일 단위)';

alter table competitor_airings enable row level security;
alter table competitor_airing_batches enable row level security;
