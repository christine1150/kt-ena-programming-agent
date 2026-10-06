# 시스템 지도 (단계 00)

작성: 2026-10-06. 읽기 전용 조사 결과. 경로는 저장소 루트 기준. 표기: **[확인]** 파일을 직접 열어 확인 / **[조사]** 조사 에이전트 보고(편성표 뽑기·순위 정의 부분은 본 세션에서 재확인) / **[미확인]**.
환경변수·키 값은 조사하지 않았고 이름만 적는다.

## 1. 기술 스택·운영 구조

- Next.js 16(App Router, webpack 빌드) + React 19 + Supabase(PostgreSQL, 마이그레이션 228개 `supabase/migrations`) + OpenAI 직접 fetch(`gpt-4o-mini` 기본).
- 배포: Vercel. 예약 실행: `vercel.json` 크론 `/api/cron/fetch-nielsen-mail`(23:00 UTC), `.github/workflows/nielsen-mail-check.yml`(KST 07:30~09:30 5분 간격), `.github/workflows/refresh-purchase-recommendations.yml`(월 03:00 KST, 시크릿 설정 대기) [조사].
- 인증: HMAC-SHA256 서명 쿠키 `kt_ena_admin_session`(12시간)·`kt_ena_pd_session`(30일) — `src/lib/session.ts`, `adminAuth.ts`. 로그인 API `/api/admin/login`·`/api/pd/login`(bcryptjs, `login_log` 기록). `/api/*`는 라우트가 직접 세션 확인, `/admin/*`는 관리자만 [조사].
- **주의 [조사, 실행 미확인]**: 루트 `middleware.ts`와 `src/proxy.ts`가 둘 다 추적되고 matcher·리다이렉트 대상이 다르다(`/access-denied` vs `/pd/login`). Next 16에서 middleware→proxy로 개명되어 어느 쪽이 동작하는지 미확인 → FINDINGS 신규 항목(N01).
- 테스트 DB: **로컬 DB 설정 없음**(`supabase/config.toml`·docker 없음) [조사]. 스크립트는 `.env`의 원격 Supabase를 쓰며 운영/분리 여부 미확인. → 단계 01 이전에 "주입 가능한 경계(순수 함수 + fixture)" 방식으로 테스트하고, DB 접근 스크립트는 읽기 전용으로만 쓴다.

## 2. 데이터 흐름(숫자의 출처)

수집 → 저장 → 집계 → 화면

1. **수집**: 수동 업로드 `/api/admin/upload/nielsen` → `ingestAnyNielsenFile`(`nielsenFileDispatch.ts`)이 일간/주간·월간/연간 판별. 메일 자동 수집 `mailIngestionRunner.runNielsenMailIngestion`(Gmail/Naver, 중복 `mail_ingestion_log`). 같은 러너가 OLIFE 편성표·skyUHD도 처리 [조사].
2. **파싱**: 일간 `nielsenDaily.ts`, 주간·월간 `nielsenPeriod.ts`(→ `nielsen_period_rank` upsert), 연간 `nielsenAnnual.ts`, skyUHD `skyUhd.ts`, 적재 `nielsenIngest.ts`(`sanitizeRatingFields`가 비정상 값을 필드 단위 NULL).
3. **저장**: `ratings`(`source_type`·`target_id`·`program_id`; `program_id IS NULL`이 채널 단위), `nielsen_period_rank`, `competitor_ratings`, `competitor_program_ratings`, `targets`, `channels`, `programs`, `target_goals`.
4. **집계**: Supabase RPC(`get_target_achievement`, `get_rating_trend_summary`, `get_channel_period_rank_and_rating`, `get_channel_period_rank_movement` 등)와 마트 테이블(`mart_daily_dashboard_cache`, `mart_llm_text_cache`, `mart_scheduling_fit_score` — 일반 테이블+refresh 함수) [조사]. 캐시: `dailyMartCache.ts`(`cachedOrRpc`, 인자 지문 불일치 시 실시간), `llmTextCache.ts`(입력 md5).
5. **AI**: 공통 `llmSynthesis.ts callOpenAiJsonSynthesis`. 개별 호출 `intent/llmClassifier.ts`, `intent/functionCallEngine.ts`, `originalContentInsight.ts`, `purchaseSim/llmExpand.ts`. 나머지 `*Llm.ts`는 공통 경로·캐시를 경유하는 것으로 보이나 개별 확인 안 함 [조사].
6. **내보내기**: docx/pptx `reportFlatten.ts`·`portfolioFlatten.ts` → `exportRenderers.ts`(`docx`,`pptxgenjs`), 엑셀 `scheduleGridExcel.ts`·`idealSchedule/excel.ts`.

