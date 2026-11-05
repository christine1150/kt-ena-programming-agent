-- 분당(1분 단위) 시청률 — 사용자 지시 2026-11-05: "나는 솔로 분당 시청률 그래프 반영".
-- 닐슨 일일 파일에는 프로그램 평균만 있고 분 단위 흐름(시작 분·정점·이탈)이 없어서, 사용자가 별도로 뽑아 주는 "분당 시청률" 엑셀을 담는다.
-- 한 행 = (방송일 × 채널 × 분). 채널은 자사 채널과 동시방송 경쟁채널(SBS Plus 등)을 이름으로 담는다(자사 채널 테이블에 묶지 않음).
-- 값은 % 단위. 4개 열은 카드가 쓰는 조합(수도권 2049 / 수도권 가구 / 전국 2049 / 전국 가구)을 그대로 따른다.
-- 기존 테이블·함수는 건드리지 않는 신규 추가만 한다. 서버(service_role)만 접근하므로 RLS 를 켜고 정책은 두지 않는다(20261016010000 과 같은 모델).
-- 몇 번을 실행해도 같은 결과(멱등).

create table if not exists program_minute_ratings (
  broadcast_date date not null,
  channel_name text not null,
  -- 방송일 시작(00:00)부터의 분. 방송일은 02:00~26:00 기준이라 00:30 은 1470(24:30)으로 저장한다(competitor_airings 와 같은 규칙).
  minute_of_day int not null check (minute_of_day between 0 and 1799),
  p2049_capital numeric check (p2049_capital is null or (p2049_capital >= 0 and p2049_capital <= 100)),
  household_capital numeric check (household_capital is null or (household_capital >= 0 and household_capital <= 100)),
  p2049_national numeric check (p2049_national is null or (p2049_national >= 0 and p2049_national <= 100)),
  household_national numeric check (household_national is null or (household_national >= 0 and household_national <= 100)),
  source_file text,
  created_at timestamptz not null default now(),
  primary key (broadcast_date, channel_name, minute_of_day)
);
comment on table program_minute_ratings is '분당(1분 단위) 시청률 — 사용자가 별도로 뽑아 주는 엑셀. 같은 방송일·채널을 다시 올리면 그 날짜·채널은 새 파일 내용으로 바뀐다.';

alter table program_minute_ratings enable row level security;
