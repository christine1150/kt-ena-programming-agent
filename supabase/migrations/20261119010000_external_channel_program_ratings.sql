-- 자사·경쟁 페어링 채널이 아닌 외부 채널(EBS 등)의 프로그램 단위 닐슨 시청률 저장소.
-- 용도: OLIFE가 EBS 콘텐츠(세계테마기행·극한직업·한국기행)를 구매·편성할 때의 원방송(EBS) 성적을
--       회차(방송일자) 단위로 조회해 OLIFE 예측 시청률·시청률 지도의 근거로 쓴다(2026-11-19 사용자 제공 EBS 시청률.xlsx).
-- 기존 ratings는 자사 7채널(channel_id FK)용이라 외부 채널을 넣을 수 없고, competitor_program_ratings는
-- 자사 채널과 페어링된 경쟁채널 1개 전용이라 별도 테이블로 둔다. 기존 테이블·ETL은 건드리지 않는다.
create table external_channel_program_ratings (
  id uuid primary key default gen_random_uuid(),
  channel_name text not null,                 -- 예: 'EBS'
  broadcast_date date not null,
  start_time time not null,
  end_time time,
  duration_sec integer,
  program_name text not null,                 -- 닐슨 원문(<재> 꼬리표 포함, 예: '한국기행<재>')
  program_base text not null,                 -- <재>·공백 제거한 기본 이름
  is_rerun boolean not null default false,    -- 닐슨 이름에 <재>가 붙은 방영
  genre text,                                 -- 닐슨 대분류
  target_label text not null,                 -- 예: '유료방송가구'
  region text not null default 'National',
  rating numeric not null,                    -- 단위 %
  source_file text,
  created_at timestamptz not null default now(),
  unique (channel_name, broadcast_date, start_time, program_name, target_label)
);
create index idx_external_ratings_lookup on external_channel_program_ratings (channel_name, program_base, broadcast_date);
alter table external_channel_program_ratings enable row level security;
comment on table external_channel_program_ratings is '외부 채널(EBS 등) 프로그램 단위 닐슨 시청률. 유료방송가구·National 기준(2026-11-19 EBS 시청률.xlsx). 자사 ratings와 분리.';
