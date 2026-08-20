-- 개발 단위 17번: 편성 추천(Fit Score 기반 5태그: STRENGTHEN/KEEP/MOVE/REPLACE/TEST).
-- 공식은 PRD.md 5번에 고정된 그대로:
--   Fit Score = 30% Target Performance + 20% Target Affinity + 15% Audience Engagement
--             + 15% Slot Performance + 10% Competitive Opportunity + 10% Audience Flow
--   Target Performance = 40% Program Target Rating + 30% Same Slot Historical + 30% Same Daypart (각각 percentile)
--   Slot Performance = 50% Same Slot percentile + 30% Same Daypart percentile + 20% 최근 추세
--   Competitive Opportunity = 40%×(100−Competitive Pressure) + 30%×Gap 정규화 + 30%×최근 경쟁강도 추세
--   Audience Flow = Lead-in Retention(다음 프로그램 시청률 ÷ 이전 프로그램 시청률)을 0~100 표준화
--   태그: Confidence 낮으면 무조건 TEST, 아니면 80~100 STRENGTHEN / 65~79 KEEP / 50~64 MOVE / 50미만 REPLACE
--
-- CLAUDE.md 원칙: "Fit Score처럼 여러 지표를 조합하는 계산은 MART_* 테이블에 SQL/Python으로
-- 사전 계산해두고, Claude는 그 결과를 조회해 해석·설명만 담당한다." 가중치는 CONFIG 테이블로 관리한다.
--
-- **문서화된 설계 판단(PRD가 정확히 정의하지 않은 부분 — 개발 단위 16번의 Competitive Pressure
-- "기간 평균 근사"와 같은 성격의, 정직하게 밝히는 단순화)**:
-- 1) "Program"의 단위는 `programs.canonical_name`(channel_id+canonical_name으로 회차 걸쳐 하나의 id로
--    이미 통합돼 있음, 관리자 업로드 로직 참고)로 삼는다.
-- 2) Daypart는 방송 편성 관행에 따라 4구간으로 정의한다: 새벽(02~08시)/오전(09~13시)/오후(14~18시)/
--    저녁·심야(19~25시). PRD에 정확한 경계가 없어 임의로 정했다.
-- 3) Target Affinity·Competitive Opportunity는 프로그램별이 아니라 **채널 단위**로 계산해 그 채널의
--    모든 프로그램에 동일하게 적용한다 — 원본 자료가 프로그램별 세부 타깃/경쟁채널 데이터를 충분히
--    제공하지 않기 때문(개발 단위 16번에서 이미 확인된 한계, DATA_DICTIONARY.md §5 참고).
--    Target Affinity는 WHO IS WATCHING?과 같은 4개 대표 연령대 Affinity Index 평균을 6개 채널간
--    percentile로 환산한 값을 쓴다.
-- 4) 개별 percentile 하위지표 계산에 쓸 데이터가 없으면(예: 표본 부족) 0으로 임의 대체하지 않고
--    50(중앙값 = "평균적") 로 처리해 전체 계산이 막히지 않게 한다 — 다만 이 경우 evidence에
--    "insufficient"로 표시해 사용자가 알 수 있게 한다. 6개 상위 지표 중 Audience Flow만 정말 값이
--    없을 수 있는데(그 프로그램이 항상 그날 첫 방송이라 이전 프로그램이 없는 경우), 이때는 그 지표를
--    빼고 나머지 5개 가중치로 재정규화한다(0으로 채우지 않음).

-- ============================================================
-- 0) 헬퍼: src/lib/targetResolution.ts의 resolveProgramLevelTargetLabel()과 동일 규칙
-- ============================================================
create or replace function resolve_program_target_label(p_primary_target text)
returns text
language sql
immutable
as $$
  select case
    when p_primary_target like '%유료방송가입가구%' then '전국 유료가구'
    else trim(replace(p_primary_target, '개인', ''))
  end
$$;
comment on function resolve_program_target_label is 'src/lib/targetResolution.ts의 resolveProgramLevelTargetLabel()과 동일 규칙을 SQL로 재현 (Fit Score MART 계산용)';

-- ============================================================
-- 1) CONFIG 테이블 — 가중치(채널별 튜닝 가능, channel_id NULL = 전체 기본값)
-- ============================================================
create table fit_score_config (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete cascade,
  weight_target_performance numeric not null default 30,
  weight_target_affinity numeric not null default 20,
  weight_audience_engagement numeric not null default 15,
  weight_slot_performance numeric not null default 15,
  weight_competitive_opportunity numeric not null default 10,
  weight_audience_flow numeric not null default 10,
  full_confidence_sample_days int not null default 16,
  min_confidence_pct_for_tag numeric not null default 50,
  updated_at timestamptz not null default now(),
  unique (channel_id)
);
comment on table fit_score_config is 'Fit Score 가중치 CONFIG (PRD.md 고정값 30/20/15/15/10/10을 기본값으로 심어두되, 운영 데이터로 채널별 튜닝 가능). channel_id NULL 행이 전체 기본값.';
insert into fit_score_config (channel_id) values (null);

