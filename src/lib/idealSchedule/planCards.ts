// 편성안 비교 카드(OPT06) — 순수 함수. 기준안·최소변경안·균형안·성과우선안을 *같은 카드 규격*으로 만든다.
//
// 원칙
//  · 모든 안은 같은 모델·같은 기준일·같은 하드 제약으로 평가된 값만 쓴다. 기준안 대비 차이는 두 안 모두 평가값이 있는 같은 요일·같은 분에서 계산한다(comparison.ts).
//  · 차이는 %p(시청률 포인트)와 %(비율)를 함께 낸다.
//  · "최고 기대안"과 "최적임이 증명된 안"을 구분한다 — 탐색된 최선안은 최적을 증명하지 않는다(OPT03/04).
//  · 하방 위험과 변경 부담을 같은 카드에 둔다(최고값만 보이지 않게). 시나리오 점검은 선택 편향을 덜어내지 않는다(OPT05).
//  · 서로 다른 편성안 버전의 숫자를 한 카드에 섞지 않는다 — 카드는 자기 planVersion을 단다.
import { compareOnCommonSupport } from "./comparison";
import type { SlotRightsStatus } from "./slotRights";

export type PlanKind = "BASELINE" | "MIN_CHANGE" | "BALANCED" | "PERFORMANCE";
export const PLAN_LABEL: Record<PlanKind, string> = { BASELINE: "기준안", MIN_CHANGE: "최소변경안", BALANCED: "균형안", PERFORMANCE: "성과우선안" };
export const PLAN_ORDER: PlanKind[] = ["BASELINE", "MIN_CHANGE", "BALANCED", "PERFORMANCE"];

export type EvidenceGrade = "A" | "B" | "C" | "가정";

export interface CardBlock {
  weekday: number;
  startMin: number;
  endMin: number;
  programKey: string;
  programName: string;
  candidateKey: string;
  expected: number | null;
  low: number | null;
  high: number | null;
  grade: EvidenceGrade | null;
  /** 경쟁 Benchmark 가상 편성은 주간 합계에서 뺀다 */
  countable: boolean;
  rights: SlotRightsStatus;
  /** 같은 권리 묶음(공유 잔여 횟수)을 쓰는 칸끼리 같은 값 */
  poolKey: string | null;
  /** 이 칸 판정 때의 잔여 횟수(회차 미지정이면 회차당 잔여) */
  remaining: number | null;
  episodes: number | null;
}

export interface CardRobustness {
  point: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  pPositive: number | null;
  scenarios: number;
}

export interface PlanCardInput {
  kind: PlanKind;
  /** 이 안의 편성안 버전(내용 지문) */
  planVersion: string;
  blocks: CardBlock[];
  /** 같은 모델로 평가한 기준안 블록 */
  baseline: CardBlock[];
  /** 필수·잠금 편성 충족 */
  required: { total: number; satisfied: number };
  /** 하드 제약 위반(OVERLAP·CAPS·BOUNDS 등) 건수 */
  hardViolations: number;
  robustness: CardRobustness | null;
  /** 이 안이 탐색 결과(최적 증명 없음)인가 */
  searched: boolean;
}

export interface PlanCard {
  kind: PlanKind;
  label: string;
  planVersion: string;
  /** 이 안 전체의 주간 기대(편성 분 가중, 평가된 칸) */
  weekly: { value: number | null; minutes: number };
  /** 기준안과 같은 시간 기준 비교 */
  vsBaseline: { planAvg: number | null; baselineAvg: number | null; diffPp: number | null; diffPct: number | null; commonMinutes: number; supportDiffers: boolean } | null;
  /** 개선율 시나리오(검증 오차) — 없으면 null. 선택 편향을 덜어내지 않은 값 */
  scenario: { p10Pct: number | null; p50Pct: number | null; p90Pct: number | null; pPositive: number | null; scenarios: number } | null;
  change: { blocks: number; slots: number; minutes: number; shareOfMinutes: number | null };
  repeat: { repeatedAirings: number; repeatedPrograms: number; maxWeekly: number };
  required: { total: number; satisfied: number };
  hardViolations: number;
  rights: {
    counts: Record<SlotRightsStatus, number>;
    /** 권리 판정 대상 칸 분 중 권리가 확인된 분의 비율(대상이 없으면 null) */
    confirmedShare: number | null;
    consumption: { pools: number; uses: number; overdrawn: number; atLimit: number };
  };
  evidence: { insufficientShare: number | null; byGrade: Record<EvidenceGrade, number> };
  /** 기준안보다 낮은 칸(하방) — 최고값만 보이지 않게 */
  downside: { lowerSlots: number; worstPp: number | null };
  claims: { bestExpected: boolean; optimalProven: false; note: string };
  cautions: string[];
}

