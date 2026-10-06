# 검수 발견사항 F01~F19 코드 대조 (단계 00)

기준: `ENA_Agent_개선패키지/02_검수결과.txt` §4(검수일 2026-10-05, 웹/스크린샷 기반)를 2026-10-06 저장소 코드와 대조.
판정 표기: **확정** = 해당 파일을 직접 읽어 코드 동작 확인(본 세션 또는 조사 에이전트 보고를 본 세션에서 재확인) / **정황** = 코드 경로는 있으나 실제 화면값 재현은 못 함(운영 DB 미조회) / **미확인** / **범위 밖**.
"수정 단계"는 `단계별_프롬프트` 번호(01~16)와 `OPT01~06`. 단계 매핑은 주제 기준 제안이다.
운영 DB·배포 화면은 보지 않았다. 스크린샷 관찰과 코드 확인을 섞지 않는다.

## 1. 한눈에 보기

| 구분 | 항목 |
|---|---|
| 코드로 확정된 문제 | F02(이전 값 유지), F04(시작시각 집계), F05(겹침 길이 미사용), F14(약세 1건+"만"), F19(탭 제목·"분 60초"·"(18/6)"), F08의 표시 경로 혼합, 개선율 분모 커버리지 |
| 이미 방어가 있는 부분 | F03 일부(보고서 `factCheckNarrative`, 브리핑 ▲▼% 검사), F07 일부(닐슨 빈 셀 null 유지, skyUHD 미래일 null, 업로드 로그), F10 구간·보정 오차 표시, F11 툴팁 고지, F15 그룹 A/B 분리, F18 기준일 표시·가격/판권 미반영 안내 |
| 코드로 확정 못 함 | F01(7위 vs 12위 실제 원인), F04의 "0.000" 표시 경로, F07 운영 롤백 정책, F16·F17 |
| 신규 설계 | F09 Avail(코드에 개념 없음) |

## 2. 항목별 표

