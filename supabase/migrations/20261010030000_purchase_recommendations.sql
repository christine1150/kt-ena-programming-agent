-- 구매 추천 사전 계산 결과(채널 × 타깃 × 기준 기간별 TOP N). 계산이 수 분 걸려 화면에서 바로 돌릴 수 없으므로
-- scripts/refresh-purchase-recommendations.ts 가 채우고 화면은 읽기만 한다.
create table purchase_recommendations (
  id uuid primary key default gen_random_uuid(),
  model_version text not null,
  as_of date not null,
  computed_at timestamptz not null default now(),
  own_channel_code text not null,
  target text not null check (target in ('A2049', 'HH')),
  window_days int not null,
  rank int not null,
  group_key text not null,
  rep_key text not null,
  display_name text not null,
  genre text,
  prediction numeric not null,
  prediction_low numeric,
  prediction_high numeric,
  content_index numeric,
  peer_count int,
  peer_airings int,
  channel_annual_avg numeric,
  vs_annual_avg numeric,
  confidence text,
  unique (own_channel_code, target, window_days, group_key)
);
create index purchase_recommendations_lookup on purchase_recommendations (own_channel_code, window_days, rank);
alter table purchase_recommendations enable row level security;
comment on table purchase_recommendations is '구매 시뮬레이터 구매 추천 사전 계산(2026-10-02). 해당 채널에서 방영 이력이 없고 케이블 재방 3곳 이상 근거가 있는 프로그램의 예상 시청률 순위.';