/** 카드 경고를 띄우는 *표시 기준*(임시, 정책 수치 아님 — 실제 데이터 보정 전). */
export const CARD_NOTICE = { insufficientEvidenceShare: 0.3, pPositiveMin: 0.9, nearLimitShare: 0.8 } as const;

const slotKey = (b: { weekday: number; startMin: number; endMin: number }) => `${b.weekday}|${b.startMin}|${b.endMin}`;
const minutes = (b: { startMin: number; endMin: number }) => Math.max(0, b.endMin - b.startMin);

function weeklyOf(blocks: CardBlock[]): { value: number | null; minutes: number } {
  let s = 0;
  let m = 0;
  for (const b of blocks) {
    if (!b.countable || b.expected === null) continue;
    s += b.expected * minutes(b);
    m += minutes(b);
  }
  return { value: m > 0 ? s / m : null, minutes: m };
}

/** 기준안 대비 바뀐 칸: 같은 요일·시작·끝에서 같은 프로그램이 아닌 것(시간 구조가 바뀐 칸도 바뀐 것으로 센다). */
export function changedBlocks(plan: CardBlock[], baseline: CardBlock[]): CardBlock[] {
  const base = new Map<string, string>();
  for (const b of baseline) base.set(slotKey(b), b.programKey);
  return plan.filter((b) => base.get(slotKey(b)) !== b.programKey);
}

