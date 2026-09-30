# 이상적 1주일 편성(Ideal Weekly Grid) — STEP 1 분석·설계안

- 작성: 2026-09-30 / 상태: **설계 확정(결정 5건 반영), STEP 2 대기**
- 원칙: 기존 기능 무변경, 기존 DB·RPC·컴포넌트 재사용 우선, 수치·편성 결정은 전부 결정론적 로직(LLM은 설명만)
- 전제: **이 PC·Vercel 환경에 Python 없음** → 엔진은 **TypeScript(Next.js API Route) + PostgreSQL 집계**로 설계

---

## A. 현재 프로젝트 구조 요약

| 항목 | 현황 |
|---|---|
| 스택 | Next.js 16(App Router) · React 19 · TypeScript · Tailwind 4 · Supabase(Postgres) · Vercel |
| 서버 로직 | `src/app/api/**/route.ts` + `src/lib/*.ts`, 세션 게이트 `getCurrentSession()` |
| DB 변경 | `supabase/migrations/` 192개, 신규 파일 추가만 허용(기존 수정 금지) |
| 계산 원칙 | KPI 집계는 SQL RPC/MART, 비싼 결과는 `mart_*` 사전 계산 + `cachedOrRpc` 캐시 |
| LLM | OpenAI(gpt-4o / 4o-mini) Structured Output + 규칙 기반 폴백, `llmTextCache` 캐시 |
| 엑셀 | `exceljs`(편성표 내보내기 `scheduleGridExcel.ts`), `xlsx`(업로드 파싱) |
| 테스트 | 테스트 프레임워크 없음. `tsx` 스크립트 2종(`test:intent`, `smoke`)이 전부 |
| Python | 없음(프로젝트·로컬·Vercel 모두). OR-Tools 불가 |

**12주 데이터량(2026-07-06~09-27 실측, 프로그램 행·전 타깃 합산)**

| 채널 | KPI | 행 수 | rating NULL | rating 0 |
|---|---|---|---|---|
| ENA | 수도권 개인2049 | 25,619 | 0 | 10,812 |
| ENA Drama | 수도권 개인2049 | 25,653 | 0 | 16,134 |
| ENA Play | 수도권 개인2049 | 23,290 | 0 | 13,843 |
| ENA Story | 유료방송가입가구 | 31,680 | 0 | 20,309 |
| OLIFE | 유료방송가입가구 | 28,543 | 0 | 17,574 |
| ONCE | 유료방송가입가구 | 27,336 | 0 | 15,435 |
| skyUHD | 유료방송가입가구 | 1,981 | 0 | 1,321 |
| 경쟁 프로그램(`competitor_program_ratings`) | 개인2049 / 유료방송가구 | 70,284 | — | — |

- 채널당 12주 수만 행 수준 → **Postgres에서 집계 후 수천 행만 앱으로 전달**하면 서버리스에서 충분히 처리 가능
- 파서는 공란을 NULL로 보존(`parseNumberCell`), 12주 구간 NULL은 실제 0건 → 0은 실측 0, "방송 없음"은 행 부재

---

## B. 재사용 가능한 코드

| 기존 코드 | 재사용 방식 |
|---|---|
| `src/components/ScheduleWeekGrid.tsx` | 방송일 축 상수(`GRID_START_MIN`=02:00, `GRID_END_MIN`=26:00, `PX_PER_MIN`), `intensityColor`, `weekOfMonthLabel`, 블록 절대배치·실제 duration 높이 로직 → **순수 함수만 `src/lib/scheduleGridLayout.ts`로 추출**(동작 무변경 리팩터), 신규 `IdealWeekGrid`가 공유 |
| `src/lib/scheduleGridSource.ts` | `mondayOf`, `addDaysStr`, 경쟁채널 코드 인코딩, `getAllRegisteredCompetitorNames`, 현재 편성 재구성(`getScheduleGridRows`) → "현재 편성과 비교"의 CURRENT 소스 |
| `src/lib/scheduleGridExcel.ts` | exceljs 그리드 내보내기 구조 → Ideal Grid 엑셀 다운로드 |
| `src/lib/dailyMartCache.ts` | `martFingerprint` → 실행 입력 지문(결정론 검증용) |
| `src/lib/targetResolution.ts` | 채널 KPI 타깃 표기 해석(`resolveProgramLevelTargetLabel`) |
| `src/lib/programNameMatch.ts`, `epgMatch.ts` | 프로그램명 canonical 매칭 |
| `src/lib/featuredContent.ts`, `featuredContentSchedule.ts` | 주요 콘텐츠 요일·시각·기간 파싱, 종료일 계산 |
| `src/lib/llmSynthesis.ts`, `llmTextCache.ts` | "선정 이유" 자연어 설명(구조화 근거만 입력) |
| `src/app/admin/FeaturedContentManager.tsx` | 필수 편성 입력 UI 패턴 참고 |

---

## C. 재사용 가능한 DB 자산

| 자산 | 내용 | 용도 |
|---|---|---|
| `channels` | code, primary_target, theme_color, prime_time | 대상 채널·KPI·색 |
| `programs` | canonical_name, raw_name, first_run | 후보 프로그램 단위 |
| `ratings` | 방송일·start/end·rating·share·reach·time_spent·rank, 타깃별 행 | 모든 Feature 원천 |
| `targets` | 연령·성별 타깃 | 연령대 Feature |
| `featured_content` | 요일 배열·방영 시각·시작/종료일·동시방송/직후재방 채널(26건) | **AUTO_MAIN_CONTENT 제약 원천**(복사하지 않고 실행 시 조회) |
| `competitor_program_ratings` | 경쟁채널 프로그램 단위 rating·share(단일 타깃) | Benchmark 원천 |
| `competitors`, `competitor_ratings` | 등록 경쟁채널, 채널 단위 일별 | 경쟁채널 목록·채널 baseline |
| `fit_score_config` | 가중치 CONFIG 선례(channel_id NULL=기본값) | 설정 테이블 설계 패턴 |
| `mart_slot_score` | 채널×요일×시(02~25)×타깃, 12주 평균·percentile·4주/8주 추세, **as_of_date 기준** | weekday_slot baseline |
| `mart_program_target_score` | 프로그램×타깃 12주 평균·reach·시청시간 점유·Affinity | 프로그램 기본 성과·타깃 적합도 |
| `mart_flow_score` | 프로그램 Lead-in Retention(0~3배 클램프) | lead-in association 초기값 |
| `refresh_fit_score_mart(as_of, channel)` | 모든 계산이 `as_of_date` 이전 84일로 제한 | **Walk-forward 재계산에 그대로 사용 가능** |
| `get_program_slot_recent_avg` | 채널·요일·±90분 슬롯의 최근 N주 평균 | 슬롯 baseline 보조 |
| `get_channel_week_schedule`, `get_competitor_week_schedule` | 주간 실제 편성 재구성 | CURRENT 편성·경쟁 편성 |
| `program_schedule_grid` | 업로드 편성표(부제·회차·[재] 태그) | CURRENT 편성 보강 |
| `public_holidays`, prime_time_dow_aware | 공휴일, 요일별 프라임 정의 | 특집 기간 제외·daypart |