| F | 심각도 | 판정 | 코드 위치 | 현재 구현 / 재현 절차 | 기존 기능 | 수정 단계 |
|---|---|---|---|---|---|---|
| F01 주간 순위 불일치 | P0 | **정황**(정의 차이는 확정) | 홈 `api/dashboard/page1/route.ts:2097-2190`(`nielsen_period_rank` weekly), 편성 비교 `scheduleGridSource.ts:439,504`(`ratings.rank` 일별 7일 평균 반올림), 타깃 `targetResolution.ts:17 resolveRankSheetTargetLabel` | 홈=닐슨 주간 순위, 편성 비교=**일별 순위의 평균**. 파서로 확인한 원본: ENA 주간 개인2049 7위, National 유료가구 12위, 수도권 유료가구 12위(§3). 12위가 "일별 평균"인지 "가구 타깃 혼용"인지는 DB 값이 있어야 판별 | 타깃 변환 공용 함수 | 02 |
| F02 기간 전환 중 이전 값 | P0 | **확정** | `channel/ChannelDeepDive.tsx:4663-4683`(fetch effect), `:4625 comparisonLabel` | 응답 경합은 `cancelled`로 막혀 있으나 `setLoading(true)`에서 `data`를 비우지 않고 제목·라벨은 새 state로 즉시 바뀌어 **새 제목+이전 값**이 보인다. AbortController 없음. 홈 `Dashboard.tsx`는 기간 전환 fetch 없음(마운트 1회). MoM 동일 일수 비교는 `audienceReport/periodPresets.ts computePeriodPreset`에 이미 구현 | MoM 동일 일수 비교 | 02, 07/08 |
| F03 AI 문장이 의미 변경 | P0 | **부분 구현** | 검증 있음 `audienceReport/narrativeLlm.ts:198-239 factCheckNarrative`, `briefingReportLlm.ts:144-170`. 검증 없음 `channelNarrativeLlm.ts`, `competitorNarrativeLlm.ts`, `opportunityNarrativeLlm.ts`, `whyDiagnosisLlm.ts`, `fitScoreInterpretationLlm.ts`, `askAnswerLlm.ts` | 공통 지침 `llmSynthesis.ts:68`, 화살표는 코드가 확정(`channelNarrativeLlm.ts:27`). 그러나 6개 모듈은 후처리 없음, `factCheckNarrative`도 숫자·단위만 대조하고 기준(전주/12주)은 안 봄 → 정황: "12주 대비"를 "전주 대비"로 써도 수치 같으면 통과 | 일부 검증기 | 04 |
| F04 시간대 0 | P0 | **확정**(시작시각 기준) | `supabase/migrations/20260930010000_hourly_rating_pattern_zero_fill.sql:35-43,65-74` | `get_hourly_rating_pattern`은 시작시각의 시로 묶는다. 7:54 시작 방송은 7시 칸에만 들어간다(파서 확인: 신병4사보타주 07:54:58~09:01:07, 2049=0.07742). 겹침 기준 함수는 `20260920010000_dow_pattern_span_aware…`(3시간 블록/30분 히트맵)에만 있어 한 화면에 두 기준 혼재. "0.000" 표시는 `ChannelDeepDive.tsx:5049-5052 Number(avg_rating)||0` 가설 | 겹침 기준 함수(부분) | 03 |
| F05 대표 경쟁작 겹침 | P0 | **확정** | `supabase/migrations/20260922040000_competitor_overlap_skyuhd_support.sql:68-97`, 호출 `api/dashboard/channel/route.ts:574,979` | 조건 `cp.start < op.end AND cp.end > op.start`(1초만 겹쳐도 후보), 정렬 `cp.rating desc`. 겹침 길이·비율·타깃·지역은 정렬에 미사용 → 38초 겹침 사례와 부합 | — | 03 |
| F06 액션 충돌 | P0 | **부분 재현** | 홈 `Dashboard.tsx:795-820`, 상세 `ChannelDeepDive.tsx:1663-1667`, 태그 원천 `page1/route.ts:1439-1480`·`scheduling/fit-score/route.ts` | 태그는 같은 마트 `mart_scheduling_fit_score.tag`를 공유하나 상세 헤드라인은 별도 규칙으로 "유지·확대 검토"를 만든다. 공통 `ActionCandidate` 없음. `actionTags.ts`는 색·라벨 매핑 29줄뿐 | 마트 태그 | 04, 07/08 |
| F07 빈 값 0 / 덮어쓰기 | P0 | **부분 구현** | `skyUhd.ts:48-60,258-269`, `skyUhdDispatch.ts:100-145`, `nielsenIngest.ts:245-254,494`, `nielsenDaily.ts:68-74`, `admin/SkyUhdUploader.tsx:55,82` | skyUHD 빈 시청률→0은 사용자 지시에 따른 의도적 구현(화면 고지, 미래일 null 보호). 닐슨 빈 셀은 null 유지. 재업로드는 **삭제 후 삽입**이며 트랜잭션·버전·롤백·변경 차이 미리보기는 코드에서 찾지 못함 → 삽입 실패 시 삭제된 구간 복구 안 됨(정황) | 업로드 로그 `file_uploads` | 01, 05 |
| F08 KPI 버전 혼재 | P0 | **확정(표시 경로)** | `ideal-schedule/SummaryPanel.tsx:27`(`needs_recalc`면 재합산), `page.tsx:553-559`(저장값), `:966-968`(기대=재합산, 증감=저장값), `engineRunner.ts:81 pickCurrentWeek`, `SummaryPanel.tsx:91`("지난주"), `BlockDrawer.tsx:56` | revision/작업본 필드 없음(`parent_run_id`만). 한 화면에 서로 다른 revision 값이 동시에 나올 수 있고, 비교 기준 주가 대상 주 직전이 아닐 수 있는데 "지난주"로 표기. **실제 run 원시값은 미조회**라 0.047/0.048 분모는 확정하지 않음. 상세 `IDEAL_SCHEDULE_AUDIT.md` §5-6 | `needs_recalc`, `parent_run_id` | OPT01, 10, 12 |
| F09 Avail 연결 | P0 | **신규 설계** | 없음(`\bavail\b` 0건) | 필수 편성·직재방·반복한도만 존재 | 필수 편성 제약 | 06, OPT03, 13 |
| F10 예측 검증 수준 | P1 | **부분 구현** | `purchase/page.tsx:448,458,317,388` | 80% 구간·과거 예측 평균오차·기준일 표시 있음. 구간 겹침 후보를 순위처럼 표시하는 문제, "재방 횟수≠독립 표본" 경고는 없음(`peer_airings` 그대로 노출) | 구간·보정 표시 | 11, OPT05 |
| F11 주간 36위 이내 | P1 | **확정** | `ideal-schedule/model.ts:135-137 rankText`, `SummaryPanel.tsx:83-91`, `page.tsx:565-567` | 툴팁에 "경쟁 채널 편성 변화는 반영되지 않습니다"는 있으나 본문은 "주간 기대 등위 N위 이내"만 | 툴팁 고지 | 11, 15 |
| F12 인과 단정 | P1 | **부분 재현** | `Dashboard.tsx:2547`("…에 밀림"), `llmSynthesis.ts:68`(LLM 인과 단정 금지) | LLM은 프롬프트로 막으나 규칙 문구에 "밀림" 잔존. 전수 조사 미실시 | LLM 가드레일 | 04, 15 |
| F13 기여도 | P1 | **확정** | `audience-report/[channel]/page.tsx:564,704-720`, `reportFlatten.ts:267`, `Dashboard.tsx:4421` | 표 열 제목은 "기간 평균 시청률"로 정직하나 섹션 제목이 "누적 기여". 홈 "총합"=평균×횟수 단순 곱. 시간가중 분해·잔차 미구현 | — | 04, 08 |
| F14 복합 점수·프로파일 | P1 | **확정** | `components/audienceReport/deepDive.tsx:484-491 buildTargetSentence`, `audienceReport/deepDiveAnalyzer.ts:32 TARGET_INDEX_WEAK=80`, `admin/GenreMapManager.tsx:71` | `weakTargets.slice(0,1)`로 가장 낮은 1개만 "○○만 평균 이하". 지수 80 이하가 여럿이어도 "만". 분류율 반올림으로 99.5%↑는 100% 표시 가능 | 임계값 상수 | 04, 05 |
| F15 포트폴리오 분모 | P1 | **부분 구현** | 구현 `audienceReport/targetGroups.ts:17-20`, `validate.ts:65 checkGroupIsolation`, `portfolioBuilder.ts:278`; 잔존 `portfolioBuilder.ts:154,312`, `portfolioFlatten.ts:78,86`, `narrativeLlm.ts:101` | 그룹 A/B 분리는 코드로 강제. 채널 증감률은 단순 평균·대상 채널 표기 없음. 재방/원본 비율을 "유지율"로 부름 | 그룹 분리 검증 | 09, 15 |
| F16 보고서·PPT | P1 | **범위 밖(미확인)** | `audienceReport/pptSlidePlan.ts`, `exportRenderers.ts` | 이번 조사 지정 범위 아님 | — | 14 |
| F17 긴 페이지 | P1 | **범위 밖(미확인)** | — | — | — | 07, 08 |
| F18 구매 기준일 차이 | P1 | **확정** | `purchaseSim/predict.ts:76`, `purchaseSim/recommend.ts:46`, `.github/workflows/refresh-purchase-recommendations.yml`, `purchase/page.tsx:317,365,400` | 시뮬=요청 시점 최신 경쟁 데이터일, 추천=주 1회 사전 계산 `as_of` 고정. 두 기준일은 표시되나 차이 강조 없음. 시크릿 미설정이면 추천은 갱신되지 않아 차이가 더 벌어짐. 제목 "구매 추천"(가격·판권 미반영 안내는 있음) | 기준일 표시 | 13 |
| F19 시각·워딩 | P2 | **확정(일부)** | 탭 제목 `src/app/layout.tsx:42 "Create Next App"`; `ChannelDeepDive.tsx:766-771 fmtSeconds`, `Dashboard.tsx:3360-3363 fmtSecondsCompactKorean`; "(18/6)" `ChannelDeepDive.tsx:5341`; "평소" `ChannelDeepDive.tsx:1423-1528`, `audience-report/[channel]/page.tsx:210,297,301`; "컨텐츠" 48행 / "콘텐츠" 236행(`src/` ts·tsx, 주석 포함) | `Math.round(v % 60)`이라 59.5초 이상이면 **"28분 60초"**가 되는 버그를 직접 확인(분 올림 없음). 나머지는 위치만 확인 | — | 15 |

