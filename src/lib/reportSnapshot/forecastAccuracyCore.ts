// 예측 적중 집계의 순수 함수(고도화 A3) — DB·네트워크 없음.
// 입력은 저장된 사전 예측 대조(schedule_forecast_reviews.matches·metrics)와 예측 칸 값(schedule_forecast_values)이다.
// 새 예측·보정을 만들지 않는다: 이미 방송 전에 저장된 값과 방송 후 실적을 같은 방영끼리 센 결과만 요약한다.
// 한 주에 예측이 여럿이면(PLAN_UPDATE 포함) 가장 이른 사전 예측 하나만 쓴다 — 방송에 가까운 수정 예측으로 성적을 좋게 보이게 하지 않는다.
import type { ForecastAccuracySummary } from "./types";

/** schedule_forecast_reviews.matches 한 칸(review.ts의 ReviewMatchRow와 같은 모양) */
export interface ReviewedSlot {
  /** 칸 키 */
  k: string;
  /** 대조 상태 */
  s: "MATCHED" | "CHANGED" | "AMBIGUOUS" | "NO_ACTUAL" | string;
  /** 실적(MATCHED만) */
  a: number | null;
  /** 저장된 예상 */
  e: number | null;
  /** 근거 등급 */
  g: string | null;
}

export interface SlotValue {
  date: string;
  startMin: number;
  program: string;
  low: number | null;
  high: number | null;
}

export interface WeekReview {
  weekStart: string;
  /** 같은 주 여러 예측 중 고르기 위한 저장 시각 */
  createdAt: string;
  matches: ReviewedSlot[];
  officialDaily: { n: number; mae: number | null; bias: number | null; actualMean: number | null } | null;
  values: ReadonlyMap<string, SlotValue>;
}

/** 이 칸 수 미만이면 단락을 내지 않는다(표본이 너무 작음) */
export const MIN_ACCURACY_SLOTS = 20;
/** 등급별 줄을 내는 최소 칸 수 */
export const MIN_GRADE_SLOTS = 10;
/** 공식 하루 값 대비 줄을 내는 최소 일수 */
export const MIN_OFFICIAL_DAYS = 3;
export const WORST_COUNT = 5;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const median = (v: number[]): number | null => {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** 같은 주 중 가장 이른 사전 예측만 남긴다(createdAt 오름차순 첫 번째). */
export function earliestPerWeek(reviews: WeekReview[]): WeekReview[] {
  const byWeek = new Map<string, WeekReview>();
  for (const r of reviews) {
    const cur = byWeek.get(r.weekStart);
    if (!cur || r.createdAt < cur.createdAt) byWeek.set(r.weekStart, r);
  }
  return [...byWeek.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
}

/** 대조 결과를 요약한다. MATCHED 칸이 MIN_ACCURACY_SLOTS 미만이면 null(없는 근거를 만들지 않는다). */
export function summarizeForecastAccuracy(input: WeekReview[]): ForecastAccuracySummary | null {
  const weeks = earliestPerWeek(input);
  if (weeks.length === 0) return null;

  const slots = { matched: 0, changed: 0, ambiguous: 0, noActual: 0 };
  let sumAbs = 0;
  let sumErr = 0;
  let sumActual = 0;
  const within = { n: 0, hit: 0 };
  const widths: number[] = [];
  const grade: Record<string, { n: number; abs: number; actual: number; withinN: number; withinHit: number }> = {};
  const worstPool: { date: string; startMin: number; program: string; expected: number; actual: number; grade: string | null; inRange: boolean | null; abs: number }[] = [];
  let offN = 0;
  let offMaeSum = 0;
  let offBiasSum = 0;
  let offMeanSum = 0;

  for (const w of weeks) {
    for (const m of w.matches) {
      if (m.s === "MATCHED") slots.matched++;
      else if (m.s === "CHANGED") slots.changed++;
      else if (m.s === "AMBIGUOUS") slots.ambiguous++;
      else if (m.s === "NO_ACTUAL") slots.noActual++;
      const e = num(m.e);
      const a = num(m.a);
      if (m.s !== "MATCHED" || e === null || a === null) continue;
      const abs = Math.abs(e - a);
      sumAbs += abs;
      sumErr += e - a;
      sumActual += a;
      const v = w.values.get(m.k);
      const inRange = v && v.low !== null && v.high !== null ? a >= v.low && a <= v.high : null;
      if (inRange !== null) {
        within.n++;
        if (inRange) within.hit++;
        if (v && v.low !== null && v.high !== null && e > 0) widths.push((v.high - v.low) / e);
      }
      const g = m.g === "A" || m.g === "B" || m.g === "C" ? m.g : null;
      if (g) {
        const x = (grade[g] ??= { n: 0, abs: 0, actual: 0, withinN: 0, withinHit: 0 });
        x.n++;
        x.abs += abs;
        x.actual += a;
        if (inRange !== null) {
          x.withinN++;
          if (inRange) x.withinHit++;
        }
      }
      if (v) worstPool.push({ date: v.date, startMin: v.startMin, program: v.program, expected: e, actual: a, grade: m.g, inRange, abs });
    }
    const od = w.officialDaily;
    if (od && od.n > 0 && od.mae !== null && od.actualMean !== null) {
      offN += od.n;
      offMaeSum += od.n * od.mae;
      offBiasSum += od.n * (od.bias ?? 0);
      offMeanSum += od.n * od.actualMean;
    }
  }
  if (slots.matched < MIN_ACCURACY_SLOTS || sumActual <= 0) return null;

  const offMae = offN > 0 ? offMaeSum / offN : null;
  const offMean = offN > 0 ? offMeanSum / offN : null;
  const worst = worstPool
    .sort((x, y) => y.abs - x.abs)
    .slice(0, WORST_COUNT)
    .map((x) => ({ date: x.date, startMin: x.startMin, program: x.program, expected: x.expected, actual: x.actual, grade: x.grade, inRange: x.inRange }));
  return {
    from: weeks[0].weekStart,
    to: weeks[weeks.length - 1].weekStart,
    weeks: weeks.length,
    slots,
    withinRange: within,
    rangeWidthRel: median(widths),
    relMae: sumAbs / sumActual,
    relBias: sumErr / sumActual,
    byGrade: (["A", "B", "C"] as const)
      .filter((g) => grade[g])
      .map((g) => ({ grade: g, n: grade[g].n, relMae: grade[g].actual > 0 ? grade[g].abs / grade[g].actual : null, withinN: grade[g].withinN, withinHit: grade[g].withinHit })),
    officialDaily: { n: offN, mae: offMae, relMae: offMae !== null && offMean !== null && offMean > 0 ? offMae / offMean : null, bias: offN > 0 ? offBiasSum / offN : null, actualMean: offMean },
    worst,
  };
}
