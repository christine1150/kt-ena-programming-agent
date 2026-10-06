// 소형 편성 문제의 완전탐색 정답기·검증기(OPT03) — 순수 함수. 운영 엔진이 아니라 "정답을 아는 작은 문제"로 탐색기·검증기를 시험하기 위한 도구다.
//
// 모델: 슬롯(시간순) × 후보 배정. 목적 = 주간 기대 시청률 R̂ = Σ(슬롯 길이 × 기대 시청률) ÷ 계획 horizon(모든 슬롯 길이의 합).
//  · 기대값이 없는(null) 후보는 그 슬롯에 놓을 수 없다(예측 불가를 0이나 평균으로 채우지 않는다).
//  · 모든 편성안은 같은 horizon 분모로 평가한다(좋은 구간만 평균내지 않는다).
// 하드 제약(모두 출처 source를 달고 충돌 이유로 돌려준다): 허용 슬롯(Avail·채널·기간·만료 경계), 잠금·필수·고정 본방, 프로그램 주간 한도,
//  공유 풀 잔여 횟수, 연속 최대 길이, 재방 최소 간격, 회차 순서, 빈 슬롯 금지.
// 계약에 없는 규칙을 임의로 만들지 않는다 — 제약은 호출자가 source와 함께 명시한 것만 적용한다.

export interface ProblemSlot {
  id: string;
  dow: number;
  startMin: number;
  endMin: number;
}
export interface ProblemCandidate {
  id: string;
  programKey: string;
  /** 여러 후보·채널이 함께 쓰는 한도 묶음 */
  poolKey?: string;
  /** 회차(같은 series의 no가 시간 순으로 증가해야 함) */
  episode?: { series: string; no: number };
}
export interface Reason {
  constraintId: string;
  source: string;
  message: string;
}
export interface Sourced<T> {
  value: T;
  source: string;
}
export interface HardConstraints {
  /** 이 슬롯에 이 후보를 놓아도 되는가. 안 되면 사유 객체를 돌려준다 */
  allowed?: (slot: ProblemSlot, cand: ProblemCandidate) => true | Reason;
  /** 잠금·필수·고정 본방 — 슬롯은 반드시 이 후보여야 한다 */
  locks?: { slotId: string; candId: string; source: string; kind: "LOCK" | "REQUIRED" | "FIXED_PREMIERE" }[];
  maxPerProgram?: Record<string, Sourced<number>>;
  /** 후보(회차·버전) 하나를 쓸 수 있는 횟수 — 한 회차는 한 번만 방송하는 경우 등 */
  maxPerCandidate?: Record<string, Sourced<number>>;
  maxPerPool?: Record<string, Sourced<number>>;
  /** 같은 프로그램이 시간순으로 이어서 놓일 수 있는 최대 슬롯 수 */
  maxConsecutive?: Record<string, Sourced<number>>;
  /** 같은 프로그램 두 방영 사이에 최소로 떨어져야 하는 슬롯 수(0이면 제한 없음) */
  minGapSlots?: Record<string, Sourced<number>>;
  /** 같은 series의 회차는 시간 순서대로 증가 */
  episodeOrder?: { source: string };
  /** 빈 슬롯을 허용하는가(기본 false: 모든 슬롯을 채운다) */
  allowEmpty?: boolean;
}
export interface Problem {
  slots: ProblemSlot[];
  candidates: ProblemCandidate[];
  /** 슬롯·후보의 기대 시청률(%). null = 예측 불가 */
  expected: (slot: ProblemSlot, cand: ProblemCandidate) => number | null;
  constraints: HardConstraints;
}
export type Plan = Record<string, string | null>; // slotId → candId(null = 빈 슬롯)

export interface Violation {
  constraintId: string;
  source: string;
  slotIds: string[];
  message: string;
}

const ordered = (p: Problem) => [...p.slots].sort((a, b) => a.dow - b.dow || a.startMin - b.startMin || (a.id < b.id ? -1 : 1));
const lenOf = (s: ProblemSlot) => s.endMin - s.startMin;
const candOf = (p: Problem, id: string) => p.candidates.find((c) => c.id === id);

/** 계획 horizon(분) — 모든 슬롯 길이의 합. 모든 편성안이 같은 분모를 쓴다. */
export const horizonMinutes = (p: Problem) => p.slots.reduce((s, x) => s + lenOf(x), 0);