### 단위 규칙 위치 [조사]
- 시청시간: `nielsenDaily.ts timeSpentToSeconds` = `Math.round(raw*86400)`(문자열 H:MM:SS도 처리). 시청시간비율 `parsePercentText` = `raw*100`.
- 시청률·점유율·도달율은 원본 수치 그대로 `rating`/`share`/`reach`(시청률 %단위 유지). 표시 반올림 `ratingRounding.ts`(skyUHD 5자리, 그 외 3자리).

## 3. 화면 → 컴포넌트 → API → 데이터

| 화면 | 컴포넌트 | API | lib / RPC·테이블 | 핵심 숫자 위치 |
|---|---|---|---|---|
| 홈 `/` (`src/app/page.tsx`) | `Dashboard.tsx`(5,451줄) | `/api/dashboard/page1`, `channel-daily-detail`, `/api/reports/chuseok` | `dashboard/page1/route.ts`(2,213줄), `get_target_achievement`, `get_rating_trend_summary`, `get_channel_period_rank_and_rating`, `get_market_ytd_rank`, 마트 | 일 순위 `ratings.rank`; **주간 순위 `nielsen_period_rank`(약 2113~2170행, 일요일 기준일일 때)** |
| 채널 `/channel/[code]` | `ChannelDeepDive.tsx`(8,044줄) | `/api/dashboard/channel`, `scheduling/fit-score`, `program-momentum`, `skyuhd-*`, `llm-synthesize`, `channel/smart-tips` | `dashboard/channel/route.ts`(1,624줄) | 주간 순위 변동 `get_channel_period_rank_movement`(`nielsen_period_rank`, route 1111행) |
| 채널 보고서 `/audience-report/[channel]`(+`/deck`) | `components/audienceReport/*` | `/api/audience-report/[channel]` 및 `deck/docx/pptx` | `reportBuilder.ts`→`dataCollector.ts`, `analyzer.ts`, `validate.ts`, `narrativeLlm.ts` | 기간 평균 순위 = 일별 `rank` 평균(`fetchRankAvg`, `get_channel_period_rank_and_rating`, 소수 1자리) |
| 포트폴리오 `/audience-report/portfolio`(+`/deck`) | `portfolioCharts.tsx`, `pptPreview.tsx` | `/api/audience-report/portfolio` 및 `deck/docx/pptx` | `portfolioBuilder.ts`(265행), `portfolioModel.ts` | 채널별 `buildAudienceReport` 결과 집합. 직접 쓰는 순위 쿼리 미확인 |
| 편성 비교 `/schedule-grid` | `ScheduleWeekGrid.tsx`, `ScheduleUploadSlot.tsx` | `/api/schedule-grid/weeks|data|export|upload` | `scheduleGridSource.ts` | **요일 헤더 "시청률(N위)" 주간 값 = 일별 `ratings.rank`(채널 단위, 채널 `primary_target`)의 7일 평균 반올림**(`getChannelDailyStatsForWeek`·`computeWeeklyAvgStat`) [확인] |
| AI 편성(시청률 자판기) `/ideal-schedule` | `IdealWeekGrid`,`BlockDrawer`,`CompareTable`,`SummaryPanel`,`BacktestPanel`,`RequiredScheduleEditor`,`PlanUploadCard` | `/api/scheduling/ideal-schedule` 및 `options`,`[runId]`(+`compare`,`recalculate`,`blocks/[blockId]`,`manual`,`export`),`config`,`constraints`,`backtest` | `src/lib/idealSchedule/*` (상세 `IDEAL_SCHEDULE_AUDIT.md`), RPC `get_ideal_schedule_own_airings|competitor_data|target_labels` | 기대 시청률 `features.ts`/`scoring.ts`/`engine.ts`, 예상 순위 `rankEstimate.ts`(`nielsen_period_rank`) [확인] |
| 구매 시뮬레이터 `/ideal-schedule/purchase` | 같은 파일(601줄) | `purchase-sim/search|predict|rolling|recommendations` | `src/lib/purchaseSim/*`(`MODEL_VERSION=purchase-v1.1`), RPC `get_purchase_sim_inputs(_multi)`, `get_purchase_sim_competition`, `search_program_identity`, `get_purchase_channel_avg`, 테이블 `purchase_recommendations`, `purchase_sim_calibration` | 예측 `engine.ts predictSlot/withInterval` |
| 관리자 `/admin/*` | `admin/page.tsx`의 업로더·관리 컴포넌트 | `/api/admin/*`(모두 `getAdminSession`) | 업로드 route 11종: channel-master, manual-drama-report, manual-original-report, market-ytd-rank, monthly-reference-trend, nielsen, olife-epg, olife-episode-catalog, schedule-grid, skyuhd(+메일 수집 run/status) | — |
| 로그인 `/admin/login`, `/pd/login` | 각 page | `/api/admin/login`, `/api/pd/login` | 테이블 `admins`,`pd_users`,`login_log` | — |

