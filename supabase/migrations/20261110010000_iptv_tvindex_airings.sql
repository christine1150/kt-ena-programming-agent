-- IPTV 3사 셋톱(STB) 시청 자료 — TV INDEX "프로그램 방영 성과" 적재(사용자 지시 2026-11-10: "iPTV 3사 셋톱으로 수집된 시청률·점유율 등 추가 자료, 학습하여 DB로").
-- 닐슨이 아닌 IPTV STB 로그 기반 값이다. 한 행 = (채널 × 타깃 × 방송일 × 방영 시작 분) = 프로그램 한 번의 방영.
-- 값: 시청률(%), 도달자(방영 중 1분이라도 본 가구/사람 수), 1분 시청자수(평균 분당 시청자), 도달률(%).
-- 타깃은 두 가지: household = "IPTV STB 전국"(가구 단위), p2049 = "개인 2049 전체·수도권"(IPTV 셋톱 기반 추정 개인).
-- 방송일은 닐슨과 같은 02:00~익일 02:00 기준이다. TV INDEX 원본은 달력 날짜라 00:00~01:59 에 시작한 방영분은 전날 방송일의 24~26시대(+1440분)로 담는다(iptv_stb_ratings·program_minute_ratings 와 같은 규칙).
-- 기존 테이블·함수는 건드리지 않는 신규 추가만 한다. 서버(service_role)만 접근하므로 RLS 를 켜고 정책은 두지 않는다. 몇 번을 실행해도 같은 결과(멱등).

create table if not exists iptv_tvindex_airings (
  channel_name text not null,
  -- own = KT ENA 자사 7개(skyUHD 포함), uhd = UHD 경쟁채널, comp = 일반 경쟁채널
  channel_group text not null check (channel_group in ('own', 'uhd', 'comp')),
  target_kind text not null check (target_kind in ('household', 'p2049')),
  broadcast_date date not null,
  -- 방송일 시작(00:00)부터의 분. 00:30 은 1470(24:30) (competitor_airings 와 같은 규칙)
  start_minute int not null check (start_minute between 0 and 1799),
  end_minute int not null check (end_minute between 1 and 1800),
  program_name text not null,
  -- 회차·<본>/<재> 태그를 뗀 프로그램 키(programNameMatch.normalizeProgramCanonicalName)
  program_key text not null,
  -- 원본 프로그램명에 <재> 표기가 있으면 true (TV INDEX 표기 그대로이며 본방/재방 판정의 최종 근거는 아님)
  is_rerun_tag boolean not null default false,
  rating numeric check (rating is null or (rating >= 0 and rating <= 100)),
  reach_viewers bigint check (reach_viewers is null or reach_viewers >= 0),
  avg_minute_viewers bigint check (avg_minute_viewers is null or avg_minute_viewers >= 0),
  reach_rate numeric check (reach_rate is null or (reach_rate >= 0 and reach_rate <= 100)),
  source_file text,
  created_at timestamptz not null default now(),
  -- 같은 시작 분에 서로 다른 프로그램이 함께 잡히는 경우(원본에 같은 시간대 2건)가 있어 프로그램 키까지 키에 넣는다
  primary key (channel_name, target_kind, broadcast_date, start_minute, program_key),
  check (end_minute > start_minute)
);
create index if not exists idx_iptv_tvindex_airings_program on iptv_tvindex_airings (program_key, channel_name, target_kind, broadcast_date);
create index if not exists idx_iptv_tvindex_airings_date on iptv_tvindex_airings (broadcast_date, target_kind);
comment on table iptv_tvindex_airings is 'IPTV 셋톱(STB) 프로그램 방영 성과(TV INDEX) — 채널×타깃×방송일×시작 분. 같은 키를 다시 올리면 새 값으로 바뀐다.';

-- 요일×시간대 평균(TV INDEX "편성 성과 인사이트") — 지정 기간의 채널 평균 시청률(%)
create table if not exists iptv_tvindex_daypart_avg (
  channel_name text not null,
  target_kind text not null check (target_kind in ('household', 'p2049')),
  period_from date not null,
  period_to date not null,
  -- 0=월 … 6=일
  dow int not null check (dow between 0 and 6),
  -- 달력 시각 0~23 (00:00~01:00 이 0)
  hour_of_day int not null check (hour_of_day between 0 and 23),
  rating numeric check (rating is null or (rating >= 0 and rating <= 100)),
  source_file text,
  created_at timestamptz not null default now(),
  primary key (channel_name, target_kind, period_from, period_to, dow, hour_of_day)
);
comment on table iptv_tvindex_daypart_avg is 'IPTV 셋톱(STB) 요일×시간대 평균 시청률(TV INDEX 편성 성과 인사이트)';

alter table iptv_tvindex_airings enable row level security;
alter table iptv_tvindex_daypart_avg enable row level security;
