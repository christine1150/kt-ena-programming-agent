// 편성표 예측 엔진 결과(evaluatePlanOnly) → 고정 기록용 칸(ForecastSlot). 값은 그대로 옮기고 다시 계산하지 않는다.
import type { PlanEvalResult } from "@/lib/idealSchedule/engine";
import type { ForecastSlot } from "./types";

export function toForecastSlots(r: PlanEvalResult): ForecastSlot[] {
  return r.slots.map((s) => ({
    slotKey: `${s.date}|${s.startMin}|${s.candidateKey}`,
    date: s.date,
    startMin: s.startMin,
    endMin: s.endMin,
    // 편성표에는 종료 시각이 없어 다음 칸 시작(또는 그날 마지막 칸은 방송일 끝)으로 정한 값이다 — 근사임을 기록에 남긴다
    endApproximated: true,
    endAssumedDayEnd: s.endBasis === "DAY_END",
    programName: s.name,
    programId: s.programId,
    expected: s.expected,
    low: s.range?.low ?? null,
    high: s.range?.high ?? null,
    grade: s.grade,
    evidenceAirings: s.evidenceAirings,
  }));
}