**없는 것(신규 필요)**: 장르 마스터, 필수 편성 입력, 최적화 설정·실행·결과·백테스트 저장소

---

## D. 신규 테이블·RPC·API 명세(최소안)

요청된 8개 테이블을 기존 자산과 대조해 **6개로 축소**함.

| 요청 테이블 | 결정 | 사유 |
|---|---|---|
| fixed_schedules | `ideal_schedule_constraints` 신설 | MANUAL·WEEKLY_INPUT·FIXED_SLOT 저장. AUTO_MAIN_CONTENT는 `featured_content`를 실행 시 조회(이중 저장 방지) |
| program_performance_features | **영속 테이블 없음** | `mart_*`가 상당 부분 보유. 부족분은 RPC로 계산하고 실행별 스냅샷을 후보 테이블에 저장(재현성 확보) |
| optimization_configs | `ideal_schedule_config` 신설 | `fit_score_config`와 목적이 달라 분리 |
| optimization_runs | `ideal_schedule_runs` 신설 | 입력 지문·설정 스냅샷·충돌 목록 포함 |
| optimization_results | `ideal_schedule_blocks` + `ideal_schedule_candidates` | 블록(최종)과 슬롯별 상위 후보(Swap용) 분리 |
| optimization_constraints | constraints에 통합, 충돌은 `runs.conflicts` jsonb | 별도 테이블 불필요 |
| backtest_runs / results | `ideal_schedule_backtest_runs` / `_results` 신설 | — |
| (추가) 장르 | `program_genre_map` 신설 | MATCH/COUNTER 필수 입력인데 현재 장르 데이터 없음 |

### D-1. 테이블 초안

```
ideal_schedule_config
  id, channel_id(null=기본), name, weights jsonb, repeat jsonb, expected_kpi jsonb,
  strategy jsonb, confidence jsonb, is_default, updated_at   unique(channel_id, name)

ideal_schedule_constraints
  id, channel_id, program_id(null 허용), program_name, weekday(1~7), start_time,
  duration_min, active_from, active_to, source(MAIN_CONTENT_LIST|EXCEL_IMPORT|MANUAL|WEEKLY_INPUT),
  constraint_type(MANUAL_REQUIRED|WEEKLY_PREMIERE|FIXED_SLOT), priority int, locked bool,
  note, created_by, created_at, updated_at
  unique(channel_id, weekday, start_time, program_name, active_from)

program_genre_map
  id, scope(OWN|COMPETITOR), channel_code_or_competitor, canonical_name, genre,
  source(FEATURED_CATEGORY|RULE|MANUAL), updated_at   unique(scope, channel_code_or_competitor, canonical_name)

ideal_schedule_runs
  id, channel_id, target_week_start, as_of_date, lookback_days, kpi_target_label,
  competitor_names text[], strategy_mode(AUTO|MATCH|COUNTER|MIX), config_snapshot jsonb,
  input_fingerprint, objective_total, summary jsonb, conflicts jsonb,
  status(DONE|CONFLICT|FAILED), parent_run_id, created_by, created_at

ideal_schedule_blocks
  id, run_id, weekday, start_min(120~1559), end_min, program_id, program_name,
  content_type(OWN|COMPETITOR_BENCHMARK|ARCHETYPE), source_channel,
  status(REQUIRED|AI|MANUAL_OVERRIDE), locked, expected_kpi, expected_kpi_type,
  expected_share, expected_time_spent, confidence_score, sample_count, fallback_level,
  strategy_type(MATCH|COUNTER|NEUTRAL), competitor_slot_strength, benchmark_index,
  match_score, counter_score, fitness_score, score_components jsonb, reasons jsonb

ideal_schedule_candidates
  id, run_id, weekday, start_min, rank, program_id, program_name, content_type,
  expected_kpi, fitness_score, target_score, slot_fit, confidence_score, strategy_type,
  features jsonb, reasons jsonb      index(run_id, weekday, start_min, rank)

ideal_schedule_backtest_runs / ideal_schedule_backtest_results
  runs: id, channel_id, week_starts date[], config_snapshot, summary jsonb, created_at
  results: backtest_run_id, week_start, ideal_run_id, weekday, start_min,
           actual_program, actual_kpi, actual_share, actual_time_spent,
           expected_kpi_actual_sched, expected_kpi_ideal, …_diff
```

- PK uuid(`gen_random_uuid()`), FK `on delete cascade`, 방송일 분 단위(120=02:00, 1559=25:59)로 저장해 자정 이후 분리 원천 차단
- RLS: 기존 규칙(20260826160000 전 테이블 enable) 그대로 적용, 접근은 서버(service role) 경유

### D-2. RPC(SQL, 모두 `p_as_of_date` 필수 인자) — STEP 2 구현 확정

SQL은 "방영 1건 = 1원소"까지만 줄여 jsonb 1개로 반환(PostgREST 1000행 제한 회피), 집계·수축·지수는 TS 순수 함수에서 계산(결정론·픽스처 테스트 가능). 골격(Skeleton)도 방영 데이터에서 TS로 산출하므로 별도 RPC 없음.

| RPC | 반환 | 실측(12주) |
|---|---|---|
| `get_ideal_schedule_own_airings(channel, as_of, lookback_days, target_labels[])` | 방영별 시작·종료·프로그램·본/재·타깃별 rating/share/reach/시청시간, 공휴일, 데이터 있는 날짜 | 채널당 1.5~2천 건, 0.3~1.4초 |
| `get_ideal_schedule_competitor_data(names[], as_of, lookback_days)` | 경쟁 프로그램 방영(보유 타깃) + 채널 단위 일별(전 타깃) | 경쟁 5개 8천 건, 1.4초 |