## 4. 순위 정의가 화면마다 다르다 (F01 관련)

| 화면 | 순위 출처 | 종류 |
|---|---|---|
| 홈 주간 리뷰 | `nielsen_period_rank` weekly | 닐슨 주간 순위(공식 No.) |
| 채널 화면 주간 변동 | `get_channel_period_rank_movement` → `nielsen_period_rank` | 닐슨 주간 순위 |
| 편성 비교 주간 값 | `ratings.rank` 일별 7일 평균 반올림(`scheduleGridSource.ts:504-513`) | **일별 순위의 평균** |
| 채널 보고서 기간 평균 | `get_channel_period_rank_and_rating` | 일별 순위 평균(소수 1자리) |
| 이상적 편성 예상 순위 | `loadWeeklyRanks`+`rankEstimate.ts` | 닐슨 주간 순위 기반 추정 |

타깃 결정: `targetResolution.ts resolveRankSheetTargetLabel`이 `channels.primary_target`을 랭킹 시트 라벨로 변환(수도권 개인2049→"개인2049", National 유료방송가입가구는 유지).
→ F01의 7위(원본 개인2049 주간 순위)와 12위(원본 National 가구 주간 순위, 또는 일별 순위 평균)는 **서로 다른 지표**다. 공용 순위 함수가 없다. 코드상 정의 차이는 확정, 실제 화면값 재현은 DB 접근 없이는 [가설].

## 5. 재사용할 기존 기능 (새로 만들지 않는다)

| 기능 | 위치 |
|---|---|
| 슬롯 근거 패널 | `ideal-schedule/BlockDrawer.tsx`, `model.ts evidenceGrade/reasonText/RANGE_BASIS_LABEL`, skyUHD `components/skyUhd/SkyUhdSlotProgramAnalysis.tsx` |
| 예측 범위·확실도 | `idealSchedule/uncertainty.ts`, 구매 `purchaseSim/engine.ts withInterval` |
| 잠금·필수 편성 | `idealSchedule/constraints.ts`, `constraintStore.ts`, `RequiredScheduleEditor.tsx`, `RunRequest.extraLocks` |
| 가중치 프리셋 | `ideal-schedule/page.tsx WEIGHT_PRESETS` |
| 기간 비교 | `audienceReport/periodPresets.ts COMPARISON_PRESETS`, `computeComparisonRange` |
| 모델 검증 진입점 | `BacktestPanel.tsx` → `/api/scheduling/ideal-schedule/backtest` → `backtest.ts`; 구매는 `scripts/backtest-purchase-sim.ts`(스크립트뿐) |

## 6. 테스트·검증 수단(기준선)

| 명령 | 내용 | 이번 단계 결과 |
|---|---|---|
| `npm run test:ideal` | `scripts/test-ideal-schedule.ts`(706줄) DB 불필요 순수 함수 검증 | **138건 통과, 0건 실패**(2026-10-06 로컬, 약 32초) |
| `npm run test:intent` | 인텐트 라우터(DB 필요) | 미실행(원격 DB 접근) |
| `npm run smoke` | RPC 스모크(원격 DB) | 미실행 |
| `npm run lint` / `npm run build` | 정적 검사·빌드 | 미실행(이번 단계는 코드 변경 없음) |
| `scripts/test-purchase-sim.ts`, `backtest-purchase-sim.ts`, `e2e-purchase-sim.ts`, `verify-against-nielsen-aggregate.mjs`, `calibrate-ideal-backtest.mts` | 구매·집계 검증(DB 필요) | 미실행 |

CI에서 자동으로 도는 테스트는 확인되지 않았다(워크플로 2개는 수집·추천 갱신뿐) [조사].
