-- 사용자 지시(2026-09-30): "이상적 1주일 편성(Ideal Weekly Grid)" 신규 페이지 STEP 2 — 설정·필수 편성·장르
-- 3개 테이블 신설. 설계 문서: IDEAL_SCHEDULE_DESIGN.md (D-1, F, 확정 사항).
--
-- 기존 테이블은 변경하지 않는다. 주요 콘텐츠(featured_content)는 실행 시점에 조회해 AUTO_MAIN_CONTENT
-- 제약으로 쓰므로 이 테이블들로 복사하지 않는다(이중 저장 방지).
-- RLS: 20260909010000과 같은 모델 — 서버(service_role)만 접근, anon/authenticated 정책 없음.

-- ============================================================
-- 1) 최적화 설정 — 가중치·반복 규칙·Expected KPI·전략·시간 구조 파라미터(코드 하드코딩 금지)
--    channel_id NULL 행 = 전체 기본값(fit_score_config와 같은 패턴). 기본행 변경은 관리자 전용(API에서 제어).
-- ============================================================
create table ideal_schedule_config (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete cascade,
  weights jsonb not null,
  repeat_rules jsonb not null,
  expected_kpi jsonb not null,
  strategy jsonb not null,
  structure jsonb not null,
  targets jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
-- channel_id NULL도 1행만 허용(일반 unique는 NULL을 중복 허용하므로 coalesce 인덱스로 보장)
create unique index ideal_schedule_config_channel_uniq
  on ideal_schedule_config (coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid));
comment on table ideal_schedule_config is '이상적 1주일 편성 최적화 설정(2026-09-30). channel_id NULL=전체 기본값. 초기값은 설계 문서의 기본 가중치 35/20/20/10/5/10 — 운영 중 조정 대상이며 근거 없는 보정값이 아님을 명시하기 위해 모두 이 테이블에서만 관리한다.';

insert into ideal_schedule_config (channel_id, weights, repeat_rules, expected_kpi, strategy, structure, targets, updated_by)
values (
  null,
  '{"kpi":35,"target":20,"weekday_slot":20,"trend":10,"stability":5,"lead":10}'::jsonb,
  '{"daily_cap":3,"weekly_cap":14,"consecutive_penalty":0.15,"same_slot_penalty":0.05,"genre_concentration_penalty":0.05,"low_confidence_penalty":0.1,"runtime_mismatch_penalty":0.1}'::jsonb,
  '{"lookback_days":84,"recent_days":28,"recent_weight":2,"shrinkage_k":4,"min_n":3,"full_confidence_n":12,"exclude_holidays":true}'::jsonb,
  '{"strong_threshold":1.2,"match_weight":0.5,"counter_weight":0.5,"benchmark_confidence_cap":0.4,"target_mismatch_penalty":0.2,"include_benchmark_in_totals":false,"competitor_target_mode":"AUTO_MATCH_KPI"}'::jsonb,
  '{"default_mode":"KEEP_CURRENT","skeleton_weeks":4,"grid_minutes":5,"runtime_tolerance_min":10,"max_gap_min":10,"max_local_search_iter":2000}'::jsonb,
  '{"GROUP_A":{"kpi":"수도권 2049","extra":["수도권 2039","전국 유료가구"]},"GROUP_B":{"kpi":"전국 유료가구","extra":["전국 5064","수도권 2049"]},"SKYUHD":{"kpi":null,"extra":[]}}'::jsonb,
  'migration'
);

-- ============================================================
-- 2) 필수 편성(수동 필수·금주 필수·고정 슬롯). AUTO_MAIN_CONTENT는 featured_content에서 실행 시 조회.
--    시간은 방송일 분(120=02:00 ~ 1559=25:59)으로 저장해 자정 이후 방송을 다른 날로 분리하지 않는다.
-- ============================================================
create table ideal_schedule_constraints (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  program_id uuid references programs(id) on delete set null,
  program_name text not null,
  weekday int not null check (weekday between 1 and 7), -- 1=월 ... 7=일(ISO)
  start_min int not null check (start_min between 120 and 1559),
  duration_min int not null check (duration_min between 1 and 1440),
  active_from date not null,
  active_to date,
  source text not null check (source in ('MAIN_CONTENT_LIST','EXCEL_IMPORT','MANUAL','WEEKLY_INPUT')),
  constraint_type text not null check (constraint_type in ('MANUAL_REQUIRED','WEEKLY_PREMIERE','FIXED_SLOT')),
  priority int not null default 3 check (priority between 1 and 9),
  locked boolean not null default true,
  note text,
  created_by text, -- "admin:<id>" 또는 "pd:<id>" — PD도 입력 가능(사용자 결정 2026-09-30)
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (active_to is null or active_to >= active_from),
  unique (channel_id, weekday, start_min, program_name, active_from)
);
create index idx_ideal_schedule_constraints_channel on ideal_schedule_constraints (channel_id, active_from);
comment on table ideal_schedule_constraints is '이상적 1주일 편성의 필수 편성 입력(MANUAL_REQUIRED/WEEKLY_PREMIERE/FIXED_SLOT). 같은 우선순위끼리 시간이 겹치면 엔진이 삭제·덮어쓰기 없이 Conflict List로 돌려준다(2026-09-30).';

-- ============================================================
-- 3) 장르 매핑 — 자사·경쟁 프로그램 모두 장르 원천 데이터가 없어 신설(MATCH/COUNTER·genre_fit 입력).
--    1차 규칙 분류(RULE*) → 관리자 보완(MANUAL). MANUAL이 항상 우선하며 시드 재실행이 덮어쓰지 않는다.
-- ============================================================
create table program_genre_map (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('OWN','COMPETITOR')),
  owner_key text not null, -- OWN: channels.code / COMPETITOR: competitor_name
  canonical_name text not null, -- 공백·문장부호·<본>/<재> 제거한 이름
  genre text not null check (genre in ('드라마','예능','영화','다큐·교양','뉴스·시사','스포츠','음악','애니·키즈','홈쇼핑·기타','미분류')),
  source text not null check (source in ('FEATURED_CATEGORY','RULE_KEYWORD','RULE_CHANNEL','MANUAL')),
  rule_note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (scope, owner_key, canonical_name)
);
comment on table program_genre_map is '프로그램 장르 매핑(2026-09-30 신설). source: FEATURED_CATEGORY(주요 콘텐츠 분류) > RULE_KEYWORD(제목 키워드) > RULE_CHANNEL(채널 성격 기본값) 순의 1차 규칙 분류, MANUAL(관리자 보완)이 최우선. 시점 없는 메타데이터라 백테스트 누수 대상 아님(설계 문서 I절).';

alter table ideal_schedule_config enable row level security;
alter table ideal_schedule_constraints enable row level security;
alter table program_genre_map enable row level security;