- Fit Score 마트(`mart_*`)는 실행 시 쓰지 않음: skyUHD가 마트에 없고, 백테스트마다 `refresh_fit_score_mart` 재계산은 무겁기 때문. 대신 같은 규칙(84일·02시 경계·4구간 daypart·본/재 분리)을 TS에서 재현

### D-3. API(기존 `/api/scheduling/*` 규칙 준수, 세션 게이트) — STEP 4 구현 확정

| 메서드·경로(`/api/scheduling/ideal-schedule` 기준) | 기능 | 권한 |
|---|---|---|
| `POST /` · `GET /?channel=&saved=1` | 실행 생성(즉시 저장) · 실행 목록 | 관리자·PD |
| `GET /[runId]` · `PATCH /[runId]` | 실행·블록(IDEAL/CURRENT) 조회 · [저장](이름) | 관리자·PD |
| `GET /[runId]/blocks/[blockId]` · `PATCH` | 대체 후보 · Swap(MANUAL_OVERRIDE+LOCK)/LOCK | 관리자·PD(필수 편성은 교체 불가) |
| `GET /[runId]/compare` | CURRENT vs IDEAL 대조 | 관리자·PD |
| `POST /[runId]/recalculate` | 다시 계산(수동 변경 유지/초기화) | 관리자·PD |
| `GET·POST /constraints` · `PATCH·DELETE /constraints/[id]` | 필수 편성 CRUD | 관리자·PD |
| `GET /options?channel=` | KPI·최적화 타깃 목록·경쟁채널·설정 | 관리자·PD |
| `GET·PUT /config` | 설정 조회·저장 | 채널별 PD 가능, 전체 기본값은 관리자 |
| `POST /backtest` · `GET /backtest?id=` | 1주 walk-forward(여러 주는 id로 묶어 순차) · 결과 | 관리자·PD |
| 엑셀 다운로드 | STEP 5(화면 그리드 서식과 함께) | — |

- CURRENT 레이어 = 대상 주 직전부터 거슬러 **7일 데이터가 모두 있고 공휴일 없는 첫 주**(명절 특집 주 제외)를 같은 모델로 평가
- Swap은 저장된 대체 후보로만 교체, 이웃 점수·합계는 [다시 계산] 전까지 갱신 안 됨(`needs_recalc` 표시)

#### (참고) 설계 초안 API

| 메서드·경로 | 기능 |
|---|---|
| `POST /api/scheduling/ideal-schedule` | 실행 생성(채널·주·KPI·경쟁채널·전략·가중치·override 유지 여부) |
| `GET /api/scheduling/ideal-schedule/[runId]` | 실행·블록·요약·충돌 조회 |
| `GET …/[runId]/candidates?weekday&start` | 슬롯 대체 후보 1~N위 |
| `PATCH …/[runId]/blocks/[blockId]` | Swap(→ MANUAL_OVERRIDE), Lock/Unlock |
| `GET …/[runId]/compare` | CURRENT vs IDEAL 슬롯 대조 |
| `GET …/[runId]/export` | 엑셀 |
| `GET/POST/PATCH/DELETE /api/scheduling/ideal-schedule/constraints` | 필수 편성 CRUD |
| `POST /api/scheduling/ideal-schedule/backtest` | 1주 단위 백테스트(여러 주는 클라이언트가 순차 호출) |
| `GET/PUT /api/scheduling/ideal-schedule/config` | 설정 조회·저장 |

---

## E. 12주 Feature · Expected KPI 설계

### E-1. 공통 규칙

- 창: `as_of − 83일 ~ as_of`(84일). `as_of` = 대상 주 월요일 전날
- 명절·공휴일(`public_holidays`) 기본 제외(설정). 12주 창에 추석(9/24~27) 포함 → 특집 편성 왜곡 방지
- 0은 평균에 포함, NULL은 제외하고 `valid_measurement_count`에서 분리 집계
- 본방·재방 분리 키: `programs.first_run`(본/재/미표기). 슬롯 적합도는 재방 제외, 프로그램 전체 성과는 본+재 합산(기존 Fit Score 규칙과 동일)
- 시간 단위: 방송일 분(120~1559). 시 버킷은 `start<02시 → +24`(기존 `mart_slot_score`와 동일)

### E-2. Feature 목록

| 그룹 | Feature | 정의 |
|---|---|---|
| 기본 | avg_rating_12w, avg_share_12w, avg_view_time_12w | 12주 평균(KPI 타깃) |
| 기본 | target_age_rating/share | 채널 핵심 연령 타깃 평균(`targets` 행) |
| 기본 | sample_count, valid_measurement_count | 방송일 수 / NULL 제외 수 |
| 적합도 | weekday_fit, daypart_fit, slot_fit, weekday_slot_fit | 해당 조건 평균 ÷ 같은 조건 채널 baseline(정규화 지수) |
| 최근성 | recent_4w, recent_8w, trend_index | 4주 평균 ÷ 12주 평균 |
| 안정성 | volatility, stability_index | 변동계수(CV), 1 − min(CV,1) |
| 반복 | daily/weekly/same_slot_repeat_count | 12주 평균 주당·일당 편성 횟수 |
| 콘텐츠 | genre_fit, runtime_fit, target_fit | 장르×슬롯 지수, 슬롯 길이 대비 실제 runtime 차이, 타깃 구성비 지수 |
| 조합 | lead_in/out_association, lead_in/out_synergy_index | 관측 인접 쌍(A→B)의 B 지수 ÷ B 단독 지수. "효과" 아닌 **관측 연관**으로 표기 |

### E-3. Expected KPI(과거 성과 기반 기대값, 예측모델 아님)

- `expected_kpi_type = 'HISTORICAL_EXPECTED'` 고정. UI 표기 "최근 12주 데이터 기반 기대 시청률"
- 계층(구체 → 일반): ① 프로그램+요일+시 ② 프로그램+시 ③ 프로그램 전체 ④ 장르+요일+시 ⑤ 장르+시 ⑥ 채널 요일슬롯 baseline
- 계산: ⑥에서 시작해 ⑤→①로 올라가며 표본 수 기반 수축
  - `est_L = (n_L · m_L + k · est_{L+1}) / (n_L + k)`
  - `m_L` = 최근 가중 평균(최근 4주 가중치 `w_recent`, 나머지 1)
  - `k`, `w_recent`, `min_n` 전부 config(임의 상수 하드코딩 금지)
