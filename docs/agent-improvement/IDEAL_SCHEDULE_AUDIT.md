# 편성표 뽑기(시청률 자판기) 실사 — 단계 00 선행 조사

작성: 2026-10-06 / 범위: 코드 읽기 + 로컬 `npm run test:ideal` 기준선. 운영 DB 조회·생성·재계산은 실행하지 않았다.
표기: **[코드 확인]** 파일:라인을 직접 읽어 확인 / **[가설]** 코드 정황은 있으나 실행으로 재현하지 못함 / **[미확인]** 근거 없음.
OPT01~OPT05의 선행 자료이며, 여기서 확정하지 못한 항목은 해당 OPT 단계에서 재현한다.

## 1. 실제 호출 경로 (버튼 → 화면)

| 단계 | 위치 | 하는 일 |
|---|---|---|
| 버튼 | `src/app/ideal-schedule/page.tsx:363-380` | `POST /api/scheduling/ideal-schedule` — 채널·주(월요일)·모드(KEEP_CURRENT/AI_OPTIMIZED)·전략·경쟁사·최적화 타깃·`configOverride`(화면 가중치·반복한도) |
| API | `src/app/api/scheduling/ideal-schedule/route.ts:12` | 인증 → `parseRunRequest` → `runIdealSchedule` → `saveRun`. `maxDuration = 60` |
| 데이터 로드 | `src/lib/idealSchedule/engineRunner.ts:168` `runIdealSchedule` | as_of = 대상 주 −1일. RPC `get_ideal_schedule_own_airings`(최근 91일), 경쟁사 RPC, 장르맵, 필수 편성 제약, 직재방 규칙, 과거 주 검증 잔차 |
| 엔진 | `src/lib/idealSchedule/engine.ts:199` `runIdealScheduleEngine` | Feature → 후보 풀 → Hard 제약 → 골격 → 최적화 → 요약. 순수 함수, 입력 지문(FNV-1a) 생성 |
| 점수 | `scoring.ts:256` `Scorer.evaluate` | 블록별 기대 시청률·fitness·패널티·`value` |
| 예측 | `features.ts:219` `MetricModel.expected` | 6단계 수축 기대값 |
| 탐색 | `optimizer.ts:676` `optimizeWeek` → `optimizeKeepCurrent`(:230) / `optimizeAiTimes`(:516) | 아래 §4 |
| 저장 | `runStore.ts:97` `saveRun` | `ideal_schedule_runs`(요약·config_snapshot·지문) + `ideal_schedule_blocks`(IDEAL/CURRENT) + `ideal_schedule_candidates` |
| 표시 | `SummaryPanel.tsx`, `page.tsx`, `IdealWeekGrid.tsx` | 저장값을 그대로 표시, 일부는 클라이언트에서 재합산(`model.ts:246 weeklyExpected`) |

수동 교체·잠금: `runStore.ts:203 swapBlock` → `needs_recalc` 표시 → `recalculate/route.ts`가 `parent_run_id`로 새 실행을 만든다.
백테스트: `backtest.ts:19 runBacktestWeek`, 일괄 `scripts/calibrate-ideal-backtest.mts`.

## 2. 기대 시청률 예측식 [코드 확인]

기대값 = `idx × baseline(요일, 시)` (`features.ts:251`).

- **baseline**(`features.ts:166`): 채널 평균 → 시 평균 → 요일×시 평균 순으로 k=4 수축.
- **idx**: 방영별 가중 `ΣwR ÷ ΣwB`(비율의 합)로 단계별 지수를 만들고 구체→일반으로 수축 `idx_L = (n_L·idx_L + k·idx_{L+1}) / (n_L + k)`.
  단계: ①프로그램×방영유형+요일+시 ②+시 ③프로그램 전체(본+재) ④장르+요일+시 ⑤장르+시 ⑥채널 baseline(=1).
- 최근 28일 방영은 가중치 2(`features.ts:137`), 공휴일 제외, 시작 시각의 시(hourBucket) 하나로만 조회.
- 설정 기본값(마이그레이션): lookback 91일, recent_days 28, recent_weight 2, shrinkage_k 4, min_n 3, full_confidence_n 12.

예(계산 확인): baseline 0.05, ①n=4 지수 1.4 / ②n=6 1.3 / ③n=10 1.2 / ④⑤≈1.0 → ③ (10·1.2+4)/14=1.143 → ② (6·1.3+4·1.143)/10=1.237 → ① (4·1.4+4·1.237)/8=1.319 → 기대 0.0659.

신뢰도 = `min(1, 프로그램 자체 표본/12) × 안정성`. 장르·채널 단계 폴백은 신뢰도에 넣지 않는다(`features.ts:243-248`).

