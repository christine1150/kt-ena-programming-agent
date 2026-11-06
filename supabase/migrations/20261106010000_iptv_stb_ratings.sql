-- IPTV 셋톱(STB) 시청률 — 사용자 지시 2026-11-06: "1페이지 일간 세부 내역에 iPTV 항목을 하나 더 신설, 내가 자료를 주면 같이 볼 수 있게".
-- 닐슨이 아닌 IPTV 3사 셋톱 시청률의 프로그램(방영 구간)별 값을 담는다. 값은 % 단위(닐슨 ratings.rating 과 같은 단위).
-- 한 행 = (방송일 × 채널 × 방영 시작 분). 방송일은 닐슨과 같은 02:00~익일 02:00 기준이라, 달력상 00:00~01:59 방영분은 전날 방송일의 24~26시대로 담는다(program_minute_ratings 와 같은 규칙).
-- "< 0.0001" 처럼 바닥값으로만 표시되는 구간은 rating 을 비우고 below_floor 를 켠다(값을 지어내지 않는다).
-- 기존 테이블·함수는 건드리지 않는 신규 추가만 한다. 서버(service_role)만 접근하므로 RLS 를 켜고 정책은 두지 않는다. 몇 번을 실행해도 같은 결과(멱등).

create table if not exists iptv_stb_ratings (
  broadcast_date date not null,
  channel_code text not null,
  start_minute int not null check (start_minute between 0 and 1799),
  end_minute int not null check (end_minute between 1 and 1800),
  program_name text not null,
  rating numeric check (rating is null or (rating >= 0 and rating <= 100)),
  below_floor boolean not null default false,
  source_file text,
  created_at timestamptz not null default now(),
  primary key (broadcast_date, channel_code, start_minute),
  check (end_minute > start_minute)
);
comment on table iptv_stb_ratings is 'IPTV 셋톱(STB) 시청률 — 사용자가 따로 주는 자료. 같은 방송일·채널·시작 분은 다시 올리면 새 값으로 바뀐다.';

alter table iptv_stb_ratings enable row level security;
