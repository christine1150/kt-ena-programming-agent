-- 구매 시뮬레이터 벤치마크 후보(고도화 C1, docs/upgrade-plan/C1_BENCHMARK_PURCHASE.md §3.1, 2026-11-14).
-- 가산 변경만 한다: 새 테이블 2개와 purchase_recommendations의 nullable 열 추가. 기존 열·판정·정렬·예측값은 바꾸지 않는다.
-- 벤치마크는 "비슷한 규모의 채널은 이 작품을 어떻게 소화했나"를 근거로 보이는 비교 채널 집합이다(예측 방식은 그대로).

-- 1) 채널 군 표 — 순위 파일 이름 기준. competitor_name은 닐슨 경쟁 프로그램 자료의 채널 이름(자료가 없으면 null).
--    src/lib/purchaseSim/benchmark.ts의 CHANNEL_GROUP_SEED와 같은 내용이며 관리자 화면에서 편집한다(테스트가 둘의 일치를 확인).
create table if not exists channel_groups (
  snap_name text primary key,
  group_key text not null check (group_key in ('terrestrial', 'drama', 'variety', 'life', 'uhd')),
  competitor_name text,
  is_hub boolean not null default false,
  is_own boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
comment on table channel_groups is '채널 군 표(벤치마크 선정 기준, 2026-11-14). is_hub=지상파·종편·tvN(구매 비교에서 제외), is_own=자사. competitor_name null=프로그램 자료 없음.';
alter table channel_groups enable row level security; -- 정책 없음: 서버 service_role만 접근

insert into channel_groups (snap_name, group_key, competitor_name, is_hub, is_own) values
  ('KBS1', 'terrestrial', 'KBS1', true, false),
  ('KBS2', 'terrestrial', 'KBS2', true, false),
  ('MBC', 'terrestrial', 'MBC', true, false),
  ('SBS', 'terrestrial', 'SBS', true, false),
  ('EBS', 'terrestrial', null, false, false),
  ('JTBC', 'terrestrial', 'JTBC', true, false),
  ('TV CHOSUN', 'terrestrial', 'TV CHOSUN', true, false),
  ('tvN', 'terrestrial', 'tvN', true, false),
  ('MBN', 'terrestrial', 'MBN', true, false),
  ('채널A', 'terrestrial', '채널A', true, false),
  ('SBS Plus', 'drama', 'SBS Plus', false, false),
  ('KBS드라마', 'drama', null, false, false),
  ('MBC드라마넷', 'drama', 'MBC드라마넷', false, false),
  ('D-ONE', 'drama', 'D-ONE', false, false),
  ('하이라이트TV', 'drama', null, false, false),
  ('EDGETV', 'drama', 'EDGETV', false, false),
  ('DRAMAcube', 'drama', 'DRAMAcube', false, false),
  ('CNTV', 'drama', 'CNTV', false, false),
  ('MBC ON', 'drama', 'MBC ON', false, false),
  ('tvN DRAMA', 'drama', null, false, false),
  ('Dramax', 'drama', 'Dramax', false, false),
  ('KBS Story', 'drama', 'KBS Story', false, false),
  ('ENA DRAMA', 'drama', null, false, true),
  ('ONCE', 'drama', null, false, true),
  ('ENA', 'drama', null, false, true),
  ('MBC every1', 'variety', 'MBC every1', false, false),
  ('tvN STORY', 'variety', 'tvN STORY', false, false),
  ('KBS JOY', 'variety', 'KBS JOY', false, false),
  ('채널S', 'variety', '채널S', false, false),
  ('SBS funE', 'variety', 'SBS funE', false, false),
  ('JTBC2', 'variety', 'JTBC2', false, false),
  ('FUN TV', 'variety', 'FUN TV', false, false),
  ('tvN SHOW', 'variety', 'tvN SHOW', false, false),
  ('E채널', 'variety', 'E채널', false, false),
  ('GTV', 'variety', 'GTV', false, false),
  ('K STAR', 'variety', 'K STAR', false, false),
  ('theLIFE', 'variety', 'theLIFE', false, false),
  ('CH view', 'variety', 'CH view', false, false),
  ('코미디TV', 'variety', '코미디TV', false, false),
  ('Mnet', 'variety', 'Mnet', false, false),
  ('ENA PLAY', 'variety', null, false, true),
  ('ENA STORY', 'variety', null, false, true),
  ('CMCTV', 'life', 'CMCTV', false, false),
  ('ONT', 'life', 'ONT', false, false),
  ('OLIFE', 'life', null, false, true)
on conflict (snap_name) do nothing;

-- 2) 관리자 덮어쓰기 — 채널별로 벤치마크에 추가·제외한 채널
create table if not exists benchmark_overrides (
  own_channel_code text not null,
  snap_name text not null,
  action text not null check (action in ('add', 'remove')),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (own_channel_code, snap_name)
);
comment on table benchmark_overrides is '채널별 벤치마크 추가(add)·제외(remove) 덮어쓰기(2026-11-14).';
alter table benchmark_overrides enable row level security;

-- 3) 구매 추천 근거 열 — 예측값·순위는 그대로이고 "비슷한 규모 채널의 실적"을 근거로 덧붙인다
alter table purchase_recommendations add column if not exists benchmark_peers jsonb;         -- [{ch, mult, airings}] 벤치마크 채널별 이 작품의 자리 평소 대비 배수·비교 방영 수
alter table purchase_recommendations add column if not exists benchmark_mult numeric;        -- 벤치마크 채널 배수의 중앙값
alter table purchase_recommendations add column if not exists benchmark_peer_count int;      -- 이 작품 실적이 있는 벤치마크 채널 수
alter table purchase_recommendations add column if not exists other_own_channels text[];     -- 이 작품을 이미 트는 다른 자사 채널(판권은 채널 단위라 이 채널엔 추가 구매 필요)
comment on column purchase_recommendations.benchmark_peers is '벤치마크 채널별 {ch, mult, airings}(고도화 C1). 예측·정렬에는 쓰지 않는 근거 열.';
