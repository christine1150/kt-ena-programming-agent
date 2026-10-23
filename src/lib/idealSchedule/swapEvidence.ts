// 교체 판단의 실측 근거(2026-10-23 과거 실제 편성 변경 검증, docs/agent-improvement/SWAP_CHECK.md) — 표시 전용 상수·순수 함수.
//
// PD가 실제로 바꾼 교체 279건(편성 결정 143개)에서 모델이 변경 7일 전에 예상한 변화와 바뀐 뒤 실제 변화를 견줬다.
//   · 모델이 −10% 이상 내린다고 본 교체 77건 중 75%가 실제로 내렸다 → "떨어질 가능성 큼" 경고는 앞세워도 된다.
//   · 이력이 없는 신규 프로그램으로의 교체는 모델이 약 28% 높게 잡았고, +10% 이상 오른다고 본 47건 중 45%가 실제로 내렸다(오름 47%)
//     → 신규 교체는 이득 숫자 대신 시험 편성으로 다룬다.
// 다시 재면(scripts/skill-baseline/swap-check.mts) 이 숫자도 함께 고친다.

export const DROP_CALL_REL = -0.1;
export const DROP_CALL_HIT = 0.75;
export const DROP_CALL_N = 77;
export const NEW_SWAP_BIAS = 0.28;
export const NEW_SWAP_DOWN_SHARE = 0.45;
export const NEW_SWAP_N = 47;
export const SWAP_EVIDENCE_PERIOD = "2025-03~2026-09 실제 교체";

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

export type SwapCall = { kind: "drop"; rel: number } | { kind: "newTest"; rel: number } | null;

/**
 * 후보를 지금 배치 대신 넣었을 때의 판단 — rel = 후보 기대 ÷ 지금 배치 기대 − 1.
 * 신규(근거 C) 후보가 더 높게 나오면 이득 대신 시험 편성으로, 어떤 후보든 10% 이상 낮으면 하락 경고로 본다.
 */
export function swapCallOf(candidateExpected: number | null, placedExpected: number | null, candidateGrade: string): SwapCall {
  if (candidateExpected === null || placedExpected === null || placedExpected <= 0) return null;
  const rel = candidateExpected / placedExpected - 1;
  if (rel <= DROP_CALL_REL) return { kind: "drop", rel };
  if (candidateGrade === "C" && rel > 0) return { kind: "newTest", rel };
  return null;
}

export const dropWarningText = (rel: number) =>
  `이 교체는 기대가 ${pct(rel)} 낮습니다. ${SWAP_EVIDENCE_PERIOD}에서 모델이 10% 이상 낮게 본 교체의 ${pct(DROP_CALL_HIT)}(${DROP_CALL_N}건 중)가 실제로도 내렸습니다.`;

export const NEW_SWAP_TEXT = `이력이 거의 없는 프로그램이라 기대 이득은 근거가 약합니다. ${SWAP_EVIDENCE_PERIOD}에서 신규 교체는 모델이 평균 약 ${pct(NEW_SWAP_BIAS)} 높게 잡았고, 10% 이상 오른다고 본 신규 교체 ${NEW_SWAP_N}건 중 ${pct(NEW_SWAP_DOWN_SHARE)}가 실제로 내렸습니다. 시험 편성으로 넣고 2~4주 실적으로 확인하세요.`;
