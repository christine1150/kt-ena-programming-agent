# 신규 기능 2종 — 체크포인트

최종 갱신 2026-10-22 · 설계: `docs/ena-features-plan.md` · 지시문: `KT_ENA_Claude_Code_개발지시문_v2.md`(Downloads)

## 현재 단계
- 단계 A(조사·설계·회귀 기준): 완료(참고 화면 의심 문제 5건은 미조사 — plan §1)
- 단계 B(공통 기준·예측 저장 기반): 기능 1 지표 정의·작품 연결 완료 / 기능 2 순수 기반 완료, 저장 스키마는 **초안(미적용)**
- 단계 C(프로그램 성과 MVP): **완료** — 실데이터 읽기 전용 확인(개발 서버)
- 단계 D(편성 예측·리뷰 MVP): 진행 전 — 엔진 평가 전용 경로 추출부터
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

## 미완료·다음 명령
1. 단계 D-1: `src/lib/idealSchedule/engine.ts` 준비 단계 추출 → `evaluatePlanOnly`. 전후 `npm run test:ideal && npm run test:opt01 && npm run test:opt02 && npm run test:opt05 && npm run test:opt06` 동일 확인.
2. 공식 채널 하루 값 vs 실방영 시간가중 집계 일치 점검 스크립트(읽기 전용).
3. 승인 후: 스키마 적용(`supabase migration new schedule_forecast_snapshots` → 초안 내용 복사 → `supabase db push`), 저장 API·편성 비교 탭.
4. 참고 화면 의심 문제 5건 조사.

## 차단 요인(승인 대기)
- A1 스키마 적용, A2 예측 기록 수집 개시, A3 `program_identity` 정기 갱신, A4 원격 푸시·배포, A5 승격 합격선 — plan §7.
- 원격 푸시·배포는 지시문 v2에 따라 이번에 하지 않았다(로컬 커밋만).

## 재개 시 확인
`git status`·`git log -3`으로 커밋 확인 → 위 표의 테스트 재실행 → 승인 대기 항목은 자동 실행하지 않는다.