- `fallback_level` = 표본 `n ≥ min_n`을 만족한 가장 구체적 단계
- `confidence_score = min(1, n_eff / n_full) × stability_index` (정의·임계값 config)
- 동일 계층으로 expected_share, expected_time_spent 산출(자사 데이터에만 존재)

### E-4. 정규화

- 채널 간 raw rating 직접 비교 금지. 모든 비교 점수는 **Normalized Performance Index = 성과 ÷ 해당 채널 요일슬롯 baseline**
- baseline은 `mart_slot_score`(as_of 기준) 우선 재사용, 결측 슬롯만 RPC로 보충

---

## F. Hard / Soft Constraint

### F-1. Hard(위반 불가)

| 순위 | 제약 | 원천 |
|---|---|---|
| 1 | 사용자 LOCK | `ideal_schedule_constraints.locked` / 블록 Lock |
| 2 | 주요 콘텐츠 자동 연동 | `featured_content`(요일·시각·active 기간) |
| 3 | 금주 필수 편성 | constraints(WEEKLY_INPUT) |
| 4 | 기존 고정 편성 규칙 | constraints(FIXED_SLOT) |
| — | 방송일 02:00~25:59 연속, 블록 겹침 금지 | 엔진 |
| — | daily_repeat_cap, weekly_repeat_cap | config(고정 콘텐츠는 제외) |
| — | active_from/active_to 밖이면 제약 비활성 | 대상 주 날짜 기준 |

- `featured_content`엔 duration이 없음 → 12주 실측 median runtime 사용, 실측 없으면 사용자 입력 요구(추정 금지)
- **같은 순위끼리 시간 겹침 → 삭제·덮어쓰기 없이 Conflict List 생성**, run.status=CONFLICT, 해당 구간 AI 배치 보류
- Conflict 필드: weekday, start/end, program A/B, source A/B, priority A/B

### F-2. Soft(목적함수 패널티·보너스)

| 구분 | 항목 |
|---|---|
| 최대화 | KPI 지수, 타깃 적합도, 요일×슬롯 적합도, 추세, 안정성, lead-in/out 연관, 장르 다양성, 편성 연속성 |
| 최소화 | consecutive_repeat_penalty, same_slot_repeat_penalty, 장르 편중, 저신뢰 후보, runtime 불일치 |

---

## G. Global Weekly Optimization(TypeScript, 결정론적)

OR-Tools·Python 불가, WASM 솔버(HiGHS 등)는 Vercel 번들·콜드스타트 위험 → **순수 TS 구성+국소탐색**을 1차안으로 권장. 문제 규모(주 140±40 슬롯 × 슬롯당 후보 30 내외)에서 수십 ms 수준.

### G-0. 편성 시간 구조 2개 버전(2026-09-30 사용자 결정)

실행 파라미터 `structure_mode`로 선택, 같은 조건에서 두 버전을 모두 생성해 나란히 비교 가능.

| 버전 | `structure_mode` | 시간 틀 | 알고리즘 |
|---|---|---|---|
| 기존 틀 유지 | `KEEP_CURRENT` | 최근 4주 대표 골격(시작·종료 시각) 고정 | 슬롯 배정(아래 1~5) |
| AI 시간 최적화 | `AI_OPTIMIZED` | 시작 시각·블록 길이까지 재구성 | 요일별 시간축 DP + 주간 국소탐색(아래 G-2) |

- 두 버전 공통: Hard 제약(LOCK·주요 콘텐츠·금주 필수·고정) 동일 적용, 같은 Feature·Expected KPI·목적함수 사용 → 점수 직접 비교 가능
- 두 버전 모두 블록 길이는 **프로그램 실측 runtime**(12주 median) 사용, 임의 길이 생성 금지

### G-1. 기존 틀 유지(`KEEP_CURRENT`)

1. **골격(Skeleton)**: 최근 4주(공휴일 제외) 요일별 대표 시작·종료 시각 → 슬롯 목록
2. **Hard 배치**: 순위 1→4 순으로 고정 블록 배치, 골격과 어긋나면 골격을 고정 블록 경계로 분할·재조정
3. **후보 생성**: 슬롯별 자사 후보(runtime 허용오차 내) + 선택 시 Benchmark/Archetype
4. **구성**: 슬롯을 (baseline 가치 내림차순, 요일, 시각) 고정 순서로 순회하며 한계 목적함수 최대 후보 배치(반복 cap 검사)
5. **개선**: 고정 순서 국소탐색(단일 교체, 두 슬롯 맞교환), 목적함수 **엄격 개선 시에만** 채택, 개선 없을 때 또는 `max_iter`에서 종료

### G-2. AI 시간 최적화(`AI_OPTIMIZED`)

1. 시간축을 `grid_minutes`(기본 5분) 단위로 이산화, 방송일 02:00~26:00
2. Hard 블록을 먼저 고정, 남은 빈 구간마다 **DP**: `best[t] = max(best[t − runtime_p] + value(p, t − runtime_p))`
   - value = 해당 시작 시각의 fitness × 분 가중치(시간대별 baseline이 반영된 Expected KPI 기반)
   - 빈 구간을 runtime 조합으로 정확히 채울 수 없으면 `max_gap_min`(기본 10분) 이내 여백 허용, 여백은 "편성 여백"으로 표시하고 KPI 없음
3. 요일 간 결합(주간 반복 cap·연속 편성)은 요일 고정 순서로 DP 순차 실행 → 주간 국소탐색으로 보정
4. 기존 틀과 비교해 달라진 시작 시각은 블록에 `time_changed` 표시

### G-3. 점수(공통)

```
fitness = Σ w_i · component_i                     (w: config, 기본 35/20/20/10/5/10)
objective = Σ_slots (fitness × slot_minutes_weight)
          + λ_div·장르다양성 − λ_rep·반복패널티 − λ_conf·저신뢰 − λ_rt·runtime불일치
```

- 결정론: 난수 없음, 동률은 `(score desc, program_id asc)`, `input_fingerprint`(입력 데이터·config 해시) 저장 → 같은 입력 = 같은 결과를 테스트로 보장
- 반복 규칙: daily/weekly cap은 Hard, consecutive/same_slot은 Soft 패널티, locked·fixed에는 미적용
- Manual Override: 재생성 시 "유지"면 Hard(LOCK 순위)로 편입, "초기화"면 삭제

### G-4. STEP 3 구현에서 확정한 편성 현실성 규칙(실데이터 점검 결과)