## 3. 점수와 예측 시청률의 관계 [코드 확인]

- 화면에 나오는 "주간 기대 시청률"은 `expected`(예측) 분 가중 평균이다. Fit Score가 시청률로 둔갑해 출력되지는 않는다.
- 그러나 **최적화가 최대화하는 값은 `expected`가 아니라 `value`** 이다(`scoring.ts:380`):
  `value = fitness × (1+전략보너스) × baseline × 분 × (1 − 패널티합)`,
  `fitness = Σ w_i·c_i ÷ Σ w_i`(c: kpi지수·target구성비·요일×시적합·최근추세·안정성·앞뒤연관, 근거 없는 항목은 분모에서 제외).
  기본 가중치 35/20/20/10/5/10(`ideal_schedule_config`), 패널티: 연속 0.15·같은 시 0.05·장르집중 0.05·저신뢰 0.1·길이불일치 0.1.
- 기본 가중치에서는 목적함수 ≠ 기대 시청률이므로, 목적함수 1등 편성이 기대 시청률 1등이 아닐 수 있다.
  KEEP 모드는 후처리 `keepInsignificant`(`optimizer.ts:367`)가 **기대 시청률** 기준으로 "차이 작으면 지난주 편성 유지"를 판정한다(AI 모드에는 없음).
- **중복 반영 후보 [코드 확인, 영향 크기 미측정]**: 최근성은 `idx`의 가중치(w=2)와 `c_trend`(최근4주÷12주) 두 곳에, 요일×시 정보는 `idx` ① 단계와 `c_weekday_slot` 두 곳에 들어간다. 기본 가중치에서만 해당한다.
- **"시청률 우선안"(KPI 100%, 나머지 0, `page.tsx:63`) [코드 확인]**: fitness = c_kpi = `idx` → `value = expected × 분 × (1−패널티)`. 요일×시·최근성 정보는 `expected()` 안에 이미 있으므로 **예측 특징이 약해지지는 않는다.** 바뀌는 것은 목적함수뿐이며, 패널티(반복·저신뢰·길이불일치)는 그대로 남는다. "가중치 100%면 최고 성능"이라는 가정은 코드로도 성립하지 않는다(탐색 한계·표본 편향은 그대로).
- 화면에서 바꾼 가중치·반복한도는 `configOverride`로 이번 실행에만 적용되고 `config_snapshot`에 남는다(`engineRunner.ts:173`).

## 4. 탐색(최적화) 구조와 한계

**KEEP_CURRENT(기존 틀 유지)** `optimizer.ts:230`: 최근 4주 골격(또는 업로드 편성표) 슬롯에 후보 배정 — ①슬롯 가치(baseline×길이) 큰 순 탐욕 ②교체·맞교환 국소탐색(`max_local_search_iter` 2000) ③`keepInsignificant`.
**AI_OPTIMIZED(AI 시간 최적화)** `optimizer.ts:516`: 요일별 빈 구간을 5분 격자 DP(`runIntervalDp`, 위치별 상위 2개 상태), 월→일 순서로 확정, 반복 한도 초과 시 고정+금지 후 재계산, 마지막에 같은 길이 후보 교체 국소탐색.

한계(전부 코드 확인, 영향은 OPT04에서 측정):

| # | 한계 | 위치 |
|---|---|---|
| L1 | 요일을 월→일 순으로 순차 확정 — 주간 한도·같은 시 반복이 요일 순서에 좌우됨(주간 전체 최적 아님) | `optimizer.ts:550` |
| L2 | DP 내부는 직전 프로그램 상위 2개만 보관, 하루·주 한도와 장르 집중은 DP 밖에서 사후 처리(DP는 `dayGenreShare: 0`) | `:448-514, :491` |
| L3 | AI 모드 국소탐색은 "같은 길이 후보 교체"만 — 두 슬롯 맞교환·블록 이동 없음 | `:640-660` |
| L4 | KEEP 모드 구성이 탐욕+교체/맞교환 — 슬롯 3개 이상 연쇄 이동·에피소드 재배치 없음 | `:289-333` |
| L5 | 난수·시간 예산·취소·best-so-far 없음(결정적이라 재현은 됨). 서버 `maxDuration=60`이 유일한 상한 | `route.ts:10` |
| L6 | 한도 위반 해소가 휴리스틱(가장 많이 초과한 그룹의 상위 가치 배치만 고정) — 최적성 보장·gap 계산 없음 | `:588-636` |
| L7 | 오리지널 드라마·예능은 반복 한도 없음(사용자 규칙 2026-10-01) — 단, 최근 91일 관측 최대치 이내로만(`engine.ts:321-335`). 반복 피로·노출 간격은 예측에 없음(지수는 노출 횟수와 무관한 상수) | `engine.ts:324`, `features.ts` |
| L8 | 경쟁사 미래 편성은 입력 없음 — 경쟁 데이터는 과거 분포만, `benchmark_placement` 기본 NONE(자사 프로그램만) | `config.ts`, `engine.ts:231` |

