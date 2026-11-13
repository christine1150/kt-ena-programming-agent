-- 채널별 오리지널·본사 프로그램 장르 구분과 방영 내역(2026-11-13, 사용자 지시)
-- 원본: docs/iptv/excel/채널별_오리지널_프로그램_통합본.xlsx. 채널(종합 엑셀 탭명) × 프로그램 단위로
-- 그 채널의 '오리지널 예능/드라마/교양…'과, 지상파 계열 채널이 방영하는 지상파 본사 프로그램('본사 예능/드라마…')을 저장한다.
-- iptv_program_genre(작품 단위 장르, 당사 오리지널 기준)는 건드리지 않는 신규 보조 테이블. 서버(service_role)만 접근.
create table if not exists channel_original_programs (
  channel text not null,               -- 종합 엑셀 탭명(예: SBS Plus, MBC every1, KBS JOY, 채널S)
  program_key text not null,           -- 프로그램 정규화 이름(공백·문장부호·괄호 제거, 소문자)
  program_name text not null,          -- 통합본 표기
  label_kind text not null check (label_kind in ('ORIGINAL', 'HQ')),  -- ORIGINAL=그 채널 오리지널 / HQ=지상파 본사 프로그램(계열 채널 편성)
  genre_label text not null,           -- 오리지널 예능·오리지널 드라마·본사 예능 등
  source_channel text,                 -- 통합본의 채널(회사)명
  co_channels text,                    -- 공동제작·동시편성 채널 표기
  status text,                         -- 방영중·종영·방영예정 등
  air_days text,
  air_time text,
  episode_info text,
  start_text text,
  end_text text,
  note text,
  source_url text,
  updated_at timestamptz not null default now(),
  primary key (channel, program_key)
);
create index if not exists channel_original_programs_key_idx on channel_original_programs (program_key);
alter table channel_original_programs enable row level security;
comment on table channel_original_programs is '채널별 오리지널(ORIGINAL)·지상파 본사(HQ) 프로그램 장르 구분과 방영 내역(2026-11-13, 통합본 엑셀 기준). 본방 여부·장르 라벨의 채널 단위 근거.';
