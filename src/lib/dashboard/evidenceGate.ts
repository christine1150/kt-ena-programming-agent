// 교체안 근거 관문(2026-10-14, 사용자 지시 0단계) — 순수 함수. 엔진 기대값은 표본이 적은 후보일수록 부풀려진다
// (예: 표본 4회 후보의 예측 범위가 0~0.377, 그 자리 평소 시청률의 100배 넘는 기대값). 확실성이 보통 이상이고 표본이
// MIN_SAMPLE_FOR_REPLACE회 이상일 때만 "교체 추천"으로 말하고, 아니면 기대 개선폭 수치를 숨긴 '테스트(시험 편성) 후보'로만 보여 준다.
export type Certainty = "HIGH" | "MID" | "LOW" | null;
export const MIN_SAMPLE_FOR_REPLACE = 5;
export function evidenceOf(certainty: Certainty, sampleCount: number): "ok" | "weak" {
  return (certainty === "HIGH" || certainty === "MID") && sampleCount >= MIN_SAMPLE_FOR_REPLACE ? "ok" : "weak";
}
