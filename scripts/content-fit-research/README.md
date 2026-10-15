# 콘텐츠 적합도 연구·검증 스크립트

`docs/content-fit/CONTENT_FIT_LOGIC.md`의 모든 숫자를 다시 만들어 볼 수 있게 한 스크립트 모음이다. **운영 코드가 아니다**(앱이 import하지 않는다).
운영 엔진은 `src/lib/contentFit/`이고, 여기 `candidates/final.mjs`는 그 엔진을 독립적으로 다시 구현한 레퍼런스(JS)다. 두 구현이 실데이터에서 같은 결과를 내는지 `parity.mts`가 대조한다.

## 준비
읽기 전용으로 DB를 조회해 로컬 JSON을 만든다(쓰기 없음, 키 출력 없음). 결과는 닐슨 방영 단위 원자료이므로 **`.cache/`(gitignore)에만 두고 커밋·외부 전송하지 않는다.**

```bash
node --env-file=.env scripts/content-fit-research/dump.mjs
```

- 출력 위치 `CF_DATA_DIR`(기본 `.cache/content-fit`), 기간 `CF_FROM`/`CF_TO`(기본 2026-01-01 ~ 2026-10-13 — 문서의 숫자와 같은 기간).
- 비교 기준인 "개편 전 점수"는 `mart_scheduling_fit_score`에 남아 있는 과거 기준일 행이다. 이 테이블을 정리하면 아래 1·2·3번의 개편 전 열은 다시 만들 수 없다.

## 실행

| 순서 | 명령 | 재현하는 것 |
|---|---|---|
| 1 | `node scripts/content-fit-research/diagnose-legacy.mjs` | 문서 §1: 선호도 정의 재현(오차 1e-15 이하), 30대 비중과의 상관 -0.98, 구성요소 상관, 우세 쌍 역전 108쌍, 결측 50 채움, percentile 정보 손실, 선호도의 이후 실적·편성 유지 판별력 |
| 2 | `node scripts/content-fit-research/evaluate.mjs` | 문서 §3-1·§3-3: 개편 전 점수 vs 신규 적합도의 6개 채널 지표(예측ρ·상하위차·안정성·우세 역전·표본 편향·부분표본 강건성), 선호도가 작동한 기준일만의 비교, ENA Drama 사례 |
| 3 | `node scripts/content-fit-research/retention.mjs` | 문서 §3-2: 실제 편성 유지(이후 28일 내 재방영)와의 판별력(AUC), 판정별 유지율, 슬롯 대비 성과 구간별 유지율 |
| 4 | `node scripts/content-fit-research/calibrate.mjs` | 문서 §2: κ와 칸 최소 표본 M, 대안 구조의 예측 오차(MSE) |
| 5 | `node scripts/content-fit-research/sensitivity.mjs` | 문서 §2: 점수 비중·판정선을 흔들었을 때 지표와 유지율 서열 |
| 7 | `node scripts/content-fit-research/validate-holdout.mjs` | 문서 §3-6: 시점 분할(앞쪽에서 상수를 고르고 뒤쪽에서 평가, 반대도), 작품 단위 부트스트랩으로 AUC 차이 95% 구간 |
| 6 | `npx tsx scripts/content-fit-research/parity.mts` | 문서 §3-4: 운영 TS 엔진 ↔ JS 레퍼런스 불일치 0건(엔진을 고칠 때마다 다시 실행) |

## 구성
- `harness.mjs` — 덤프 로딩, 과거 시점 스냅샷(`buildSnapshot`: 그 시점까지의 데이터만, 미래 누수 없음), 이후 28일 정답(`forwardOutcome`), 평가 지표(`evaluate`).
- `lib_cf.mjs` — 계층형 슬롯 기대치(프로그램 자신 제외), 표본 보정 지수, 점수 사상, 추세, 시간대별 지수.
- `candidates/final.mjs` — 신규 논리 레퍼런스 구현(`computeFinal`)과 상수(`CFG`). 운영 설정은 `src/lib/contentFit/config.ts`이며 둘이 같아야 한다.
- `candidates/old.mjs` — 마트에 저장돼 있던 개편 전 점수를 같은 평가 틀에 태우는 어댑터.

## 읽을 때 주의
- 평가 시점은 마트에 기준일이 있는 날 중 4~9월 14일 간격(수도권 3채널은 7개, 전국 3채널은 10개). 이 기간 안에서의 결과이며 계절·명절·특집은 분리하지 않았다.
- 개편 전 마트의 선호도는 2026-08-26 전후 정의가 바뀌어 그 이전 기준일에는 모든 프로그램이 50이다. 그래서 전체 시점 비교는 기존 점수에 유리하게 잡혀 있고, `evaluate.mjs`가 선호도가 작동한 기준일만의 비교를 따로 보여 준다.
- 편성 유지율은 PD의 선택을 반영하지만 시즌 종영·계약 만료·재편성도 '유지 안 됨'으로 잡힌다. 절대값보다 점수·판정 사이의 상대 비교로 읽는다.