## 5. "+80%" 개선율의 분자·분모 [코드 확인]

`개선율 = (이번 편성안 주간 기대) ÷ (비교 기준 주 CURRENT 주간 기대) − 1` (`SummaryPanel.tsx:27-29`, `page.tsx:558`).
- 분자: `summary.expectedAvgRating` = 블록별 `expected`의 **편성 분 가중 평균**(`engine.ts:489-499`).
- 분모: `evaluations.CURRENT.expectedAvgRating` = 비교 기준 주의 **실제 방영**을 같은 Scorer·같은 as_of로 평가한 값(`engine.ts:618-672`). 즉 후보 예측 ÷ 과거 실적이 아니라 **같은 모델 안의 비율**이며, 실측은 별도 표기("같은 방식 기대 0.026 · 실측 0.028")다. 이 설계는 패키지 T04의 요구와 일치한다.

개선율 해석에 영향을 주는 코드 사실:

1. **분모 커버리지 비대칭(T06 위험)** — `wavg`는 `expected === null` 블록을 분모에서 뺀다(`engine.ts:489-499, 644-654`). 여백(AI 모드 ≤ `max_gap_min` 10분), KEEP 모드의 `emptySlots`(후보 없음·반복 cap 초과)는 평균 분모에 아예 들어가지 않는다. 분자·분모 편성의 방송 분 총합이 같은지 검사하는 코드는 없다. 영향 크기는 **[미측정]**.
2. **표본 내(in-sample) 평가** — CURRENT 주는 최근 4주 안이라 91일 학습 창에 포함된다. 후보 편성도 같은 학습 자료에서 지수 상위를 골라 만든다. 후보 쪽에만 "최댓값 선택 편향"이 붙는다(수축 k=4가 일부 완화). 코드 주석도 "기대값이 큰 후보를 골라 뽑으므로 상한 추정"이라고 인정한다(`backtest.ts:131`).
3. **"지난주" 라벨 불일치 후보** — `pickCurrentWeek`(`engineRunner.ts:81`)는 대상 주 직전부터 최대 4주를 거슬러 "7일 데이터 완비 + 공휴일 없음"인 첫 주를 고른다. 2026-10-05 주는 직전 두 주(9/21 추석, 9/28 개천절)가 공휴일 포함이라 9/14 주가 선택될 수 있다(F08 정황과 일치). 그런데 화면 문구는 "지난주 실제 편성(MM/DD 주)"(`SummaryPanel.tsx:91`)·"지난주 대비"(`page.tsx:558`)다. **[가설: 코드 경로는 확인, 실제 해당 run의 `current_week_start` 값은 DB 미조회]**
4. **편성표 vs 후보의 시간 분모 정의**가 UI·API에서 각각 다시 계산된다(`model.ts:246` 클라이언트 합산 vs `engine.ts` 서버 합산). 클라이언트 `weeklyExpected`는 항상 벤치마크를 빼고 서버는 설정(`include_benchmark_in_totals`)을 따른다.

## 6. F08(0.047/+80.2% vs 0.048/+82.0%) 코드 후보 원인 [가설 — run 원시값 미조회]

- 수동 교체 후(`needs_recalc=true`) `SummaryPanel.tsx:27`은 현재 블록으로 재합산한 `weeklyExpected(ideal)`을 쓴다.
- 반면 편성표 제목줄(`page.tsx:553-559`)은 **항상 저장된 `summary.expectedAvgRating`** 과 그에 대한 증감률을 표시한다.
- 모바일 상단 바(`page.tsx:966-968`)는 기대값은 재합산, 증감률은 저장값 기준으로 **한 줄에 서로 다른 revision을 섞는다.**
→ 같은 화면에 서로 다른 revision의 값이 동시에 보일 수 있는 코드 경로가 실제로 있다. 저장된 run의 원시 값이 없으므로 표시값 역산으로 분모를 확정하지 않는다(OPT01에서 DB 사본 또는 합성 입력으로 재현).

## 7. 검증 체계의 한계 [코드 확인]

