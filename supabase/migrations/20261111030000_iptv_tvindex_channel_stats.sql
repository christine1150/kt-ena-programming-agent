-- IPTV 셋톱(TV INDEX) 채널 단위 "시청 분석" 자료 — 사용자 추가 자료 2026-11-10(ENA Play 주간 자료: 시청 추이·플랫폼별·시간대별·데모그래픽).
-- 프로그램 단위가 아닌 채널 단위 값이다. 기존 테이블·함수는 건드리지 않는 신규 추가만 한다(멱등). service_role 만 접근(RLS 켜고 정책 없음).

-- 일별 채널 값(달력 날짜 기준 — TV INDEX 원본 그대로, 02:00 방송일 경계로 옮기지 않는다)
--  metric: total_viewing_time(총 시청시간, 원본 단위 그대로), viewing_minutes_per_viewer(인당 시청시간 분),
--          rating_genie_tv / rating_btv / rating_uplus_tv(플랫폼별 시청률 %)
create table if not exists iptv_tvindex_channel_daily (
  channel_name text not null,
  target_kind text not null check (target_kind in ('household', 'p2049')),
  stat_date date not null,
  metric text not null,
  value numeric,
  source_file text,
  created_at timestamptz not null default now(),
  primary key (channel_name, target_kind, stat_date, metric)
);
comment on table iptv_tvindex_channel_daily is 'IPTV 셋톱 채널 일별 값(TV INDEX 시청 추이·플랫폼별 시청). 달력 날짜 기준.';

-- 요일×시 격자(주간 등 기간 평균). hour_of_day 는 달력 시각 0~23, dow 0=월 … 6=일
--  metric: rating(%), avg_minute_viewers(1분 시청자수), reach_viewers(도달자), reach_rate(도달률 %)
create table if not exists iptv_tvindex_hourly_grid (
  channel_name text not null,
  target_kind text not null check (target_kind in ('household', 'p2049')),
  period_from date not null,
  period_to date not null,
  dow int not null check (dow between 0 and 6),
  hour_of_day int not null check (hour_of_day between 0 and 23),
  metric text not null,
  value numeric,
  source_file text,
  created_at timestamptz not null default now(),
  primary key (channel_name, target_kind, period_from, period_to, dow, hour_of_day, metric)
);
comment on table iptv_tvindex_hourly_grid is 'IPTV 셋톱 채널 요일×시 격자(TV INDEX 시간대별 시청). 기간 평균 값.';

-- 시청자 성·연령 구성(비율 %, 원본 표기 그대로)
create table if not exists iptv_tvindex_demographic (
  channel_name text not null,
  region text not null,
  period_from date not null,
  period_to date not null,
  age_band text not null,
  sex text not null check (sex in ('M', 'F')),
  viewer_ratio numeric,
  source_file text,
  created_at timestamptz not null default now(),
  primary key (channel_name, region, period_from, period_to, age_band, sex)
);
comment on table iptv_tvindex_demographic is 'IPTV 셋톱 채널 시청자 성·연령 비율(TV INDEX 시청자 데모그래픽).';

alter table iptv_tvindex_channel_daily enable row level security;
alter table iptv_tvindex_hourly_grid enable row level security;
alter table iptv_tvindex_demographic enable row level security;

-- 새로 받은 경쟁채널(2026-11-10 추가 자료) 닐슨 대응
insert into iptv_channel_map (iptv_channel_name, channel_group, nielsen_channel_code, nielsen_competitor_name, note) values
  ('TV CHOSUN', 'comp', null, 'TV CHOSUN', null),
  ('MBN', 'comp', null, 'MBN', null),
  ('채널A', 'comp', null, '채널A', null),
  ('채널S', 'comp', null, '채널S', '2049 파일이 전국 기준이라 적재하지 않음(수도권만 p2049)'),
  ('JTBC2', 'comp', null, 'JTBC2', null),
  ('tvN SHOW', 'comp', null, 'tvN SHOW', null)
on conflict (iptv_channel_name) do update set
  channel_group = excluded.channel_group,
  nielsen_channel_code = excluded.nielsen_channel_code,
  nielsen_competitor_name = excluded.nielsen_competitor_name,
  note = excluded.note;
