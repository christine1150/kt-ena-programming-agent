# 지표 계약 (단계 00 초안 → 단계 02 구현 반영)

상태: **단계 02에서 `src/lib/metrics/`로 구현**(아래 §10 구현 대응표). 이 문서의 §1~§9는 계약 본문이고, 공급자(닐슨) 설정이 확인되지 않은 정의는 단정하지 않는다.

## 1. 원본 값의 단위와 변환

| 지표 | 원본 | 저장·표시 단위 | 현행 위치 | 규칙(제안) |
|---|---|---|---|---|
| 시청률 | 셀 0.11358 | **0.11358 %** (퍼센트 단위 그대로, ×100 금지) | `nielsenDaily.ts parseNumberCell` → `ratings.rating` | 표시 반올림은 `ratingRounding.ts`(skyUHD 5자리, 그 외 3자리). 단위 기호 `%` 병기, 차이는 `%p` |
| 점유율 share | 1.39 | % | 동일 | 시청률과 단위 형식이 다르다(셀 값이 이미 %) — 일괄 ×100 금지 |
| Reach | 5.15 | % (공급자 정의) | 동일(`reach`) | 주간 파일 값을 "7일 순도달률"이라 부르지 않는다. 일별 Reach 합산·평균으로 주간 Reach를 만들지 않는다. 공급자 문서 확인 전 이름은 "도달률(원본 표기)" |
| 시청시간 | 엑셀 일수 실수 또는 `H:MM:SS` 문자열 | **초** | `nielsenDaily.ts timeSpentToSeconds = round(raw×86400)` | 0.034618…일 = 2991초(골든 확인) |
| 시청시간비율 | 0.3979 | 39.79 % | `parsePercentText raw×100` | 시청률과 형식이 다름 — 별도 변환 |
| 순위 | No. 열 | 정수 | `rank` | §3 |

## 2. 타깃·지역

- 채널 KPI: Group A(ENA, ENA Drama, ENA Play)=수도권 개인2049, Group B(OLIFE, ONCE, ENA Story, skyUHD)=National 유료방송가입가구(`CLAUDE.md`).
- 라벨 3계층: 채널 마스터 "수도권 개인2049" / 랭킹 시트 "개인2049" / 타깃상세 시트 "수도권 2049" — `targetResolution.ts`(`resolveRankSheetTargetLabel`, `resolveProgramLevelTargetLabel`)가 변환. 고정 열 번호로 타깃을 복제하지 않는다(ENA는 D=2049, ENA PLAY는 D=2039 — 파서가 헤더로 매핑하는 것을 골든으로 확인).
- 지역 예외: ENA경쟁채널시청률 A3에 "유료방송가입가구(National)-KBS1, MBC, SBS는 수도권 기준"이 명시. 지역이 다른 값은 같은 컬럼에 섞어 비교하지 않고 출처 지역을 보존(제안: `source_region` 필드).
- 서로 다른 타깃(2049와 가구)·그룹(A와 B)의 시청률·도달률은 합산하지 않는다(`validate.ts checkGroupIsolation`이 이미 강제).

## 3. 순위(rank)의 종류 — 현재 화면마다 다르게 쓰인다

| 종류 | 정의 | 현행 위치 |
|---|---|---|
| R1 공식 일간 순위 | 원본 No.(일별 파일) | `ratings.rank` |
| R2 공식 기간(주간·월간) 순위 | 원본 No.(주간 파일) | `nielsen_period_rank` (홈 주간 리뷰, 채널 주간 변동, 이상적 편성 예상 순위) |
| R3 일별 순위의 기간 평균 | R1의 평균 | `get_channel_period_rank_and_rating`(보고서, 소수 1자리), `scheduleGridSource.ts computeWeeklyAvgStat`(편성 비교, 반올림 정수) |
| R4 서비스 내 비교집단 순위 | 비교 채널 집합 안 순위 | 코드 확인 필요(미확인) |
| R5 기대 순위 | 과거 분포로 추정한 값 | `rankEstimate.ts` |

규칙(제안): 화면의 순위 숫자 옆에 종류(R1~R5), 타깃, 기간을 함께 표기한다. 원본 No.는 간격이 있으므로 행 번호·채널 수로 재생성하지 않는다. 서로 다른 종류를 같은 라벨("주간 순위")로 부르지 않는다. 공용 `getChannelRank({kind, target, period})` 함수로 한곳에서 계산한다.
골든(주간, ENA): R2 개인2049=7, R2 National 가구=12, R2 수도권 가구=12.