| 규칙 | 내용 | 계기 |
|---|---|---|
| 반복 판정 단위 = 프로그램 | 일·주 cap, 연속 편성, 같은 시 반복은 본방·재방을 합친 프로그램 단위 | 본/재 단위로 따로 세서 같은 프로그램이 하루 5회 배치됨 |
| 본방 후보 조건 | 본방 단위는 기준일 전 7일 안에 본방이 있었던 "방영 중" 시리즈만, 주간 관측 최대 방영 수 이내 | 종영 드라마가 본방 성적으로 월 21시에 배치됨 |
| 표본 부족 후보 | 유효 표본 < min_n이면 AI 신규 배치 제외(기존 틀 모드의 현 편성 프로그램·필수 편성은 예외) | 1~2회 특집이 반복 배치됨 |
| 신뢰도 | 프로그램 자체 표본(1~3단계)만 반영, 장르·채널 폴백은 신뢰도 0 | 장르 표본으로 신뢰도 1.0이 나옴 |
| 주요 콘텐츠 길이 | 길이 미입력 시 실측 runtime 중앙값, 기존 틀 모드에서는 그 프로그램이 차지하던 골격 슬롯 끝까지 | 중앙값이 슬롯보다 짧아 뒤에 몇 분짜리 조각 슬롯 생성 |
| 이름 매칭 | 프로그램 id → 이름 정규화 일치 → 포함 관계가 정확히 1개일 때만 | 주요 콘텐츠 "케이팝업차트쇼" ↔ 닐슨 "ENA케이팝업차트쇼" |
| AI 모드 여백 | 연속 여백 합계도 max_gap_min 이내 | 여백 전이가 이어져 15~20분 여백 발생 |
| 경쟁 Benchmark 배치 | 기본 SUGGEST_ONLY(대체 후보·제안만), MIX에서만 AI 편성 분의 benchmark_max_share(초기 20%) 이내 배치. 지수도 표본 수 수축 | 수축·제한 없이 경쟁시키면 AI 배치 128개 중 118개가 경쟁 프로그램 |

### G-6. 경쟁사 콘텐츠 기본값 = 사용하지 않음(2026-09-30 사용자 지시)

- "기본값은 선택한 채널 안의 편성 프로그램으로만 이상적 편성표를 도출. 처음부터 경쟁사 컨텐츠를 섞으면 절대 안 됨"
- `benchmark_placement`: **NONE(기본)** = 경쟁 프로그램·장르 원형을 후보·대체 후보·요약 어디에도 넣지 않음 / SUGGEST_ONLY = 대체 후보로만 제안(자사 후보 뒤) / MIX = 편성 분 일부 배치
- 경쟁채널을 선택해도 기본값에서는 강세 슬롯 분석(MATCH/COUNTER 라벨)에만 쓰고 후보는 자사 프로그램뿐

### G-7. 부제(에피소드) 반영 옵션(2026-09-30 사용자 지시)

- 실행 파라미터 `episodeMode`: `PROGRAM`(부제 미반영, 기본) / `EPISODE`(부제 반영)
- 대상 시리즈는 설정 `structure.episodic_programs`(초기값 OLIFE: 걸어서세계속으로·세계테마기행)
- 부제 반영 시: 같은 시리즈가 하루 여러 번 나와도 에피소드가 다르면 반복이 아님 → 프로그램 한도는 최근 12주 **관측 최대 방영 수**(하루·주간). 에피소드 규칙(사용자 최종 지시): **같은 에피소드는 어느 24시간 구간에서도 최대 3회**, **주중(월~금)·주말(토·일)은 서로 다른 에피소드**, **같은 구간 안에서는 다른 날 재편성 가능**, 휴지 기간 없음(`episode_cycle_max`·`episode_cycle_hours`·`episode_periods`·`episode_repeat_within_period`)
- 블록별 에피소드 배정: 가치 큰 블록부터, 에피소드 지수(Σ시청률÷Σ슬롯 baseline)의 프로그램 대비 상대값을 표본 수만큼 수축해 높은 순, 동률은 오래 쉰 에피소드. 배정 불가 시 사유 기록
- 에피소드 원천은 최근 12주 방영 기록의 부제(OLIFE EPG로 채워진 `ratings.episode_subtitle`). `olife_episode_catalog`(미방영 에피소드 재고) 연동은 추후
- 실측(OLIFE 10/05 주, 최종 규칙): 기존 틀 유지 37블록·AI 시간 최적화 56블록 전부 배정, 24시간 최대 3회·주중/주말 겹침 0 확인. 재편성 허용으로 성적 좋은 에피소드에 집중돼 주간 에피소드 종류는 6~8종(한 에피소드가 주중 5일 모두 편성되기도 함)

### G-5. 자사 최적화 타깃 선택(2026-09-30 사용자 지시)

- 실행 파라미터 `optimizeTargetLabel`: 채널 KPI 대신 원하는 타깃 기준 편성안(예: ENA Play 수도권 2039·수도권 여20대, ONCE 전국 5064·전국 남50대)
- 선택 목록은 `get_ideal_schedule_target_labels`가 돌려주는, 그 채널에 실제 프로그램 단위 데이터가 있는 라벨만
- **여러 연령대를 합친 타깃(예: 여성 2039)은 만들지 않음** — 연령대별 모집단 크기 없이 정확히 합산할 수 없음. 여20대·여30대를 각각 선택
- 타깃을 바꾸면 Feature·baseline·기대값 전부 그 타깃 값으로 계산, 채널 KPI 기준 구성비(Target Audience) 항목은 제외 후 재정규화
- 경쟁사 비교 타깃은 H-1b 규칙 그대로(선택 타깃이 2049/가구가 아니면 자사 KPI 불일치로 표시·감점)
- skyUHD는 가구 단일 값뿐이라 타깃 선택 없음

---

## H. 경쟁사 Benchmark · MATCH / COUNTER

### H-1. 데이터 제약(실측)

| 항목 | 현황(2026-07-06~09-27 실측) |
|---|---|
| 프로그램 단위(`competitor_program_ratings`) | 경쟁채널마다 **타깃 1개만** 존재. 2049 채널 28개(tvN·SBS Plus·JTBC·Mnet 등), 가구 채널 9개(CNTV·D-ONE·EDGETV 등), UHD 2개는 타깃 없음 |
| 채널 단위(`competitor_ratings`) | 모든 경쟁채널에 **2049·가구 둘 다** 존재(+ 여자3049·개인5064 등) |
| 지표 | 프로그램 단위는 rating·share만. 시청시간·연령 세부 없음 |
| 장르 | **없음** |

