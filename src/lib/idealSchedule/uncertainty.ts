// 기대값의 불확실성(2단계, 2026-09-30 통계 검토) — 순수 함수.
//
// 예상 범위 = 기대값 × [오차 배율 하위 분위, 상위 분위]. 오차 배율 q = 실측 ÷ 기대.
//   ① BACKTEST: 이 채널·타깃의 과거 주 검증(walk-forward) 방영별 잔차 — 근거 등급(A: 1~2단계, B: 3단계, C: 4~6단계)별로,
//      등급 표본이 부족하면 전체를 합쳐 쓴다. 기대값이 채널 평균의 10% 미만인 방영(새벽 등)은 배율이 폭주해 제외.
//   ② TRAINING: 백테스트가 없으면 학습 기간 안 "방영 지수 ÷ 그 프로그램 평균 지수"의 분포 — 표본 안 변동이라 실제
//      오차보다 좁게 나오므로 화면에 "검증 전"으로 표시한다.
// 임의의 ±값은 쓰지 않는다. 엄밀한 신뢰구간이 아니므로 "예상 범위"라고만 부른다.
//
// 표준오차(유지/교체 판단·확실도용) = σ_q × 기대값 ÷ √(프로그램 표본 수 + k) — 개별 방영 잡음이 아니라 "평균 추정"의 오차.

export type RangeGrade = "A" | "B" | "C";
export type UncertaintyBasis = "BACKTEST" | "TRAINING";

export interface UncertaintyBand {
  qLow: number;
  qHigh: number;
  sd: number; // 배율의 표준편차
  n: number;
}

export interface UncertaintyModel {
  basis: UncertaintyBasis;
  byGrade: Record<RangeGrade, UncertaintyBand | null>;
  all: UncertaintyBand;
}

export interface ResidualRow {
  expected: number | null;
  actual: number | null;
  fallbackLevel: number;
}

export const gradeOfLevel = (level: number): RangeGrade => (level <= 2 ? "A" : level === 3 ? "B" : "C");

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function bandOf(values: number[], lowQ: number, highQ: number): UncertaintyBand | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  return { qLow: quantile(v, lowQ), qHigh: quantile(v, highQ), sd, n: v.length };
}

/** 백테스트 방영별 잔차 → 등급별 배율 분포. 전체 표본이 minRows 미만이면 null(학습 기간 변동으로 대체). */
export function uncertaintyFromResiduals(rows: ResidualRow[], opts: { lowQ: number; highQ: number; minRows: number }): UncertaintyModel | null {
  const valid = rows.filter((r): r is ResidualRow & { expected: number; actual: number } => r.expected !== null && r.actual !== null && r.expected > 0);
  if (valid.length === 0) return null;
  const meanExp = valid.reduce((s, r) => s + r.expected, 0) / valid.length;
  const usable = valid.filter((r) => r.expected >= meanExp * 0.1);
  if (usable.length < opts.minRows) return null;
  const all = bandOf(usable.map((r) => r.actual / r.expected), opts.lowQ, opts.highQ);
  if (!all) return null;
  const byGrade = { A: null, B: null, C: null } as Record<RangeGrade, UncertaintyBand | null>;
  for (const g of ["A", "B", "C"] as const) {
    const q = usable.filter((r) => gradeOfLevel(r.fallbackLevel) === g).map((r) => r.actual / r.expected);
    byGrade[g] = q.length >= opts.minRows ? bandOf(q, opts.lowQ, opts.highQ) : null;
  }
  return { basis: "BACKTEST", byGrade, all };
}

/** 학습 기간 방영별 상대 변동(방영 지수 ÷ 프로그램 평균 지수) → 배율 분포(등급 구분 없음). */
export function uncertaintyFromTraining(relativeRatios: number[], opts: { lowQ: number; highQ: number }): UncertaintyModel | null {
  const all = bandOf(relativeRatios, opts.lowQ, opts.highQ);
  return all ? { basis: "TRAINING", byGrade: { A: null, B: null, C: null }, all } : null;
}

export function bandForLevel(model: UncertaintyModel | null, level: number): UncertaintyBand | null {
  if (!model) return null;
  return model.byGrade[gradeOfLevel(level)] ?? model.all;
}

/** 평균 추정의 표준오차 — 판단·확실도 전용(화면의 예상 범위와 다름). */
export function standardError(model: UncertaintyModel | null, expected: number | null, programSampleCount: number, k: number, level: number): number | null {
  const band = bandForLevel(model, level);
  if (!band || expected === null) return null;
  return (band.sd * expected) / Math.sqrt(programSampleCount + k);
}

/** 두 기대값 차이의 확실도(z) — 차이 ÷ 합성 표준오차. */
export function marginZ(deltaExpected: number, seA: number | null, seB: number | null): number | null {
  if (seA === null || seB === null) return null;
  const s = Math.sqrt(seA * seA + seB * seB);
  return s > 1e-9 ? deltaExpected / s : null; // 변동이 사실상 0이면(표본 극소 등) 확실도를 매기지 않는다
}

export type Certainty = "HIGH" | "MID" | "LOW";
/** 확실도 구분(z ≥ 2 뚜렷함, 1~2 보통, 1 미만 차이 작음) — 표시용 구분일 뿐 통계적 유의성 판정이 아니다. */
export const certaintyOf = (z: number | null): Certainty | null => (z === null ? null : z >= 2 ? "HIGH" : z >= 1 ? "MID" : "LOW");