## 4. 기간·시간

- 방송일은 02:00~다음 날 02:00(분 값 120~1559)이며 24시 이상은 **방송일을 유지**한다. 달력 날짜는 별도 필드(예: 방송일 10/4 25:30 = 달력 10/5 01:30 KST). `idealSchedule/time.ts`가 이미 구현(`test:ideal` 통과).
- 기간 길이: 일간=1일(방송일), 주간=월~일 7일, 월간=달력월. 월누계 비교는 **전월 같은 일수**(`periodPresets.ts`, 월말 클램프 포함).
- 구간은 반개구간 `[start, end)`로 내부 정규화하되 원본 초 단위를 유지한다.

## 5. 0·결측·소표본

- 원본에는 숫자 0, 문자열 `'0.00'`, 빈 셀이 공존. **0은 관측값, 빈 셀은 결측**이며 자동 0 통일 금지(닐슨 파서는 빈 셀을 null 유지 — 코드 확인). skyUHD 빈 시청률의 0 반영은 사용자 지시에 따른 예외이며 화면 고지가 있다(`skyUhd.ts`).
- 표본(방영 건수)은 패널 표본수가 아니다. 용어: "예측 근거 방송 N건". 같은 회차 재방 N회는 독립 표본이 아님(F10).
- 총계행(`하루전체`)은 프로그램으로 세지 않는다(파서가 `isDailyAggregate`로 분리 — 골든 확인).

## 6. 집계 방식

- 기간 평균 시청률: 단순 평균이 아니라 **시간(방송 분) 가중** 평균이 필요한 곳(주간 기대 시청률 등)과 일 단위 단순 평균이 의도된 곳(일별 평균)을 구분해 명명한다. 현행 주간 기대는 분 가중(`engine.ts:489`)이나 **기대 null·여백·빈 슬롯 시간이 분모에서 빠진다**(`IDEAL_SCHEDULE_AUDIT.md` §5-1) → 제안: 분모는 전체 계획 horizon 분, 미평가 시간은 별도 표기.
- 지수: "동일 슬롯 대비 지수(기준 100)". 지수 153.8을 "시청률 153.8%"로 쓰지 않는다. 슬롯 baseline 정의는 `features.ts:166`(채널 평균→시 평균→요일×시 평균, k=4 수축).
- 변화 표기: 수준 차이는 `+0.030%p`, 비율 변화는 `+12.3%`(비교 기간 병기). 둘을 같은 "상승"으로 쓰지 않는다.
- 채널 기여/포트폴리오: 같은 분모의 시간가중 분해와 잔차를 제시할 수 있을 때만 "기여"를 쓴다. 아니면 "기간 평균 시청률 상위".

## 7. 편성 예측의 세 가지 값 (OPT 단계 계약)

| 값 | 단위 | 현행 |
|---|---|---|
| 예상 주간 시청률 | % | `engine.ts summary.expectedAvgRating` (블록 `expected` 분 가중) |
| 최적화 점수 | 무차원(목적함수) | `scoring.ts value = fitness×(1+보너스)×baseline×분×(1−패널티)`, 최적화가 최대화하는 값 |
| 실무 채택 판단 | 범주 | 권리·소재·브랜드 — 현재 코드에 없음(Avail 미구현) |

규칙: Fit Score·가중 점수를 시청률로 출력하지 않는다(현행 준수). 개선율 = 후보 예측 ÷ 기준안 예측 − 1, **같은 모델·cutoff·분모·제약·타깃·기간**일 때만 산출하고, 과거 실적 대비 비교는 보조 정보로 분리한다.

## 8. 버전·기준일

- 모든 숫자는 `(data cutoff, 모델/규칙 버전, revision)`을 가진다. 현행 편성 run은 `as_of_date`, `input_fingerprint`, `config_snapshot`, `parent_run_id`를 저장하나 사용자에게 보이는 revision 체계는 없다(F08). 구매 추천은 `as_of`·`model_version`을 저장하나 시뮬레이션 기준일과 별개(F18).
- "지난주"라는 표현은 실제 비교 기준 주가 대상 주 직전일 때만 쓴다. 아니면 "비교 기준 편성: YYYY-MM-DD~MM-DD".