- 요청 예시(tvN·SBS Plus·JTBC·Mnet)는 모두 데이터 존재
- 타깃 표기: 경쟁 `개인2049` ↔ 자사 `수도권 개인2049`, 경쟁 `유료방송가구` ↔ 자사 `유료방송가입가구`는 `targetResolution.ts` 동의어 규칙으로 대응
- 경쟁사 raw rating은 자사와 비교하지 않고 **경쟁채널 자기 기준으로만 정규화**

### H-1b. 경쟁사 비교 타깃 선택 규칙(2026-09-30 사용자 결정)

| 경쟁사 보유 타깃 | 사용 기준 |
|---|---|
| 2049만 | 2049 |
| 가구만 | 가구 |
| 둘 다 | 둘 다 계산해 두고, **기준 자사 채널 KPI와 같은 타깃을 기본값**으로 사용. 사용자가 화면에서 다른 쪽으로 전환 가능 |

- 데이터 수준별 적용
  - 슬롯·프로그램 지표(`competitor_slot_strength`, `benchmark_index`): 프로그램 단위라 현재는 항상 "한쪽만" → 보유 타깃 사용
  - 채널 baseline·채널 강도: 채널 단위라 "둘 다" → 자사 KPI 일치 타깃 기본, 전환 가능
- 자사 KPI와 타깃이 다른 경쟁사(예: ENA 기준에 CNTV 가구 데이터) 포함 가능. 블록·후보에 `competitor_target_label`, `target_match`(일치/불일치) 저장, 불일치는 배지 표시 + confidence 감점(감점폭 config)
- 이후 Nielsen 원본에 프로그램 단위 2번째 타깃이 추가되면 같은 규칙이 자동 적용되도록 타깃을 하드코딩하지 않음
- 실행 파라미터: `competitor_target_mode` = `AUTO_MATCH_KPI`(기본) | `2049` | `HOUSEHOLD`, 경쟁사별 실제 사용 타깃은 `runs.summary`에 기록

### H-2. 지표

- `competitor_slot_strength(c, 요일, 시)` = 경쟁채널 요일슬롯 평균 ÷ 경쟁채널 전체 평균
- `benchmark_index(프로그램)` = 경쟁 프로그램 평균 ÷ 해당 경쟁채널 요일슬롯 baseline
- 복수 경쟁사: 슬롯별 최대값을 대표 강도로, 그 채널의 지배 장르(편성 분 기준)를 기록
- 강세 슬롯: strength ≥ `strong_threshold`(config)

### H-3. 전략

| 모드 | 규칙 |
|---|---|
| MATCH | 강세 슬롯에서 경쟁 지배 장르와 같은 장르의 자사 후보 중 fitness 최고 |
| COUNTER | 강세 슬롯에서 다른 장르의 자사 후보 중 해당 슬롯·타깃 지수 최고 |
| NEUTRAL | 강세 아님 또는 장르 미분류 |
| AUTO | 슬롯별 MATCH·COUNTER 최고 후보 중 fitness 높은 쪽 |
| MIX | `match_weight`·`counter_weight`(config) 가중 합산 |

- 모든 블록에 strategy_type, competitor_slot_strength, benchmark_index, match_score, counter_score 저장

### H-4. Benchmark 후보의 기대값(가정 명시)

- 경쟁 프로그램을 자사 채널에 편성했을 때의 시청률은 **관측 불가**
- 제안: `expected_kpi = 자사 슬롯 baseline × benchmark_index`, `expected_kpi_type = 'BENCHMARK_TRANSFER'`(지수 전이 가정), confidence 상한 config로 제한
- 기본값: Benchmark 블록은 CURRENT vs IDEAL KPI 합계에서 **제외**(토글로만 포함)
- UI: OWN / COMPETITOR BENCHMARK(가상) / ARCHETYPE 3종 배지 구분

---

## I. Backtest · 미래 데이터 차단

| 규칙 | 구현 |
|---|---|
| 기준일 | 대상 주 W → `as_of = W월요일 − 1일` |
| 데이터 필터 | 모든 RPC가 `broadcast_date ≤ as_of`를 **SQL에서 강제**(앱 필터 의존 금지) |
| baseline·정규화·추세·confidence·경쟁 benchmark | 전부 같은 as_of RPC에서 산출 |
| 제약 | featured_content·constraints는 W 날짜 기준 active 판정(사전 편성 정보라 허용) |
| 캐시 | `mart_slot_score` 등은 as_of별 행 → 해당 as_of 행만 사용, 없으면 `refresh_fit_score_mart(as_of, channel)` 호출 |

**현재 코드의 누수 위험(수정 필요)**

- `getChannelAnnualAvgRating`: "오늘" 기준 연초~오늘 → Ideal 엔진에서 사용 금지, as_of 인자 버전 사용
- `mart_program_target_score` Affinity: `channel_affinity_snapshot` "최근 14일 최신값" 조회 → as_of 상한 적용 여부 STEP 2에서 확인
- `program_genre_map`: 시점 없는 메타데이터 → 누수 아님으로 간주하되 문서화

**측정 지표(정직한 해석)**

| 지표 | 의미 |
|---|---|
| 모델 보정도: 실제 편성의 expected vs 실제 실측(MAE, 편향) | **검증 가능한 유일한 정확도 지표** |
| 추정 개선폭: ideal expected − 실제 편성 expected | 같은 모델 기준 비교, 실현값 아님 |
| actual vs ideal expected 차이(시청률·타깃·점유율·시청시간) | 요청 항목. "Ideal의 실측은 관측 불가" 주석 필수 |

- 여러 주 walk-forward: 주 단위 요청을 순차 실행(서버리스 타임아웃 회피), 결과 DB 저장

---

## J. UI 컴포넌트

