-- 사용자 지시(2026-09-02 최초, 2026-09-03 재지시) — 사내 "전체 채널 월간 추이" 자료를 월간/주간
-- 리뷰 하단에 함께 정리해 보여주기 위한 적재용 테이블 2개.
--
-- 배경: 사용자가 "전체 채널 월간 추이(26년8월업데이트).xlsx"를 PD 수동 리포트 업로드로 반영해
-- 달라고 요청했는데, 원본 파일이 사내 문서보안(DRM, 파일 시그니처 "SCDSA004")으로 암호화돼
-- 있어 코드로 파싱할 수 없었다. 사용자가 대신 스크린샷으로 내용을 확인시켜 줬고, 암호가 풀린
-- 사본은 이후 별도 전달하기로 했다. 그래서 이번에는 **파서 없이 테이블만 먼저 만들고** 값은
-- 적재 스크립트로 넣는다 — 나중에 원본을 받으면 같은 테이블에 업로드 파서만 붙이면 된다.
--
-- **왜 ratings 테이블에 넣지 않는가**: 이 값들은 닐슨 원자료가 아니라 사내에서 이미 "장르별로
-- 묶어 월 단위로 집계해 둔 2차 가공치"다. ratings에 넣으면 broadcast_date 범위 쿼리에 함께
-- 잡혀 모든 일간/기간 집계를 오염시킨다 — nielsen_period_rank(2026-09-01, O절) 때와 정확히
-- 같은 이유로 완전히 분리한다. 이 테이블의 값은 화면에 "참고 자료"로만 표시하고, 이 서비스가
-- 계산하는 KPI(시청률/순위/Fit Score 등)에는 절대 섞지 않는다.
--
-- **출처(provenance)를 행마다 남기는 이유**: 현재 적재분은 DRM 때문에 원본을 못 열고 스크린샷을
-- 옮겨 적은 값이라 전사(轉寫) 오류 가능성이 있다. 원본을 받아 다시 적재하면 source_note가
-- 바뀌므로, 화면이 그 문구를 그대로 노출해 PD가 신뢰 수준을 스스로 판단할 수 있게 한다.

-- ① 장르별 월간 추이(자체드라마 본/재, 자체예능 본/재, 구매 드라마, 기타, 채널평균)
create table if not exists channel_monthly_genre_trend (
  channel_code text not null,
  year int not null,
  month int not null check (month between 1 and 12),
  genre_key text not null,
  genre_label text not null,
  rating numeric,
  sort_order int not null default 0,
  source_note text,
  updated_at timestamptz not null default now(),
  -- 같은 달 자료를 다시 올려도 안전하게 덮어써진다(월 단위 재업로드가 정상 운영 흐름).
  primary key (channel_code, year, month, genre_key)
);
comment on table channel_monthly_genre_trend is '사내 "전체 채널 월간 추이" 자료의 장르별 월 단위 시청률(2차 가공치). 닐슨 원자료(ratings)와 분리 보관하며 화면에는 참고 자료로만 노출한다 — 이 서비스의 KPI 계산에는 쓰지 않는다(2026-09-03).';

-- ② 오리지널 예능/드라마의 프로그램별 월간 추이
create table if not exists channel_monthly_program_trend (
  channel_code text not null,
  year int not null,
  month int not null check (month between 1 and 12),
  category text not null, -- '오리지널 예능' | '오리지널 드라마' 등 사내 자료 표기 그대로
  program_name text not null,
  rating numeric,
  note text, -- 예: "8월 1주차 첫 방송, 목표 0.5 대비 53.6% 달성"
  sort_order int not null default 0,
  source_note text,
  updated_at timestamptz not null default now(),
  primary key (channel_code, year, month, category, program_name)
);
comment on table channel_monthly_program_trend is '사내 "전체 채널 월간 추이" 자료의 오리지널 예능/드라마 프로그램별 월 단위 시청률(2차 가공치). channel_monthly_genre_trend와 같은 원칙 — 참고 자료 전용(2026-09-03).';

create index if not exists idx_channel_monthly_genre_trend_lookup on channel_monthly_genre_trend (channel_code, year, month);
create index if not exists idx_channel_monthly_program_trend_lookup on channel_monthly_program_trend (channel_code, year, category, month);
