-- 사용자 지시(2026-09-07): "OLIFE 종합 정보.xlsx"(2024-01-01~오늘, 가구 일별/월별·연령대별
-- 월별·플랫폼별 월별·평일/주말 월별 5개 시트)를 "학습하여 DB로 등록후 보고서에 활용"하라는
-- 명시적 지시. ratings 테이블(닐슨 일별 원본, program_id/target_id 기반, 2025-01-01~)과는
-- 성격이 달라(이 자료는 프로그램 단위가 아니라 채널 전체의 사전 집계값이고, 시작일도 2024-01-01로
-- 더 이르다) 별도 테이블로 신규 추가한다(CLAUDE.md "Delta-Only" 원칙 — 기존 ratings 스키마·ETL은
-- 손대지 않음). channel_monthly_program_trend류(개발 단위 ?, 사용자 제공 참고자료 저장용)와 같은
-- 성격의 테이블이다.
--
-- 5개 시트를 (granularity, dimension, target_label) 3축으로 정규화해 하나의 테이블에 담는다
-- (시트별로 별도 테이블을 만들면 5개 테이블이 거의 같은 컬럼을 반복하게 됨):
--   dimension='household'      : "OLIFE 기본 정보"(daily)/"Sheet2"(monthly) — 유료방송가구 1개 타깃
--   dimension='age_gender'     : "Sheet3"(monthly) — 유료방송가구 + 연령대×성별 10개 타깃
--   dimension='platform'       : "플랫폼별"(monthly) — 유료방송가구 + IPTV/SKY/케이블/케이블디지털/케이블아날로그 가구
--   dimension='weekday_weekend': "Sheet5"(monthly) — 근무주(평일)/주말 2개 타깃
-- 평균시청시간은 원본이 엑셀 시간형식(하루=1)으로 저장돼 있어 초 단위(avg_time_spent_seconds)로
-- 환산해 저장하고, 원본 비율값(avg_time_spent_ratio)도 그대로 함께 보존한다(NULL≠0 원칙,
-- CLAUDE.md — 값이 없으면 반드시 NULL).
create table if not exists olife_reference_metrics (
  id uuid primary key default gen_random_uuid(),
  granularity text not null check (granularity in ('daily', 'monthly')),
  period_date date not null, -- daily: 실제 날짜, monthly: 그 달 1일로 저장
  year int not null,
  month int, -- 1~12 (일/월 구분과 무관하게 항상 채워둠 — 월별 group by 편의를 위해 daily 행에도 채움)
  dimension text not null check (dimension in ('household', 'age_gender', 'platform', 'weekday_weekend')),
  target_label text not null, -- 예: '유료방송가구'·'여20대'·'IPTV 가구'·'근무주'·'주말' (원본 표기 그대로)
  rating numeric,
  share numeric,
  avg_time_spent_seconds numeric,
  avg_time_spent_ratio numeric,
  reach numeric,
  source_file text,
  uploaded_at timestamptz not null default now(),
  unique (granularity, period_date, dimension, target_label)
);

comment on table olife_reference_metrics is
  '사용자가 제공한 "OLIFE 종합 정보.xlsx"(2024-01-01~) 참고 자료 — 가구/연령대/플랫폼/평일주말 사전 집계값. 닐슨 원본 프로그램 단위 데이터(ratings)와 별개.';

alter table olife_reference_metrics enable row level security;
-- anon/authenticated용 정책 없음(20260826160000과 동일한 관례) — service_role만 접근,
-- 이 앱은 서버(service_role 키)에서만 Supabase를 호출하므로 이 테이블도 그 모델을 그대로 따른다.

-- "260101-260906 누적.xlsx"(market_ytd_rank_snapshot과 같은 종류의 시장 전체 채널 누적 순위
-- 파일이지만, 기존 "26년 채널 누적 시청률.xlsx"와 달리 순위·시청률 외에 점유율·평균시청시간도
-- 함께 제공) — 기존 컬럼(rank, rating)은 그대로 두고 nullable 컬럼만 추가(하위 호환,
-- 기존 저장된 행은 새 컬럼이 NULL로 남음 — 그 시점엔 이 값을 안 받았으므로 정직하게 NULL).
alter table market_ytd_rank_snapshot
  add column if not exists share numeric,
  add column if not exists avg_time_spent_seconds numeric,
  add column if not exists avg_time_spent_ratio numeric;