/** 편성안 평가: R̂ = Σ(길이 × 기대) ÷ horizon. 빈 슬롯·평가 불가 슬롯은 분모에는 남고 분자에는 0으로 들어간다(삭제하지 않는다). */
export function objectiveOf(p: Problem, plan: Plan): { rating: number; sum: number; horizon: number; unevaluatedMinutes: number } {
  const horizon = horizonMinutes(p);
  let sum = 0;
  let unevaluated = 0;
  for (const s of p.slots) {
    const cid = plan[s.id] ?? null;
    const c = cid ? candOf(p, cid) : null;
    const e = c ? p.expected(s, c) : null;
    if (e === null) unevaluated += lenOf(s);
    else sum += lenOf(s) * e;
  }
  return { rating: horizon > 0 ? sum / horizon : 0, sum, horizon, unevaluatedMinutes: unevaluated };
}

/** 하드 제약 위반 목록. 비어 있으면 유효한 편성안이다. 점수가 높아도 위반이 있으면 거부해야 한다. */
export function validatePlan(p: Problem, plan: Plan): Violation[] {
  const out: Violation[] = [];
  const slots = ordered(p);
  const c = p.constraints;
  const byId = new Map(p.candidates.map((x) => [x.id, x]));
  const assigned = slots.map((s) => ({ s, cand: plan[s.id] ? (byId.get(plan[s.id] as string) ?? null) : null, raw: plan[s.id] ?? null }));
  for (const a of assigned) {
    if (a.raw !== null && !a.cand) out.push({ constraintId: "UNKNOWN_CANDIDATE", source: "problem", slotIds: [a.s.id], message: `알 수 없는 후보 ${a.raw}` });
    if (a.raw === null && !c.allowEmpty) out.push({ constraintId: "EMPTY_SLOT", source: "problem", slotIds: [a.s.id], message: "빈 슬롯(채우지 않음)" });
    if (a.cand) {
      const e = p.expected(a.s, a.cand);
      if (e === null) out.push({ constraintId: "UNEVALUABLE", source: "model", slotIds: [a.s.id], message: `${a.cand.id}의 이 슬롯 기대값이 없어(예측 불가) 배치할 수 없음` });
      const al = c.allowed?.(a.s, a.cand);
      if (al && al !== true) out.push({ constraintId: al.constraintId, source: al.source, slotIds: [a.s.id], message: al.message });
    }
  }
  for (const lk of c.locks ?? []) {
    if ((plan[lk.slotId] ?? null) !== lk.candId) out.push({ constraintId: lk.kind, source: lk.source, slotIds: [lk.slotId], message: `${lk.slotId}는 ${lk.candId}로 고정(${lk.kind})` });
  }
  const countBy = (keyOf: (x: ProblemCandidate) => string | undefined) => {
    const m = new Map<string, string[]>();
    for (const a of assigned) {
      const k = a.cand ? keyOf(a.cand) : undefined;
      if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(a.s.id);
    }
    return m;
  };
  for (const [k, ids] of countBy((x) => x.programKey)) {
    const lim = c.maxPerProgram?.[k];
    if (lim && ids.length > lim.value) out.push({ constraintId: "MAX_PER_PROGRAM", source: lim.source, slotIds: ids, message: `${k}는 주 ${lim.value}회까지(현재 ${ids.length}회)` });
  }
  for (const [k, ids] of countBy((x) => x.id)) {
    const lim = c.maxPerCandidate?.[k];
    if (lim && ids.length > lim.value) out.push({ constraintId: "MAX_PER_CANDIDATE", source: lim.source, slotIds: ids, message: `${k}는 ${lim.value}회까지(현재 ${ids.length}회)` });
  }
  for (const [k, ids] of countBy((x) => x.poolKey)) {
    const lim = c.maxPerPool?.[k];
    if (lim && ids.length > lim.value) out.push({ constraintId: "MAX_PER_POOL", source: lim.source, slotIds: ids, message: `공유 풀 ${k}는 ${lim.value}회까지(현재 ${ids.length}회)` });
  }
  // 연속·재방 간격은 시간순 인접 슬롯 기준(요일이 바뀌어도 슬롯 순서로 인접)
  const keys = assigned.map((a) => a.cand?.programKey ?? null);
  for (const [k, lim] of Object.entries(c.maxConsecutive ?? {})) {
    let run = 0;
    let runIds: string[] = [];
    keys.forEach((kk, i) => {
      if (kk === k) {
        run++;
        runIds.push(assigned[i].s.id);
        if (run > lim.value) out.push({ constraintId: "MAX_CONSECUTIVE", source: lim.source, slotIds: [...runIds], message: `${k}는 연속 ${lim.value}슬롯까지(현재 ${run})` });
      } else {
        run = 0;
        runIds = [];
      }
    });
  }
  for (const [k, lim] of Object.entries(c.minGapSlots ?? {})) {
    let last = -Infinity;
    keys.forEach((kk, i) => {
      if (kk !== k) return;
      if (i - last - 1 < lim.value && last !== -Infinity) out.push({ constraintId: "MIN_GAP", source: lim.source, slotIds: [assigned[last].s.id, assigned[i].s.id], message: `${k} 재방 간격 ${lim.value}슬롯 미만` });
      last = i;
    });
  }
  if (c.episodeOrder) {
    const lastNo = new Map<string, { no: number; slotId: string }>();
    for (const a of assigned) {
      const ep = a.cand?.episode;
      if (!ep) continue;
      const prev = lastNo.get(ep.series);
      if (prev && ep.no < prev.no) out.push({ constraintId: "EPISODE_ORDER", source: c.episodeOrder.source, slotIds: [prev.slotId, a.s.id], message: `${ep.series} ${ep.no}회가 ${prev.no}회보다 늦게 방송되어야 하는데 앞섬` });
      lastNo.set(ep.series, { no: Math.max(ep.no, prev?.no ?? ep.no), slotId: a.s.id });
    }
  }
  return out;
}