## 9. 단계 02에서 확정할 항목

1. 공용 지표 엔진의 입력/출력 타입(채널·타깃·기간·종류·출처 포함)과 R1~R5 구분.
2. 주간 시청률·Reach·시청시간의 "공급자 원본 값"과 "서비스 재구성 값" 구분 필드.
3. 단위 변환·반올림·`%`/`%p` 표기 함수 단일화.
4. 골든 14건·파서 예외 5건을 **하드코딩 값이 아닌 `03_원본대조_회귀사례.json` 기대값 + 실제 파서 출력**으로 비교하는 테스트(이번 단계에서 임시 스크립트로 일치 확인 완료, 테스트 코드화는 단계 01~02).

## 10. 구현 대응표 (단계 02, `src/lib/metrics/`)

| 계약 | 구현 | 비고 |
|---|---|---|
| MetricContext(채널·지역·대상·플랫폼·지표·단위·grain·기간·비교기간·집계방식·순위종류·순위모집단·출처개정·지식기준일·커버리지) | `context.ts` `MetricContext`, `buildMetricContext` | 지역·대상은 타깃 라벨에서 분해(`parseTargetLabel`) |
| data_snapshot_id | `dataSnapshotId(ctx)` (FNV-1a) | 컨텍스트·데이터 시점이 같으면 같은 ID |
| 섞으면 거부 | `describeMismatch`/`assertCombinable` | 타깃·지역·지표·단위·grain·집계방식·순위종류·기간·비교기간·출처개정 |
| 순위 종류 R1~R5 | `rank.ts` `RankKind`(official_period/official_daily/daily_mean/peer_group/goal/estimated), `formatRank`, `selectWeeklyStat` | 순위는 항상 정수(일별 평균·추정도 반올림), 종류는 이름으로 구분 |
| 공식 vs 일간 기반 잠정 | `aggregate.ts` `Aggregation`, `deriveFromDaily`, `reconcileWithOfficial`; `weeklyView.ts buildWeeklyView` | 공식 기간 행이 있으면 공식, 없으면 잠정(+수신 일수) |
| 누락일 0 채움 금지 | `meanOverDays` | 결측 제외, 수신 일수·누락일 반환 |
| Reach·Share·시청시간 비집계 | `derivationPolicy` | 시청률만 잠정 평균 허용 |
| 기간 정의 | `period.ts` `PeriodKind`, `resolvePeriodSpec` | 아래 §11 |
| %p vs % 분리, 원시 정밀도, 분모 0/극소 | `delta.ts` `computeDelta`, `formatRatingDelta`, `formatRelativeChange`, `formatArrowPct` | 극소 기준 `RATING_TINY_BASE=0.001%` |
| 시청시간 표기 | `formatDurationKo`, `formatDurationClock` | "28분 60초" 제거 |
| 서버 공식 기간 값 | `officialPeriod.ts fetchOfficialPeriodRow` | 서버 전용(supabase), index에서 내보내지 않음 |

## 11. 기간 정의 (이름 = 실제 동작)

| PeriodKind | 기간 | 비교 기준 | 기존 프리셋 |
|---|---|---|---|
| `day` | 기준일 | 전일 | dod |
| `same_dow` | 기준일 | 최근 N주 같은 요일(비교 날짜 목록) | sdow_* |
| `week_completed` | 완결 월~일 주(기준일이 일요일이면 그 주, 아니면 직전 주) | 직전 완결주 | (신규) |
| `wtd` | 이번 주 월요일~기준일 | 직전 주 같은 경과 일수 | wtd(기존 prior는 직전 동일 길이) |
| `mtd_same_days` | 1일~기준일 | 전월 같은 일수(전월이 짧으면 말일까지, 일수 다름 표시) | **mom**(10/1~10/4 vs 9/1~9/4 보존) |
| `month_completed` | 완결 달력월 | 직전 완결월(일수 다름 표시) | (신규) |
| `rolling7` | 최근 7일 | 직전 7일 | **wow**(기존 이름은 달력 주가 아닌 롤링) |
| `rolling30` | 최근 30일 | 직전 30일 | last30 |
| `qtd` | 분기 1일~기준일 | 전분기 같은 경과 일수 | qoq |
| `ytd_yoy` | 1/1~기준일 | 전년 같은 기간(윤년 일수 다름 표시) | yoy |

