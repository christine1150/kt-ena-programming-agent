-- 개발 단위 16번: 타깃 분석(Affinity)·경쟁채널 분석(Competitive Pressure) 준비.
--
-- 실제로 겪은 문제: 지금까지 Nielsen 일별 파서(개발 단위 7번)는 "유료방송가입가구"/"개인"
-- 랭킹 시트에서 우리 6개 채널 행만 남기고 나머지(경쟁채널 포함 전체 시장)는 버리고 있었다.
-- Competitive Pressure·Affinity 계산에는 등록된 경쟁채널의 시청률이 필요해서, 별도의 작은
-- 테이블에 경쟁채널의 "채널 단위 일별 랭킹" 값을 채널 단위로 저장한다.
--
-- channels 테이블에 넣지 않는 이유: "분석 대상은 7개 채널"이라는 고정 아키텍처 결정(CLAUDE.md)을
-- 유지하기 위함 — 경쟁채널은 별도 관찰 데이터일 뿐, 우리가 관리하는 채널이 아니다.
create table competitor_ratings (
  id uuid primary key default gen_random_uuid(),
  competitor_name text not null, -- competitors.competitor_name과 동일한 표기
  target_id uuid references targets(id) on delete set null,
  broadcast_date date not null,
  rank int,
  rating numeric,
  share numeric,
  reach numeric,
  time_spent_seconds int,
  source_type text not null default 'nielsen_daily' check (source_type in ('nielsen_daily')),
  created_at timestamptz not null default now()
);
comment on table competitor_ratings is '등록된 경쟁채널(competitors)의 일별 채널 단위 시청률 — 유료방송가입가구/개인 랭킹 시트에서 추출. 프로그램 단위 데이터는 없음(원본 파일이 채널당 1개 비교채널만 프로그램 단위로 제공)';
create index idx_competitor_ratings_name_date on competitor_ratings (competitor_name, broadcast_date);
