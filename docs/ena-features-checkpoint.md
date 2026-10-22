# 신규 기능 2종 — 체크포인트

최종 갱신 2026-10-22 · 설계: `docs/ena-features-plan.md` · 지시문: `KT_ENA_Claude_Code_개발지시문_v2.md`(Downloads)

## 현재 단계
- 단계 A(조사·설계·회귀 기준): 완료(참고 화면 의심 문제 5건은 미조사 — plan §1)
- 단계 B(공통 기준·예측 저장 기반): 기능 1 지표 정의·작품 연결 완료 / 기능 2 순수 기반 완료, 저장 스키마는 **초안(미적용)**
- 단계 C(프로그램 성과 MVP): **완료** — 실데이터 읽기 전용 확인(개발 서버)
- 단계 D(편성 예측·리뷰 MVP): **D-1·D-2·D-3 완료** — D-3 결과(재구성 계획 검증, 17주·111일): 일 단위 예측은 단순 기준(같은 요일·시 최근 4주)과 비슷하거나 약간 못함(모델÷기준 1.01~1.07), 칸 단위는 약 4% 나음(B 등급에서 이득), 신작(C) 칸 비중이 크고 높게 치우침 — `docs/ena-features/D3_PLAN_FORECAST_BACKTEST.md`. D-2 결과: D-2 결과: 실제 방영 편성시간 가중 집계는 공식 채널 하루 값과 상관 1.00이지만 약 6~9% 높음(프로그램 사이 빈 구간), 직전 28일 배율로 환산 시 오차 61~86% 감소(후보, 미적용) — `docs/ena-features/D2_DAILY_ALIGNMENT.md`. 다음 D-3(과거 편성표로 예측 기반 같은 표), 저장·화면은 승인 후
- 단계 E(실제 검증): 미착수 — "실제 미검증"

## 완료 작업과 변경 파일
| 구분 | 파일 |
|---|---|
| 슬롯 비교 공개 함수(기존 결과 불변) | `src/lib/contentFit/engine.ts`(끝에 `computeSlotComparison` 추가), `src/lib/contentFit/index.ts` |
| 프로그램 성과 서버 | `src/lib/programPerformance/{types,metrics,sourceCore,search,source,cacheKey}.ts` |
| API | `src/app/api/program-performance/route.ts`, `src/app/api/program-performance/search/route.ts` |
| 화면 | `src/app/program-performance/{layout,page,ProgramPerformanceView}.tsx`, `src/lib/ui/pageTitles.ts`(제목 1개) |
| 진입점 | `src/components/workspace/GlobalNav.tsx`(보조 링크), `src/components/ScheduleWeekGrid.tsx`(근거 패널 링크), `src/lib/workspace/nav.ts`(호환 목록 1줄) |
| 기능 2 기반 | `src/lib/scheduleForecast/{types,core}.ts` |
| 스키마 초안(미적용) | `docs/ena-features/migration-drafts/20261022010000_schedule_forecast_snapshots.sql` |
| 테스트 | `scripts/test-program-performance.ts`(55), `scripts/test-schedule-forecast.ts`(21), `package.json` 스크립트 2개 |
| D-1 엔진 추출 | `src/lib/idealSchedule/engine.ts` — `prepareModel`(기존 앞부분을 그대로 옮김), `planCandidateResolver`(편성표 칸→후보, 기존 인라인 코드 이동), `evaluatePlanOnly`(신규, 최적화 없음) |
| D-1 연결·검증 | `src/lib/scheduleForecast/fromEngine.ts`, `scripts/test-plan-forecast.ts`(14), `scripts/golden-ideal-engine.ts`(전후 동일성, `npm run golden:ideal-engine`) |
| 기타 | `.impeccable/config.json` — 이 화면 파일에 한해 gray-on-color 오탐 무시(삼항식 두 분기를 한 줄로 읽은 경우) |