export function buildPlanCard(inp: PlanCardInput): PlanCard {
  const isBase = inp.kind === "BASELINE";
  const weekly = weeklyOf(inp.blocks);
  const cmp = isBase
    ? null
    : compareOnCommonSupport(
        inp.blocks.map((b) => ({ weekday: b.weekday, startMin: b.startMin, endMin: b.endMin, expected: b.expected, countable: b.countable })),
        inp.baseline.map((b) => ({ weekday: b.weekday, startMin: b.startMin, endMin: b.endMin, expected: b.expected, countable: b.countable }))
      );
  const vsBaseline: PlanCard["vsBaseline"] = cmp
    ? { planAvg: cmp.idealAvg, baselineAvg: cmp.currentAvg, diffPp: cmp.idealAvg !== null && cmp.currentAvg !== null ? cmp.idealAvg - cmp.currentAvg : null, diffPct: cmp.ratio, commonMinutes: cmp.commonMinutes, supportDiffers: cmp.supportDiffers }
    : null;

  const changed = isBase ? [] : changedBlocks(inp.blocks, inp.baseline);
  const baseMinutes = inp.baseline.reduce((s, b) => s + (b.countable ? minutes(b) : 0), 0);
  const changedMinutes = changed.reduce((s, b) => s + minutes(b), 0);

  // 반복 노출: 같은 프로그램이 한 주에 여러 번 편성된 양
  const perProgram = new Map<string, number>();
  for (const b of inp.blocks) perProgram.set(b.programKey, (perProgram.get(b.programKey) ?? 0) + 1);
  let repeatedAirings = 0;
  let repeatedPrograms = 0;
  let maxWeekly = 0;
  for (const n of perProgram.values()) {
    maxWeekly = Math.max(maxWeekly, n);
    if (n > 1) {
      repeatedPrograms++;
      repeatedAirings += n - 1;
    }
  }

  // 권리: 칸 수는 상태별로, 확인율은 *분* 기준(긴 칸이 더 크게 반영)
  const counts: Record<SlotRightsStatus, number> = { available: 0, conditional: 0, unknown: 0, unavailable: 0, not_checked: 0 };
  let subjectMin = 0;
  let confirmedMin = 0;
  for (const b of inp.blocks) {
    counts[b.rights]++;
    if (b.rights === "not_checked") continue; // 권리 판정 대상이 아니거나 확인하지 못함
    subjectMin += minutes(b);
    if (b.rights === "available") confirmedMin += minutes(b);
  }
  // 공유 권리 소진: 같은 묶음의 편성 횟수 vs 잔여
  const pools = new Map<string, { uses: number; cap: number | null }>();
  for (const b of inp.blocks) {
    if (!b.poolKey) continue;
    const e = pools.get(b.poolKey) ?? { uses: 0, cap: null };
    e.uses++;
    const cap = b.remaining === null ? null : b.remaining * Math.max(1, b.episodes ?? 1);
    e.cap = cap === null ? e.cap : Math.max(e.cap ?? 0, cap);
    pools.set(b.poolKey, e);
  }
  let overdrawn = 0;
  let atLimit = 0;
  let uses = 0;
  for (const p of pools.values()) {
    uses += p.uses;
    if (p.cap === null) continue;
    if (p.uses > p.cap) overdrawn++;
    else if (p.cap > 0 && p.uses >= p.cap * CARD_NOTICE.nearLimitShare) atLimit++;
  }

  // 근거: 평가값이 있는 칸 분 기준
  const byGradeMin: Record<EvidenceGrade, number> = { A: 0, B: 0, C: 0, 가정: 0 };
  let evalMin = 0;
  for (const b of inp.blocks) {
    if (!b.countable || b.expected === null || !b.grade) continue;
    byGradeMin[b.grade] += minutes(b);
    evalMin += minutes(b);
  }
  const byGrade: Record<EvidenceGrade, number> = { A: 0, B: 0, C: 0, 가정: 0 };
  for (const g of Object.keys(byGradeMin) as EvidenceGrade[]) byGrade[g] = evalMin > 0 ? byGradeMin[g] / evalMin : 0;
  const insufficientShare = evalMin > 0 ? byGrade.C + byGrade.가정 : null;

  // 하방: 바뀐 칸 중 기준안보다 낮은 칸
  const baseBySlot = new Map(inp.baseline.map((b) => [slotKey(b), b]));
  let lowerSlots = 0;
  let worst: number | null = null;
  for (const b of changed) {
    const o = baseBySlot.get(slotKey(b));
    if (!o || o.expected === null || b.expected === null) continue;
    const d = b.expected - o.expected;
    if (d < 0) {
      lowerSlots++;
      worst = worst === null ? d : Math.min(worst, d);
    }
  }

  const rb = inp.robustness;
  const scenario: PlanCard["scenario"] = rb && !isBase ? { p10Pct: rb.p10, p50Pct: rb.p50, p90Pct: rb.p90, pPositive: rb.pPositive, scenarios: rb.scenarios } : null;

  const cautions: string[] = [];
  if (!isBase) {
    if (insufficientShare !== null && insufficientShare >= CARD_NOTICE.insufficientEvidenceShare) cautions.push(`근거 부족(장르·채널 평균 추정 또는 가정) 비중이 ${(insufficientShare * 100).toFixed(0)}%입니다 — 점추정이 낙관적일 수 있습니다.`);
    if (scenario && scenario.pPositive !== null && scenario.pPositive < CARD_NOTICE.pPositiveMin) cautions.push(`검증 오차를 반영한 시나리오 중 개선이 유지되는 비율이 ${(scenario.pPositive * 100).toFixed(0)}%입니다.`);
    if (scenario && scenario.p10Pct !== null && scenario.p10Pct <= 0) cautions.push("하위 10% 시나리오에서는 기준안보다 낮거나 같습니다.");
    if (lowerSlots > 0) cautions.push(`바뀐 칸 중 ${lowerSlots}칸은 기준안보다 기대값이 낮습니다(가장 큰 하락 ${worst !== null ? worst.toFixed(3) : "-"}%p).`);
  }
  if (overdrawn > 0) cautions.push(`공유 권리 ${overdrawn}건은 편성 횟수가 잔여 횟수를 넘습니다.`);
  if (counts.unavailable > 0) cautions.push(`권리상 불가인 칸이 ${counts.unavailable}칸 있습니다.`);

  return {
    kind: inp.kind,
    label: PLAN_LABEL[inp.kind],
    planVersion: inp.planVersion,
    weekly,
    vsBaseline,
    scenario,
    change: { blocks: changed.length, slots: new Set(changed.map(slotKey)).size, minutes: changedMinutes, shareOfMinutes: baseMinutes > 0 ? changedMinutes / baseMinutes : null },
    repeat: { repeatedAirings, repeatedPrograms, maxWeekly },
    required: inp.required,
    hardViolations: inp.hardViolations,
    rights: { counts, confirmedShare: subjectMin > 0 ? confirmedMin / subjectMin : null, consumption: { pools: pools.size, uses, overdrawn, atLimit } },
    evidence: { insufficientShare, byGrade },
    downside: { lowerSlots, worstPp: worst },
    claims: { bestExpected: false, optimalProven: false, note: inp.searched ? "탐색된 최선안입니다 — 이보다 좋은 안이 없다는 증명은 없습니다." : "엔진이 계산한 기준 편성입니다." },
    cautions,
  };
}

/** 카드 묶음: 기대값이 가장 높은 안에만 "최고 기대안" 표지를 달고, 어느 안도 "최적 증명"을 달지 않는다. */
export function buildPlanCards(inputs: PlanCardInput[]): PlanCard[] {
  const cards = PLAN_ORDER.map((k) => inputs.find((i) => i.kind === k)).filter((i): i is PlanCardInput => !!i).map(buildPlanCard);
  let best: PlanCard | null = null;
  for (const c of cards) {
    if (c.kind === "BASELINE" || c.vsBaseline?.diffPp === null || c.vsBaseline?.diffPp === undefined) continue;
    if (!best || (c.vsBaseline.diffPp as number) > (best.vsBaseline?.diffPp as number) + 1e-12) best = c;
  }
  if (best && (best.vsBaseline?.diffPp as number) > 0) {
    best.claims = { ...best.claims, bestExpected: true, note: `이 비교에서 모델상 기대값이 가장 높은 안입니다. ${best.claims.note}` };
  }
  return cards;
}