export interface SolveResult {
  /** OPTIMAL = 전체 탐색을 끝내 정답임을 증명 / SEARCHED_BEST = 탐색 한도에서 멈춘 최선안(최적 증명 없음) / INFEASIBLE = 유효한 편성안 없음 */
  status: "OPTIMAL" | "SEARCHED_BEST" | "INFEASIBLE";
  plan: Plan | null;
  rating: number | null;
  explored: number;
}

/** 시간순 DFS 완전탐색. 낙관 상한(남은 슬롯의 개별 최고값 합)으로 가지치기하며 정답을 보장한다(maxNodes 안에서 끝낼 때만 OPTIMAL). */
export function solveExact(p: Problem, opts: { maxNodes?: number } = {}): SolveResult {
  const slots = ordered(p);
  const horizon = horizonMinutes(p);
  const maxNodes = opts.maxNodes ?? 2_000_000;
  const cands = [...p.candidates].sort((a, b) => (a.id < b.id ? -1 : 1));
  const lockBySlot = new Map((p.constraints.locks ?? []).map((l) => [l.slotId, l]));
  // 슬롯별 개별 후보 목록(허용·평가 가능한 것만) — 상한 계산·탐색 공용
  const options = slots.map((s) => {
    const lock = lockBySlot.get(s.id);
    const list = (lock ? cands.filter((c) => c.id === lock.candId) : cands).filter((c) => p.expected(s, c) !== null && (p.constraints.allowed?.(s, c) ?? true) === true);
    return list.map((c) => ({ c, e: p.expected(s, c) as number }));
  });
  const bestPerSlot = options.map((o, i) => (o.length ? Math.max(...o.map((x) => x.e)) * lenOf(slots[i]) : p.constraints.allowEmpty ? 0 : -Infinity));
  const suffix: number[] = new Array(slots.length + 1).fill(0);
  for (let i = slots.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + bestPerSlot[i];
  let best: { sum: number; plan: Plan } | null = null;
  let explored = 0;
  let cut = false;
  const plan: Plan = {};
  const rec = (i: number, sum: number) => {
    if (cut) return;
    if (++explored > maxNodes) {
      cut = true;
      return;
    }
    if (best && sum + suffix[i] <= best.sum + 1e-12) return; // 상한으로 가지치기(동률은 먼저 찾은 해 유지 → 결정적)
    if (i === slots.length) {
      if (validatePlan(p, plan).length === 0 && (!best || sum > best.sum + 1e-12)) best = { sum, plan: { ...plan } };
      return;
    }
    const s = slots[i];
    for (const o of options[i]) {
      plan[s.id] = o.c.id;
      // 부분 배정이 이미 위반이면 가지치기(빈 슬롯 위반은 아직 채우지 않은 슬롯이라 무시)
      const partial = validatePartial(p, plan, slots, i);
      if (!partial) rec(i + 1, sum + o.e * lenOf(s));
      delete plan[s.id];
    }
    if (p.constraints.allowEmpty && !lockBySlot.has(s.id)) {
      plan[s.id] = null;
      rec(i + 1, sum);
      delete plan[s.id];
    }
  };
  rec(0, 0);
  const found = best as { sum: number; plan: Plan } | null;
  if (!found) return { status: cut ? "SEARCHED_BEST" : "INFEASIBLE", plan: null, rating: null, explored };
  return { status: cut ? "SEARCHED_BEST" : "OPTIMAL", plan: found.plan, rating: horizon > 0 ? found.sum / horizon : 0, explored };
}

/** 앞 i+1개 슬롯까지의 부분 배정이 이미 어길 수 없는 제약(한도·연속·간격·순서·허용)을 어겼는가. */
function validatePartial(p: Problem, plan: Plan, slots: ProblemSlot[], i: number): boolean {
  const sub: Problem = { ...p, slots: slots.slice(0, i + 1), constraints: { ...p.constraints, allowEmpty: true, locks: [] } };
  const partialPlan: Plan = {};
  for (const s of sub.slots) partialPlan[s.id] = plan[s.id] ?? null;
  return validatePlan(sub, partialPlan).length > 0;
}

/** 슬롯을 시간순으로 보며 허용되는 후보 중 기대값이 가장 높은 것을 고르는 탐욕 배정 — 주간 최선이 아닐 수 있다(반례 시험용). */
export function greedyPlan(p: Problem): Plan {
  const slots = ordered(p);
  const plan: Plan = {};
  const lockBySlot = new Map((p.constraints.locks ?? []).map((l) => [l.slotId, l]));
  for (const s of slots) {
    const lock = lockBySlot.get(s.id);
    if (lock) {
      plan[s.id] = lock.candId;
      continue;
    }
    let pick: { id: string; e: number } | null = null;
    const sortedCands = [...p.candidates].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const c of sortedCands) {
      const e = p.expected(s, c);
      if (e === null || (p.constraints.allowed?.(s, c) ?? true) !== true) continue;
      plan[s.id] = c.id;
      const ok = !validatePartial(p, plan, slots, slots.findIndex((x) => x.id === s.id));
      delete plan[s.id];
      if (ok && (!pick || e > pick.e)) pick = { id: c.id, e };
    }
    plan[s.id] = pick ? pick.id : null;
  }
  return plan;
}