## 3. 원본 XLS 대조 (이번 단계에서 직접 실행)

폴더 `Nielsen Data/2026/10` 파일 6개: 일간 261001·261002·261003·261004·261005, 주간 260928-261004. 패키지 `03_원본대조_회귀사례.json`의 대상은 261004 일간과 주간 파일.

| 검증 | 결과 |
|---|---|
| sha256 | 261004 일간 `be131916…28c9`, 주간 `134533ef…ad99f` — 패키지 기록과 **일치** |
| 스키마 | 일간 **10시트**(유료방송가입가구 179×27, 개인 169×27, ENA/ENA DRAMA/ENA PLAY/ONCE·OLIFE 경쟁채널시청률 4, ENA/ENA DRAMA/ENA PLAY/ONCE·OLIFE·ENA SPORTS 타깃상세 4), 주간 **2시트**(유료방송가입가구, 개인). 실제 OLE/BIFF `.xls`. 월간·Avail 파일은 **부재** |
| 분석기간 헤더 | 일간 `2026. 10. 04. (일요일)`, 주간 `2026.09.28 - 2026.10.04`, 분석지역 수도권·National, 분석대상 유료방송가입가구·여자3049·개인5064(+개인2049 등 시트 내) |
| 골든 14건 셀 대조 | 순위·시청률·점유율·Reach·시청시간(일수 실수) 전 셀 + `×86400` 초 변환 — **14/14 일치** |
| 파서 예외 5그룹 셀 | ENA PLAY타깃상세 D7=수도권 2039·I7=수도권 2049, D14=0.02327/I14=0.07742, `24:25:32`/`25:46:31` 문자열, `하루전체` 행; ENA PLAY경쟁채널 E9=0과 H9 빈 셀, D12=0.07742/E12=0.02327; ENA경쟁채널 A3 지역 예외문; ONCE·OLIFE·ENA SPORTS타깃상세 A7/A32/A57/A76 블록 헤더; 주간 H21=12/I21=ENA/J21=0.31771 — **전부 기대값과 일치** |
| **저장소 파서 실행** (`parseNielsenDailyWorkbook`, `parseNielsenPeriodWorkbook`, DB 미접근) | 일간 reportDate 2026-10-04, 누락 시트 0. 채널 순위 골든(ENA 개인2049 18위 0.06047, ENA DRAMA 26위 0.04201, ENA PLAY 33위 0.02998, OLIFE National 29위 0.13632, ONCE 58위 0.06222, ENA STORY 67위 0.05305, SkyUHD 188위 0.00283)·주간 골든(ENA 7위 0.11358, DRAMA 31위, PLAY 41위, OLIFE 34위 0.09658, ONCE 77위, STORY 66위, SkyUHD 194위 0.00212) **모두 파서 출력과 일치**. ENA PLAY 신병4사보타주 07:54:58~09:01:07은 타깃 헤더로 매핑되어 2039=0.02327, 2049=0.07742로 올바르게 분리. `하루전체` 총계행 103건은 `isDailyAggregate=true`로 프로그램과 분리 |
| 같은 파서가 확인한 사실 | ENA 주간 순위는 타깃별로 다르다: 개인2049 7위, 수도권/National 유료방송가입가구 각 12위 → F01의 7 vs 12는 **타깃 또는 지표 종류 차이로 설명 가능한 값 쌍** |

