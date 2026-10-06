// 변경량과 성과의 효율 경계(OPT03) — 순수 함수. "무조건 모든 칸을 바꾸는 것"이 목표가 아니라, 바뀌는 칸·방송분이 늘 때 모델상 목적값이 얼마나 오르는지를 보여 준다.
// 최소변경·균형·성과우선은 같은 예측기와 같은 하드 제약을 공유하고 변경량만 다르다(권리·필수 제약을 푸는 안은 만들지 않는다 — evaluate가 feasible=false를 돌려주면 그 변경은 채택하지 않는다).
// 사용자 결정(2026-10-07): 편성 칸 수정 개수는 제한하지 않는다. 이 경계는 *제한*이 아니라 *정보*(변경 규모 대비 효과)이며, 성과우선안은 항상 전체 변경 안이다.
//
// 방법: 기준안(baseline)에서 시작해, 목표안(target)과 다른 칸을 한 번에 하나씩 목표안 쪽으로 바꾸되 매번 목적값 증가가 가장 큰 유효한 변경을 먼저 채택한다(탐욕 전진).
// 이 경로는 각 변경 개수에서의 *최적 부분집합이 아닐 수 있다*(칸 사이 상호작용·한도 때문). 작은 문제에서는 exactFrontier로 정답과 비교한다.

export interface ChangeUnit {
  key: string;
  /** 이 변경이 바꾸는 방송 분 */
  minutes: number;
}
export interface FrontierPoint {
  /** 기준안에서 이만큼 목표안 쪽으로 바꾼 상태 */
  keys: string[];
  changedSlots: number;
  changedMinutes: number;
  objective: number;
}
export interface FrontierSpec<TPlan> {
  changes: ChangeUnit[];
  /** 기준안에 keys의 변경만 적용한 편성안 */
  apply(keys: string[]): TPlan;
  /** 목적값(모델상 기대 시청률 등)과 하드 제약 충족 여부 */
  evaluate(plan: TPlan): { objective: number; feasible: boolean };
}

export function buildChangeFrontier<TPlan>(spec: FrontierSpec<TPlan>): FrontierPoint[] {
  const minutesOf = new Map(spec.changes.map((c) => [c.key, c.minutes]));
  const base = spec.evaluate(spec.apply([]));
  const points: FrontierPoint[] = [{ keys: [], changedSlots: 0, changedMinutes: 0, objective: base.objective }];
  const chosen: string[] = [];
  let remaining = spec.changes.map((c) => c.key).sort();
  let current = base.objective;
  while (remaining.length > 0) {
    let best: { key: string; objective: number } | null = null;
    for (const k of remaining) {
      const ev = spec.evaluate(spec.apply([...chosen, k]));
      if (!ev.feasible) continue;
      if (!best || ev.objective > best.objective + 1e-12) best = { key: k, objective: ev.objective };
    }
    if (!best) break; // 남은 변경은 어느 것도 유효하지 않다(제약 때문에 채택하지 않음)
    chosen.push(best.key);
    remaining = remaining.filter((k) => k !== best!.key);
    current = best.objective;
    points.push({ keys: [...chosen], changedSlots: chosen.length, changedMinutes: chosen.reduce((s, k) => s + (minutesOf.get(k) ?? 0), 0), objective: current });
  }
  return points;
}

/** 소형 문제용 정답: 모든 부분집합(≤20개 변경) 중 유효한 것에서 변경 개수별 최대 목적값. */
export function exactFrontier<TPlan>(spec: FrontierSpec<TPlan>): Map<number, number> {
  const n = spec.changes.length;
  if (n > 20) throw new Error("exactFrontier는 변경 20개 이하에서만 쓴다");
  const best = new Map<number, number>();
  for (let mask = 0; mask < 1 << n; mask++) {
    const keys: string[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) keys.push(spec.changes[i].key);
    const ev = spec.evaluate(spec.apply(keys));
    if (!ev.feasible) continue;
    if (!best.has(keys.length) || ev.objective > (best.get(keys.length) as number)) best.set(keys.length, ev.objective);
  }
  return best;
}

/** 변경 예산(칸 수·방송분) 안에서 목적값이 가장 높은 경계 점. 예산을 두지 않으면 마지막(전체 변경) 점. */
export function pickWithinBudget(points: FrontierPoint[], budget: { maxSlots?: number; maxMinutes?: number } = {}): FrontierPoint {
  let best = points[0];
  for (const p of points) {
    if (budget.maxSlots !== undefined && p.changedSlots > budget.maxSlots) continue;
    if (budget.maxMinutes !== undefined && p.changedMinutes > budget.maxMinutes) continue;
    if (p.objective >= best.objective) best = p;
  }
  return best;
}

export type VariantKind = "MIN_CHANGE" | "BALANCED" | "PERFORMANCE";
export const VARIANT_LABEL: Record<VariantKind, string> = { MIN_CHANGE: "최소변경안", BALANCED: "균형안", PERFORMANCE: "성과우선안" };
/** 모델상 전체 개선분 중 몇 %를 얻는 가장 적은 변경인지 — 표시용 기본값(정책이 아니라 조정 가능한 제시 기준). */
export const VARIANT_GAIN_SHARE: Record<VariantKind, number> = { MIN_CHANGE: 0.5, BALANCED: 0.8, PERFORMANCE: 1 };

/** 경계에서 전체 개선분의 share 이상을 처음 달성하는 점(가장 적은 변경). 개선이 없으면 기준안. */
export function pickByGainShare(points: FrontierPoint[], share: number): FrontierPoint {
  const base = points[0].objective;
  const top = Math.max(...points.map((p) => p.objective));
  const gain = top - base;
  if (!(gain > 1e-12)) return points[0];
  return points.find((p) => p.objective - base >= gain * share - 1e-12) ?? points[points.length - 1];
}

export function variantsOf(points: FrontierPoint[]): Record<VariantKind, FrontierPoint> {
  return {
    MIN_CHANGE: pickByGainShare(points, VARIANT_GAIN_SHARE.MIN_CHANGE),
    BALANCED: pickByGainShare(points, VARIANT_GAIN_SHARE.BALANCED),
    PERFORMANCE: pickByGainShare(points, VARIANT_GAIN_SHARE.PERFORMANCE),
  };
}
