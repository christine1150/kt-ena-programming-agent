-- IPTV 셋톱(TV INDEX) "지역별 시청" — 사용자 추가 자료 2026-11-11(ENA 주간 16개 시도 순위). 신규 추가만(멱등), service_role 만 접근.
--  metric: rating(시청률 %), reach_rate(도달률 %). rank 는 원본 순위 그대로.
create table if not exists iptv_tvindex_region (
  channel_name text not null,
  target_kind text not null check (target_kind in ('household', 'p2049')),
  period_from date not null,
  period_to date not null,
  region text not null,
  metric text not null,
  value numeric,
  rank int,
  source_file text,
  created_at timestamptz not null default now(),
  primary key (channel_name, target_kind, period_from, period_to, region, metric)
);
comment on table iptv_tvindex_region is 'IPTV 셋톱 채널 지역(16개 시도)별 시청률·도달률(TV INDEX 지역별 시청).';
alter table iptv_tvindex_region enable row level security;

comment on table iptv_tvindex_channel_daily is 'IPTV 셋톱 채널 일별 값(TV INDEX 시청 추이·플랫폼별 시청). 달력 날짜 기준. metric 이 weekly_ 로 시작하면 주간 값이며 stat_date 는 그 주 월요일.';