기존 프리셋 5종(dod·wow·mom·qoq·yoy)과 wtd·last30은 같은 날짜 함수를 호출하며, 다섯 개 기준일(10/4, 3/31, 2028-02-29, 12/31, 1/1)에서 공통 정의와 일치함을 테스트로 확인한다. 화면 프리셋 라벨은 실제 동작에 맞게 바꿨다(예: mom → "월누계 vs 전월 같은 일수(MTD 비교)"). 완결주 WoW·완결월 MoM은 엔진에는 있으나 아직 화면 선택지에는 없다.

## 12. 순위 표기 결정 (사용자 지시 2026-10-06)

순위는 반드시 정수로 표시한다. 일별 순위 평균(R3)과 기대 순위(R5)도 **반올림한 정수**로 보이되, 닐슨 기간 공식 순위(R2)와 혼동되지 않도록 "일별 순위 평균 41위"처럼 **종류 이름을 붙인다**(보고서 KPI 라벨은 "일별 평균 순위"). 계산용 값은 소수로 유지하고 표시·API의 `rank` 필드만 정수로 낸다. 평균에 쓴 일수가 모자라면 "· 5/7일"을 덧붙인다.

## 13. 방송 시간·시간대·겹침 계약 (단계 03, `src/lib/broadcastTime/`)

- **방송 구간**: 방송일(02:00~다음 날 02:00)·시작/종료 방송 초·달력 날짜시각(+09:00)·시간대(`Asia/Seoul`)·종료 경계 규칙을 계산 결과(`BroadcastInterval`)에 싣는다. 저장 컬럼(`ratings.start_time/end_time`, 시계 시각)은 바꾸지 않고 읽을 때 `airingInterval`이 만든다(2시 미만 +24시간, 종료가 시작보다 이르면 자정 넘김). 24·25시를 다음 날로 재분류하지 않는다.
- **종료 경계**: 공급자가 종료 시각을 방송에 포함하는지는 **미확인**이다. 반개구간 `[시작, 종료)`으로 정규화하고 `END_CONVENTION = {exclusive_assumed, verified:false}`를 메타데이터로 남긴다. 공급자 정의가 확인되면 이 상수 한 곳만 바꾼다.
- **시간대 지표 둘을 분리**: ① **시간대 추정 시청률** = 프로그램 평균을 방송이 시간대와 실제로 겹친 초만큼 배분한 시간가중 평균(분 단위 실측 아님, 안내 문구 `HOURLY_ESTIMATE_NOTE`를 차트에 표시). ② **시작 시각별 프로그램 평균** = 그 시간대에 시작한 방송의 평균(기존 정의, 편성 횟수 검산용). Reach·시청시간은 시간 배분이 의미 없어 ②의 평균을 그대로 쓴다.
- **결측과 0**: 겹친 방송이 없는 시간대는 0이 아니라 결측(null)+`coverageRatio`(관측 초 ÷ 3600×상세 수신 일수). 방송은 있는데 시청률이 0이면 관측값 0. 슬롯 상태는 `rated/zero_rating/rating_missing/not_aired/unobserved`로 구분(`classifySlot`).
- **경쟁 대표성**: 우리·경쟁 방송의 겹친 초, 각각 대비 비율, 타깃·지역·중계 특성으로 판단. 기본 임계값 `minOverlapSec=600`, `minRatio=0.3`(둘 중 한쪽 방송 대비), 설정 가능. 근거 문구를 결과에 싣고, "프로그램 평균 시청률끼리의 비교이며 겹친 구간의 분 단위 비교가 아님"을 함께 표시한다. 종료 시각이 없어 확인할 수 없는 행은 지우지 않고 `unverifiable`로 표시.
- **프라임**: 규칙표 `PRIME_RULES`(채널·적용기간별, 현행 평일 19~23·토일·공휴일 18~23은 기본 행)와 `primeOverlap`(경계 교차 방송은 겹친 초로 배분). 공휴일 달력은 `describeHolidayCalendar`로 버전·시간대·범위 관리.
- **동일 슬롯 비교 조건**: 요일 유형·본/재방·일회성 특집·스포츠/중계·시즌이 다르면 같은 평균에 섞지 않는다(`compareSlotConditions`). 회차는 같은 프로그램의 다른 회차를 막지 않으므로 표시용.
