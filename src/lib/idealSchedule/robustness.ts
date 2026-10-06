// 선택 불확실성 점검(OPT03) — 순수 함수, 시드 고정(재현 가능). 점추정의 최고값만 골라 낙관적이지 않은지, 검증 오차가 현실이 될 때 개선이 유지되는지 본다.
//
// 방법: 검증 잔차(실측 ÷ 예측 배율)를 근거 등급(A/B/C)별 분포로 쓰고, **프로그램 단위로 한 번 뽑은 오차를 그 프로그램의 모든 블록이 공유**한다
// (한 프로그램을 여러 슬롯에 반복 편성했을 때 그 프로그램을 과대평가했다면 전부 같이 빗나가는 위험을 반영 — 독립 오차로 보면 위험이 과소평가된다).
// 같은 프로그램이 기준안·후보안 양쪽에 있으면 같은 오차를 받으므로 상쇄되고, 후보안에만 있는 프로그램의 오차는 개선율을 흔든다.
// 임의의 risk coefficient를 시청률 단위에 더하지 않는다 — 결과는 개선율의 분포(양수일 확률, 하위 10%·중앙·상위 90%)와 근거 등급별 비중으로만 낸다.
export type Grade = "A" | "B" | "C";

export interface RobustBlock {
  /** 오차를 공유하는 단위(프로그램) */
  programKey: string;
  minutes: number;
  expected: number | null;
  grade: Grade;
}

export interface RatioSamples {
  A: number[];
  B: number[];
  C: number[];
}

export interface RobustnessResult {
  scenarios: number;
  /** 모델상 점추정 개선율(오차 없음) */
  point: number | null;
  /** 개선율 > 0인 시나리오 비율 */
  pPositive: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** 후보안의 (기대×분) 중 근거 등급별 비중 — C(근거 부족)가 크면 점추정 낙관 위험이 크다 */
  evidenceMix: Record<Grade, number>;
  /** 후보안에만 있는(기준안에는 없는) 프로그램의 (기대×분) 비중 — 오차가 상쇄되지 않는 부분 */
  uniqueShare: number | null;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantileOf(sorted: number[], u: number): number {
  if (sorted.length === 0) return 1;
  const pos = Math.min(sorted.length - 1, Math.max(0, u * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const avgOf = (blocks: RobustBlock[], mult: (b: RobustBlock) => number): number | null => {
  let s = 0;
  let m = 0;
  for (const b of blocks) {
    if (b.expected === null) continue;
    s += b.expected * mult(b) * b.minutes;
    m += b.minutes;
  }
  return m > 0 ? s / m : null;
};

/** 후보안(plan)과 기준안(baseline)의 개선율이 검증 오차 시나리오에서 얼마나 유지되는지. 표본이 없는 등급은 오차 없음(1)으로 두지 않고 결과에 evidenceMix로 드러낸다. */
export function robustnessCheck(plan: RobustBlock[], baseline: RobustBlock[], ratios: RatioSamples, opts: { scenarios?: number; seed?: number } = {}): RobustnessResult {
  const n = opts.scenarios ?? 500;
  const rand = rng(opts.seed ?? 1);
  const sorted: RatioSamples = { A: [...ratios.A].sort((a, b) => a - b), B: [...ratios.B].sort((a, b) => a - b), C: [...ratios.C].sort((a, b) => a - b) };
  const keys = [...new Set([...plan, ...baseline].map((b) => b.programKey))].sort();
  const pointPlan = avgOf(plan, () => 1);
  const pointBase = avgOf(baseline, () => 1);
  const point = pointPlan !== null && pointBase !== null && pointBase > 0 ? pointPlan / pointBase - 1 : null;
  const draws: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = new Map(keys.map((k) => [k, rand()]));
    const mult = (b: RobustBlock) => quantileOf(sorted[b.grade], u.get(b.programKey) as number);
    const rp = avgOf(plan, mult);
    const rb = avgOf(baseline, mult);
    if (rp !== null && rb !== null && rb > 0) draws.push(rp / rb - 1);
  }
  draws.sort((a, b) => a - b);
  const q = (x: number) => (draws.length ? draws[Math.min(draws.length - 1, Math.max(0, Math.round(x * (draws.length - 1))))] : null);
  const total = plan.reduce((s, b) => s + (b.expected === null ? 0 : b.expected * b.minutes), 0);
  const mix: Record<Grade, number> = { A: 0, B: 0, C: 0 };
  const baseKeys = new Set(baseline.map((b) => b.programKey));
  let unique = 0;
  for (const b of plan) {
    if (b.expected === null) continue;
    const w = b.expected * b.minutes;
    mix[b.grade] += w;
    if (!baseKeys.has(b.programKey)) unique += w;
  }
  for (const g of ["A", "B", "C"] as const) mix[g] = total > 0 ? mix[g] / total : 0;
  return {
    scenarios: draws.length,
    point,
    pPositive: draws.length ? draws.filter((d) => d > 0).length / draws.length : null,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    evidenceMix: mix,
    uniqueShare: total > 0 ? unique / total : null,
  };
}