한계: 파서 결과가 DB에 저장될 때의 타깃 매핑·0/결측 처리는 실행하지 않았다(운영 DB 변경 금지). 261001·261002·261003·261005 일간은 기대값이 없어 구조만 확인(시트 10개 동일, 행 수는 일자별로 다름).

## 4. 이번 조사에서 새로 발견한 항목

| N | 내용 | 근거 | 수준 | 제안 단계 |
|---|---|---|---|---|
| N01 | 루트 `middleware.ts`와 `src/proxy.ts`가 둘 다 추적, matcher·리다이렉트 대상(`/access-denied` vs `/pd/login`)이 다름. 실제 동작·빌드 충돌은 실행 안 함 | 조사 에이전트 | 미확인 | 05 |
| N02 | 편성표 뽑기: 개선율 분모 커버리지 비대칭(여백·빈 슬롯·기대 null이 분모에서 제외), 표본 내 평가+최댓값 선택 편향, AI 모드는 백테스트 근거 없음, 기준모델 비교표 없음, 요일 순차 탐색 | `IDEAL_SCHEDULE_AUDIT.md` | 확정(코드), 영향 크기 미측정 | OPT01~05 |
| N03 | 로컬 테스트 DB·CI 자동 테스트 없음. 순수 함수 테스트(`test:ideal` 138건)만 로컬 실행 가능 | `supabase/config.toml` 없음, workflows 2개 | 확인 | 01 이전에 경계 주입 설계 |
| N04 | 순위 정의(닐슨 주간 순위 / 일별 평균 / 서비스 내 순위)를 통일하는 공용 함수 없음 | `SYSTEM_MAP.md` §4 | 확정 | 02 |
| N05 | `purchase_recommendations` 사전 계산은 GitHub 시크릿 미설정이면 갱신 안 됨 | 직전 작업 | 확인 | 13 전 운영 확인 |