/** 해가 없을 때 이유: 제약 묶음을 하나씩 풀어 보았을 때 해가 생기는 묶음과 그 출처를 알려 준다. 계약에 없는 사유를 지어내지 않는다. */
export function explainInfeasible(p: Problem): { feasible: boolean; blockers: { group: string; sources: string[] }[]; lockConflicts: { slotId: string; candId: string; lockSource: string; blockedBy: string }[] } {
  if (solveExact(p).status !== "INFEASIBLE") return { feasible: true, blockers: [], lockConflicts: [] };
  const c = p.constraints;
  // 잠금·필수가 가리키는 자리를 허용 슬롯 제약이 막고 있으면 두 출처를 함께 알려 준다(예: 필수 편성 ↔ Avail 불가)
  const lockConflicts: { slotId: string; candId: string; lockSource: string; blockedBy: string }[] = [];
  for (const lk of c.locks ?? []) {
    const s = p.slots.find((x) => x.id === lk.slotId);
    const cand = p.candidates.find((x) => x.id === lk.candId);
    const al = s && cand ? c.allowed?.(s, cand) : true;
    if (al && al !== true) lockConflicts.push({ slotId: lk.slotId, candId: lk.candId, lockSource: lk.source, blockedBy: al.source });
  }
  const allowedSources = [...new Set(p.slots.flatMap((s) => p.candidates.map((cd) => c.allowed?.(s, cd)).filter((r): r is Reason => !!r && r !== true).map((r) => r.source)))];
  const groups: { group: string; relaxed: HardConstraints; sources: string[] }[] = [
    { group: "허용 슬롯(Avail·채널·기간·만료 경계)", relaxed: { ...c, allowed: undefined }, sources: allowedSources },
    { group: "잠금·필수·고정 본방", relaxed: { ...c, locks: [] }, sources: (c.locks ?? []).map((l) => l.source) },
    { group: "프로그램 주간 한도", relaxed: { ...c, maxPerProgram: undefined }, sources: Object.values(c.maxPerProgram ?? {}).map((x) => x.source) },
    { group: "후보(회차) 사용 횟수", relaxed: { ...c, maxPerCandidate: undefined }, sources: Object.values(c.maxPerCandidate ?? {}).map((x) => x.source) },
    { group: "공유 풀 잔여 횟수", relaxed: { ...c, maxPerPool: undefined }, sources: Object.values(c.maxPerPool ?? {}).map((x) => x.source) },
    { group: "연속 최대 길이", relaxed: { ...c, maxConsecutive: undefined }, sources: Object.values(c.maxConsecutive ?? {}).map((x) => x.source) },
    { group: "재방 최소 간격", relaxed: { ...c, minGapSlots: undefined }, sources: Object.values(c.minGapSlots ?? {}).map((x) => x.source) },
    { group: "회차 순서", relaxed: { ...c, episodeOrder: undefined }, sources: c.episodeOrder ? [c.episodeOrder.source] : [] },
    { group: "빈 슬롯 금지", relaxed: { ...c, allowEmpty: true }, sources: ["problem"] },
  ];
  const blockers = groups.filter((g) => solveExact({ ...p, constraints: g.relaxed }).status !== "INFEASIBLE").map((g) => ({ group: g.group, sources: g.sources }));
  return { feasible: false, blockers, lockConflicts };
}