## 실행한 검사(2026-10-22, 로컬)
| 명령 | 결과 |
|---|---|
| `npm run test:program-performance` | 55 통과 / 0 실패(합성 픽스처 — 인수 경로 2개 포함) |
| `npm run test:schedule-forecast` | 21 통과 / 0 실패 |
| `npm run test:content-fit` | 62 통과 / 0 실패(기존 엔진 회귀) |
| `npm run test:ideal` · `test:opt06` · `test:avail` · `test:purchase-review` · `test:weak-verdict` | 모두 0 실패 |
| `npm run test:workspace` | 1 실패 — `src/app/ratings/page.tsx`가 호환 목록에 없음(10/19 기존 변경, 이번 작업 아님) |
| `npm run test:ui-polish` | 3 실패 — RatingsViewer 중복 main, Dashboard svg 이름, 가로 스크롤 영역 키보드(Dashboard·ratings·schedule-grid page) — 모두 이번에 손대지 않은 파일 |
| `npm run test:schedcompare` | 1 실패 — 편성 비교 설정 막대 sticky(10/21 모바일 최적화 변경으로 보임, 이번에 손대지 않은 `schedule-grid/page.tsx`) |
| `npx tsc --noEmit` | 통과 |
| `npx eslint`(변경 파일) | 오류 0(`ScheduleWeekGrid.tsx` 274행 기존 오류 1건은 이번 변경 밖) |
| `npm run build` | 통과(`/program-performance` 포함) |
| `npm run check:client-boundary` | 통과 |
| 실데이터(개발 서버, 읽기 전용) | 검색: 오리지널 드라마 6·예능 5. 〈신병4 사보타주〉 6개 채널 비교 표 정상(첫 호출 15초, 컴파일 포함), 〈나는 SOLO〉 2025-01-01~ 전체 8.4초. 데스크톱 1440px·모바일 375px 화면 확인(모바일 가로 넘침 수정) |

## D-1 전후 동일성 확인(2026-10-22)
- 리팩터 전(커밋 33f18cb) 골든 저장 → 리팩터 후 비교: 9개 시나리오(기존 틀·AI 시간·필수/잠금·경쟁 MATCH·경쟁 MIX·편성표 틀·검증 잔차·타깃 선택·시리즈 연결)의 편성 블록·요약·지문·평가 결과가 **바이트 단위로 같음**. 골든 파일(9MB)은 저장소에 넣지 않았다 — 다시 만들려면 33f18cb를 별도 worktree로 꺼내 `npx tsx scripts/golden-ideal-engine.ts <파일>` 후 현재 코드에서 `--compare`.
- 기존 테스트 개수·결과 전후 동일: test:ideal 227, opt01 20, opt02 36, opt03 74(대기 1), opt04 52, opt05 47, opt06 136 — 모두 실패 0. 그 밖에 avail 285, purchase-review 109, content-fit 62, weak-verdict 39, program-performance 55, schedule-forecast 21, plan-forecast 14 실패 0. tsc·변경 파일 eslint·build·client-boundary 통과.
- 예측 전용 경로의 핵심 확인: 같은 편성을 넣으면 편성안 생성 엔진의 실제 편성 평가(CURRENT)와 칸별 후보·기대값이 정확히 같다(같은 모델·평가기). 칸 수·시간 불변(최적화 없음), 이력 없는 칸은 근거 C·안내, 선택 점수(value)는 내보내지 않음, 그날 마지막 칸의 "방송일 끝까지" 가정 분은 집계에서 따로 센다.

## 미완료·다음 명령
1. (완료) D-1.
2. (완료) D-2 — `npx tsx --env-file=.env scripts/d2-daily-alignment.mts 40 <결과 JSON>`(읽기 전용, 결과 파일 커밋 금지). 순수 함수 `src/lib/scheduleForecast/dailyAlignment.ts`, 테스트는 test:schedule-forecast(25).
2-1. (완료) D-3 — `npx tsx --env-file=.env scripts/d3-plan-forecast-backtest.mts <결과 JSON>`(읽기 전용, 약 30초, 결과 파일 커밋 금지). 다음 후보: 편성표↔닐슨 이름 연결 보강(C 칸 줄이기, 저위험), 사전 예측 표본 축적(A2 승인 후).
3. 승인 후: 스키마 적용(`supabase migration new schedule_forecast_snapshots` → 초안 내용 복사 → `supabase db push`), 저장 API·편성 비교 탭.
4. 참고 화면 의심 문제 5건 조사.

## 차단 요인(승인 대기)
- A1 스키마 적용, A2 예측 기록 수집 개시, A3 `program_identity` 정기 갱신, A4 원격 푸시·배포, A5 승격 합격선 — plan §7.
- 원격 푸시·배포는 지시문 v2에 따라 이번에 하지 않았다(로컬 커밋만).

## 재개 시 확인
`git status`·`git log -3`으로 커밋 확인 → 위 표의 테스트 재실행 → 승인 대기 항목은 자동 실행하지 않는다.