-- ============================================================
-- 2) MART_SLOT_SCORE — 채널×타깃×요일×시간대(슬롯) 단위 percentile + 최근 추세
-- ============================================================
create table mart_slot_score (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  day_of_week int not null,
  hour_block int not null,
  daypart text not null,
  avg_rating numeric,
  slot_pctl numeric,
  daypart_avg_rating numeric,
  daypart_pctl numeric,
  recent_trend_score numeric,
  created_at timestamptz not null default now(),
  unique (as_of_date, channel_id, target_id, day_of_week, hour_block)
);
comment on table mart_slot_score is '채널×요일×시간대(슬롯) 단위 최근 12주 percentile + 최근 4주/이전 8주 추세. Target Performance·Slot Performance 계산의 공통 입력.';

-- ============================================================
-- 3) MART_PROGRAM_TARGET_SCORE — Program × Target 단위: Target Performance/Affinity/Engagement
--    (+ 참고용으로 Slot Performance 계산도 여기서 함께 저장 — 같은 슬롯 percentile 입력을 재사용)
-- ============================================================
create table mart_program_target_score (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  sample_days int not null,
  avg_rating numeric,
  program_rating_pctl numeric,
  same_slot_pctl numeric,
  same_daypart_pctl numeric,
  recent_trend_score numeric,
  target_performance_score numeric,
  slot_performance_score numeric,
  affinity_index numeric,
  target_affinity_score numeric,
  avg_reach numeric,
  reach_pctl numeric,
  avg_time_spent_share numeric,
  time_spent_share_pctl numeric,
  audience_engagement_score numeric,
  created_at timestamptz not null default now(),
  unique (as_of_date, channel_id, program_id, target_id)
);
comment on table mart_program_target_score is 'Program×Target 단위 Target Performance/Target Affinity/Audience Engagement/(참고) Slot Performance. 최근 12주(84일) 기준.';

-- ============================================================
-- 4) MART_COMPETITIVE_SCORE — 채널×타깃 단위 Competitive Opportunity (채널의 모든 프로그램에 공통 적용)
-- ============================================================
create table mart_competitive_score (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  our_avg_rating numeric,
  top3_avg_rating numeric,
  competitive_pressure numeric,
  gap_score numeric,
  trend_score numeric,
  competitive_opportunity_score numeric,
  created_at timestamptz not null default now(),
  unique (as_of_date, channel_id, target_id)
);
comment on table mart_competitive_score is '채널×타깃 단위 Competitive Opportunity — 개발 단위 16번 get_competitive_pressure() 재사용 (동시간대가 아닌 기간 평균 근사, 채널 단위로 그 채널 모든 프로그램에 공통 적용).';

-- ============================================================
-- 5) MART_FLOW_SCORE — Program × Target 단위 Audience Flow(Lead-in Retention)
-- ============================================================
create table mart_flow_score (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  sample_days int not null,
  avg_lead_in_retention numeric,
  audience_flow_score numeric,
  created_at timestamptz not null default now(),
  unique (as_of_date, channel_id, program_id, target_id)
);
comment on table mart_flow_score is 'Program×Target 단위 Lead-in Retention(다음 프로그램 시청률 ÷ 이전 프로그램 시청률, 이상치 방지로 0~3배 클램프) 및 채널 내 percentile. "시청자 이동" 단정 아님(6번 비범위 원칙).';

-- ============================================================
-- 6) MART_SCHEDULING_FIT_SCORE — 최종 Fit Score + Confidence + 5태그 + 근거
-- ============================================================
create table mart_scheduling_fit_score (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  fit_score numeric,
  target_performance_score numeric,
  target_affinity_score numeric,
  audience_engagement_score numeric,
  slot_performance_score numeric,
  competitive_opportunity_score numeric,
  audience_flow_score numeric,
  sample_days int,
  confidence_pct numeric,
  tag text check (tag in ('STRENGTHEN','KEEP','MOVE','REPLACE','TEST')),
  evidence jsonb,
  created_at timestamptz not null default now(),
  unique (as_of_date, channel_id, program_id, target_id)
);
comment on table mart_scheduling_fit_score is '최종 Fit Score(0~100) + Confidence(%) + 5태그(STRENGTHEN/KEEP/MOVE/REPLACE/TEST) + 근거(evidence). Claude는 이 테이블을 조회해 해석·설명만 한다(직접 계산 금지).';
create index idx_fit_score_channel_date on mart_scheduling_fit_score (channel_id, as_of_date);