## 5. 확정 사실 / 가설 / 미확인 총정리

- **확정**: F02, F04(집계 기준), F05, F08(표시 경로), F11, F13, F14, F18, F19 일부, N02~N04, 원본-파서 일치.
- **가설**: F01 실제 원인, F03의 기준 문구 바꿔치기, F04의 "0.000" 경로, F07 삽입 실패 시 복구, F08 "지난주" 실제 `current_week_start`.
- **미확인**: F16, F17, N01, F12 전수, 운영 DB 값 전반, 실제 DOCX/PPTX 출력.

## 6. 단계 02 이후 상태 갱신 (2026-10-06)

| F | 변경 | 근거 |
|---|---|---|
| F01 | **원인 수정·확인**: 편성 비교 주간 순위가 공식 기간 순위가 아니라 일별 순위 평균의 반올림이던 점을 코드로 확정하고, 공식 주간 행이 있으면 공식 값·없으면 "일별 순위 평균(잠정)"으로 표시하도록 수정. 7위(수도권2049)·12위(전국가구)는 별도 문맥 | `docs/agent-improvement/PROGRESS.md` 단계 02, `scripts/test-metrics.ts` |
| F02 | **완화**: 전환 중 "이전 선택의 값" 배너+흐림. 응답-요청 일치 검사까지의 완전 원자성은 아님(단계 07/08) | `ChannelDeepDive.tsx` |
| F19 | "분 60초" 수정 완료(공통 `formatDurationKo`·`formatDurationClock`로 3곳 교체). 탭 제목 "Create Next App"·"평소"·"(18/6)"·컨텐츠/콘텐츠는 단계 15 | `src/lib/metrics/delta.ts` |
| (추가: 기간 값 집계 표기) | 보고서 KPI에서 Rating·Share·Reach·시청시간을 여러 날 기간에 "(일평균)"으로 표기, 순위는 "일별 평균 순위" | `reportSections.ts` |

## 7. 단계 03 이후 상태 갱신 (2026-10-06)

| F | 변경 | 근거 |
|---|---|---|
| F04 | **수정**: 채널 화면·보고서의 시간대별 시청률을 시작 시각이 아니라 방송 구간 겹침으로 배분(07:54:58~09:01:07은 7시 302초·8시 3600초·9시 67초). 겹친 방송이 없는 시간은 결측(null)이며 0이 아님. "프로그램 평균의 시간배분 추정(분 단위 실측 아님)" 안내를 차트에 표시. 시작 시각별 평균은 별도 필드(`start_avg_rating`)로 유지 | `broadcastTime/{interval,hourly,hourlyFetch}.ts`, `scripts/test-broadcast-time.ts` |
| F05 | **수정**: 경쟁 프로그램을 겹친 초·양쪽 대비 비율로 선별(기본 10분 이상이면서 한쪽 방송의 30% 이상, 설정 가능). 14:10:50~15:16:59 vs 15:16:21~16:44:00의 교집합 38초(반개구간)는 대표 경쟁작이 아님. 원본 파일에서 해당 두 방송을 찾아 같은 결과 확인 | `broadcastTime/overlap.ts`, 홈·채널 API |
| (신규 발견) | 기존 겹침 RPC `get_competitor_program_overlap`의 2~6시 방송 정규화가 `<06:00 → +24h`라 닐슨 방송일(02:00 시작)과 달라 새벽 구간 비교가 어긋날 수 있음. 대표성 계산은 새 구간 정의(2시 기준)로 다시 하지만 RPC가 미리 거른 후보에는 영향이 남음(SQL 미수정) | `20260922040000_competitor_overlap_skyuhd_support.sql:76-88` |