| 구분 | 컴포넌트 | 비고 |
|---|---|---|
| 재사용(추출) | `src/lib/scheduleGridLayout.ts` | 축 상수·색 함수·주차 라벨. 기존 Grid는 import만 교체 |
| 재사용 | `ChannelLogo`, 경쟁채널 선택 목록(`/api/schedule-grid/weeks` 패턴) | — |
| 신규 | `src/app/ideal-schedule/page.tsx` | 한 페이지 스크롤(탭 분할 없음) |
| 신규 | `IdealScheduleControls` | 채널·주·KPI·경쟁채널(복수)·전략·가중치·반복 cap, 버튼 5종 |
| 신규 | `IdealScheduleSummary` | 필수 편성 / AI 추천 / Benchmark 후보 / 충돌 / 평균 Confidence |
| 신규 | `IdealWeekGrid` | 월~일 × 02~25, 실제 duration 높이. 자사=브랜드색 그라데이션, Benchmark=배지·점선 테두리(적·청 색상 의미 미사용), 상태 배지 AI / CURRENT / REQUIRED(자물쇠+굵은 테두리) / MANUAL OVERRIDE, 저신뢰 표시 |
| 신규 | `IdealBlockDrawer` | 상세 지표·선정 이유·대체 후보 1~N위·Swap |
| 신규 | `IdealCompareView` | CURRENT vs IDEAL 슬롯 대조, 차이·변경 이유 |
| 신규 | `WeeklyRequiredScheduleEditor` | 금주 필수 편성 CRUD |
| 신규 | `IdealBacktestPanel` | 주별 결과표 |

| 신규(관리자) | 장르 분류 편집 | `program_genre_map` 미분류 목록을 편성 분 많은 순으로 보여주고 MANUAL로 저장 |
| 변경(최소) | Page 1·Page 2 진입 버튼 | 기존 "채널로 가기" 버튼 옆에 "이상적 편성" 버튼 1개씩 추가(2026-09-30 사용자 지시). 페이지 자체는 독립 경로 `/ideal-schedule` |

- 블록 텍스트가 길어 잘리면 임의 축약하지 않음(기존 편성표 규칙)
- 화면 문구 경어체, 수치는 전부 API 값 그대로

---

## K. Migration 목록(승인 후 실행)

| # | 파일 | 내용 | 상태 |
|---|---|---|---|
| 1 | `20260930020000_ideal_schedule_config_constraints_genre.sql` | config(기본행)·필수 편성·장르 매핑 테이블 + RLS | **적용 완료** |
| 2 | `20260930020100_ideal_schedule_feature_rpcs.sql` | Feature RPC 2종(as_of 강제) + `competitor_program_ratings(competitor_name, broadcast_date)` 인덱스 | **적용 완료** |
| 3 | `20260930020200_ideal_schedule_config_target_composition.sql` | Target Audience 구성비 정의, 장르 source `NONE`(미분류) 허용 | **적용 완료** |
| 3b | `20260930030000_ideal_schedule_group_b_core_household.sql` | Group B 핵심 타깃 = 전국 가구(구성비 항목 제거) | **적용 완료** |
| 3c | `20260930040000_ideal_schedule_benchmark_placement.sql` | Benchmark 배치 방식(SUGGEST_ONLY/MIX)·최대 비율 | **적용 완료** |
| 3d | `20260930050000_ideal_schedule_target_labels.sql` | 최적화 타깃 선택 목록 RPC | **적용 완료** |
| 4 | `20260930060000_ideal_schedule_runs_backtest.sql` | 실행·블록(IDEAL/CURRENT)·대체 후보·백테스트 2종 | **적용 완료** |
| 5 | `20260930070000_ideal_schedule_runs_saved.sql` | [저장] 이름·저장 시각 | **적용 완료** |
| 6 | `20260930080000_ideal_schedule_own_only_default.sql` | Benchmark 기본값 NONE(자사 프로그램만) | **적용 완료** |
| 7 | `20260930090000_ideal_schedule_episode_mode.sql` | 방영 입력에 회차·부제, 에피소드 시리즈 설정, 실행·블록 부제 저장 | **적용 완료** |
| 8 | `20260930100000_ideal_schedule_episode_24h_rule.sql` | 같은 에피소드 24시간 내 최대 3회(주 1회 제한 제거) | **적용 완료** |
| 9 | `20260930110000_…_rest_off.sql`, `20260930120000_…_weekday_weekend.sql` | 휴지 제거, 주중·주말 에피소드 분리·구간 내 재편성 | **적용 완료** |

- `ratings` 인덱스 추가는 보류: 기존 `(channel_id, broadcast_date)`로 채널당 1.4초 이내라 필요 없음

- 기존 테이블 변경 없음(`featured_content` 컬럼 추가도 하지 않음)

---

## L. 단계별 구현 계획

| 단계 | 산출물 | 회귀 확인 |
|---|---|---|
| STEP 1 | 본 문서 | — |
| STEP 2 **(완료)** | Migration 3건, Feature RPC 2종, `src/lib/idealSchedule/*`(time·mapping·features·competitorFeatures·competitorTarget·genreRules·config), 장르 시드 2,890건, `npm run test:ideal` 41건 | `npm run smoke` 15/15, 7채널 실데이터 미래 데이터 차단 검증 |
| STEP 3 **(완료)** | constraints·skeleton·scoring·optimizer(KEEP_CURRENT·AI_OPTIMIZED)·engine·engineRunner·constraintStore, 타깃 선택 | `npm run test:ideal` 84건(설계 23종 포함), 7채널×2모드 실데이터 실행 0.8~7초, 결정론 확인 |
| STEP 4 **(완료)** | runStore·backtest·apiUtil, API 10종(`/api/scheduling/ideal-schedule/**`), CURRENT 레이어 | 개발 서버 실HTTP 검증(생성·조회·대체 후보·Swap·LOCK·비교·재계산 유지/초기화·저장·필수 편성 CRUD·설정 권한·백테스트·401/400/409), 테스트 86건 |
| STEP 5 | `/ideal-schedule` UI, Grid 레이아웃 추출, Swap·비교·엑셀 | 브라우저 검증, 기존 주간 비교 화면 스크린샷 동일성 |

**테스트 설계**: 프레임워크 추가 없이 `scripts/test-ideal-schedule.ts`(tsx, 픽스처 기반 순수 함수 테스트) + `smoke-rpc.mts`에 RPC 항목 추가.

| 범주 | 케이스 |
|---|---|
| 제약 | 고정 충돌(1), LOCK 보존(2), 금주 필수(3), active 기간(4), 중복 고정(21), Manual Override 유지(20) |
| 시간 | 자정 넘김(5), 02~25 방송일(6), runtime 불일치(22) |
| 데이터 | rating 0(7), NULL(8), 연령 KPI 결측(9), 표본 없음(10), 표본 부족 폴백(11), 후보 0(23) |
| 반복 | 일 cap(12), 주 cap(13), 연속 패널티(14) |
| 경쟁 | 복수 경쟁사(15), MATCH(16), COUNTER(17) |
| 결정론·누수 | 동일 입력 동일 결과(18), 미래 데이터 차단(19: as_of 이후 행 주입 시 결과 불변) |