- 백테스트는 walk-forward(대상 주 전날까지 학습, 대상 주 실제 편성을 같은 모델로 평가)이며 MAE·bias·범위 적중률을 낸다(`backtest.ts`). 누수 방지는 SQL에서 `broadcast_date <= as_of`, 잔차 로드는 `week_start ≤ as_of−6`(`engineRunner.ts:146-166`).
- 그러나 검증 대상은 **실제로 방송된 배치**의 다음 방영 예측이다. 탐색기가 새로 만든 배치(다른 요일·시간으로 이동한 프로그램)의 정확도는 검증되지 않는다.
- 일괄 보정 스크립트는 `KEEP_CURRENT`만 돌린다(`scripts/calibrate-ideal-backtest.mts:20`). **AI_OPTIMIZED 모드의 예측 범위·편향은 백테스트 근거가 없다.**
- 예측 범위는 `기대값 × 과거 오차 배율(실측÷기대) 분위`이며 잔차 30건 미만이면 학습 기간 변동(TRAINING, 표본 내라 더 좁음)으로 대체한다(`uncertainty.ts`). 독립성(같은 회차 재방 다수)·타깃별·신규작별 분리는 없다.
- 주간 합계 구간은 제공하지 않는다(블록 구간을 합산하지 않음). 이 점은 패키지 요구와 일치.
- 기준모델(같은 요일/시간 최근 평균, 같은 프로그램 최근 성과)과의 **비교표는 없다** — 현재 모델이 단순 기준보다 낫다는 증거가 저장소에 없다.

## 8. Avail·권리 [코드 확인]

- `\bavail\b|가용재고|권리 잔여`를 `src`에서 검색해 **0건**. Avail/권리 개념이 코드에 없다.
- 있는 제약: 필수 편성(`ideal_schedule_constraints`: MANUAL_REQUIRED / WEEKLY_PREMIERE / FIXED_SLOT, 우선순위·잠금·충돌 목록), 직재방 규칙(`rerunRules.ts`), 반복 한도(하루 3·주 14, 무제한 장르 예외), 본방 주간 한도(관측 최대 방영 수).
- 즉 "이번 주에 쓸 수 있는가"는 편성 가능 여부와 무관하게 후보가 된다. 화면이 '권리 미확인 탐색안'임을 표시하지 않는다.

## 9. 패키지 합성 벤치마크 T01~T12 — 현재 코드 기준 판정(실행 재현 아님)

| T | 판정 | 근거 |
|---|---|---|
| T01 시간가중 평균 | 구현됨 | `wavg`가 분 가중(`engine.ts:489`). 이 값을 직접 검증하는 테스트는 없음 |
| T02 탐욕 반례(공유 1회) | **미검증 가설** | KEEP은 탐욕+맞교환 보정이 있어 해결 가능성, AI는 요일 순차+같은 길이 교체뿐. 실제 실패 여부는 OPT03에서 완전탐색과 비교 |
| T03 Avail 불가 → 차선 | 미구현 | Avail 없음 |
| T04 기준·후보 동일 모델 비교 | 구현됨(단 §5 비대칭·표본 내 한계) | `SummaryPanel.tsx:29`, `engine.ts:618` |
| T05 소표본 극단값 | 부분 | 수축 k=4, 신뢰도·근거등급 표시. 극단 1회 전용 정책 없음 |
| T06 분모 보존 | **위험(코드 확인)** | §5-1 |
| T07 수동 교체 델타 = 전체 재계산 | 부분 | 엔진 내부 델타는 영향 요일 재평가(`optimizer.ts:128`)로 일치하도록 설계. 화면 what-if는 "이 칸만"이며 전체 재계산 아님(`page.tsx:518`) |
| T08 seed·제약 위반 0 | 해당 없음/부분 | 난수 없음(결정적). 제약 위반 0 보증 테스트는 있음(필수 편성 충돌 등) |
| T09 확정 직전 재검증 | 미구현 | 확정·Avail·예약 없음 |
| T10 timeout·best-so-far | 미구현 | §4 L5 |
| T11 경쟁 미래 편성 금지 | 대체로 충족 | 경쟁 입력은 과거만, Benchmark 기본 NONE |
| T12 "대체안 실제 검증" 문구 차단 | 부분 | 기대값 문구 "미래 예측 아님"(`SummaryPanel.tsx:95`), 백테스트 note는 정직. 보고·내보내기 문구 전수 점검은 미실시 |

## 10. 위험 우선순위 (OPT01 착수 전 가설)

1. **집계/버전**: F08 혼합 표시(§6), "지난주" 라벨(§5-3), 분모 커버리지(§5-1). 명백한 표시·집계 오류는 회귀 테스트와 함께 먼저 수정(OPT01 통과 기준).
2. **낙관 편향**: 표본 내 평가 + 최댓값 선택(§5-2), AI 모드 무검증(§7), 무제한 장르 반복(L7).
3. **제약 누락**: Avail·권리 없음(§8).
4. **탐색 한계**: L1~L6.
5. **UX 혼동**: "AI 예측"류 용어, 순위·기간 표기(02_검수결과 §8과 연결).