---

## M. 위험요소 · 선결 과제

| # | 위험 | 대응 |
|---|---|---|
| 1 | **장르 데이터 없음**(자사·경쟁 모두) → MATCH/COUNTER·genre_fit 불가 | `program_genre_map` 신설, 규칙 시드 + 관리자 수기 보완. 미분류는 NEUTRAL. **STEP 2 실측: 규칙 분류 후 자사 편성 분 기준 커버리지 ENA 53%·ENA Drama 37%·ENA Play 32%·ENA Story 38%·OLIFE 69%·ONCE 3%·skyUHD 49%, 경쟁 프로그램 2,055/2,614건 미분류** → 관리자 보완 전까지 MATCH/COUNTER 대부분 NEUTRAL |
| 1b | 신뢰도(confidence)가 전반적으로 낮게 나옴(프로그램 단위 중앙값 0~0.16) | 표본 충족도(같은 슬롯 12주 기준) × 안정성의 정직한 결과. STEP 4 백테스트 보정도로 `full_confidence_n` 등 설정값 재검토 |
| 1c | 백테스트(ENA 3주·OLIFE 2주): 주간 평균 기대값 편향 ±1~2%p 내외, 방영별 MAE는 평균 시청률의 35~50% | 주간 합계 수준에서는 쓸 만하나 개별 슬롯 기대값은 잡음이 큼 → 화면에 신뢰도·"기대값" 표기 필수 |
| 1d | 기본 일 반복 cap 3이 실제 편성 관행과 다름(OLIFE 현재 편성은 같은 프로그램 하루 6~8회) | 목적함수상 이상적 편성이 높게 나오는 주요 원인이 반복 패널티 — 채널별 cap을 설정 화면에서 조정하도록 안내 |
| 2 | 경쟁 프로그램 데이터는 타깃 1개·시청시간 없음 | H-1b 타깃 선택 규칙, 자기 기준 정규화만 사용, 타깃 불일치 시 감점·배지, Benchmark 기대값은 가정 명시·저신뢰 |
| 3 | Benchmark 기대값은 관측 불가 | BENCHMARK_TRANSFER 표기, KPI 합계 기본 제외 |
| 4 | 12주 창에 추석 특집 포함 | 공휴일 제외 기본값 |
| 5 | 기존 헬퍼의 "오늘 기준" 계산 → 백테스트 누수 | as_of 인자 버전 사용, affinity snapshot 상한 확인 |
| 6 | Python 없음, OR-Tools 불가 | TS 결정론 엔진(G). 필요 시 이후 WASM 솔버 교체 가능한 인터페이스 |
| 7 | Vercel 실행 시간 | 집계는 SQL, 엔진 in-memory, route `maxDuration` 지정, 백테스트는 주 단위 분할 |
| 8 | skyUHD: 별도 source_type·타깃 없음·12주 1,981행 | 포함 확정. 전용 분기·폴백 처리(확정 사항 참고) |
| 9 | ENA Story 1~2월 프로그램 단위 결측 | 12주 창(7월~)은 영향 없음, 창 확장 시 주의 |
| 10 | `featured_content`에 duration 없음 | 실측 median, 없으면 입력 요구 |
| 11 | 테스트 인프라 부재 | tsx 스크립트 테스트 + smoke 확장 |
| 12 | PRD 비범위("편성 확정 반영 금지") | 추천 전용, 외부 편성 시스템 연동 없음 |

### 확정 사항(2026-09-30 사용자 결정)

| # | 항목 | 결정 | 설계 반영 |
|---|---|---|---|
| 1 | 편성 시간 구조 | **2개 버전**: 기존 틀 유지 + AI 시간 최적화(추가 지시) | G-0~G-2, `structure_mode` 파라미터, 두 버전 나란히 비교 |
| 2 | 장르 분류 | 규칙 1차 분류 → 관리자 보완 | `program_genre_map.source` = RULE / FEATURED_CATEGORY / MANUAL, MANUAL 우선. 관리자 화면에 "장르 분류" 편집 섹션 추가 |
| 3 | Benchmark 기대값 | 가정 명시 후 산출 | `BENCHMARK_TRANSFER` 산출, 블록·툴팁에 "지수 전이 가정" 문구, 신뢰도 상한 적용, KPI 합계는 기본 제외(토글) |
| 4 | 권한 | PD 포함 | 필수 편성 CRUD·Swap·Lock·저장·실행: admin·pd 세션 모두 허용. 모든 쓰기에 `created_by`/`updated_by`(adminId 또는 pdId) 기록. 전체 기본 설정(`ideal_schedule_config` 기본행) 변경만 관리자 전용 |
| 5 | 대상 채널 | skyUHD 포함(7채널) | 아래 skyUHD 처리 규칙 적용 |
| 6 | Group B 핵심 타깃 | 전국 가구(별도 연령대 아님) | 구성비 항목 제외(20260930030000) |
| 7 | 자사 최적화 타깃 | 채널별로 원하는 타깃 선택 가능(데이터 있는 라벨만) | G-5 |
| 8 | 경쟁사 콘텐츠 기본값 | 자사 채널 프로그램만(경쟁사 콘텐츠는 사용자가 켰을 때만) | G-6 |
| 9 | OLIFE 부제 | 부제 반영/미반영 옵션 | G-7 |

**skyUHD 처리 규칙**

| 항목 | 처리 |
|---|---|
| 데이터 원천 | `ratings.source_type = 'skyuhd'`, `target_id` 비어 있음 → Feature RPC가 source_type·타깃 NULL 분기 처리 |
| baseline | Fit Score 마트(`nielsen_daily`만 집계)에 skyUHD 없음 → 신규 RPC가 직접 계산 |
| 0 값 | 원본 공란 = 실측 0(기존 규칙 유지) |
| 표본 | 12주 1,981행으로 적음 → 상위 계층 폴백 비중 증가, confidence 자연 하락(별도 보정 없음) |
| 경쟁사 | UMAX·UHD Dream TV 프로그램 단위 타깃 없음(62·22행) → 채널 단위만 사용, 프로그램 Benchmark는 표본 부족 시 후보 제외 |
| 표시 | 시청률 소수점 4자리(기존 skyUHD 표기 규칙) |

---

**IMPLEMENTATION READY: YES**
— 다음 단계 STEP 2(Migration 1~3·6~8 작성·적용, Feature RPC, 장르 규칙 시드, 누수 점검). Migration 적용 전 최종 확인 1회.
