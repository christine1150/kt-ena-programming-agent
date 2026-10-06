// OPT04 — 탐색 방법 비교용 소형 문제 구현(순수 함수, 난수는 시드 고정). 운영 엔진(optimizer.ts)의 대체물이 아니라
// "정답을 아는 작은 문제"에서 어떤 탐색 방법이 정답에 얼마나 가까운지 재는 실험 도구다.
//
// 목적함수(분 가중): score = Σ 길이 × (기대 시청률 + 앞 편성과의 연속 가산). 연속 가산은 운영 엔진의 lead 연관(앞 편성 → 이 편성)을
// 단순화한 것으로, 슬롯별 독립 합이 아닌 "이웃 상호작용"이 있을 때 탐욕·국소탐색이 정답을 놓치는 정도를 보기 위해 넣는다.
// 하드 제약은 exactSolver.validatePlan이 판정한다(어떤 방법이 낸 해든 같은 기준으로 유효성을 확인).
import { validatePlan, type Plan, type Problem, type ProblemCandidate, type ProblemSlot, horizonMinutes } from "./exactSolver";

export interface SearchProblem {
  problem: Problem;
  /** 앞 편성(prev, 같은 날이 아니어도 시간순 바로 앞) → 이 편성(cur)의 연속 가산(%). 없으면 0. */
  adjacency?: (prev: ProblemCandidate, cur: ProblemCandidate) => number;
}

export interface MethodResult {
  plan: Plan | null;
  score: number | null;
  /** 점수 계산 횟수(비용 비교용) */
  evals: number;
}

const EPS = 1e-9;
const lenOf = (s: ProblemSlot) => s.endMin - s.startMin;
const orderedSlots = (p: Problem) => [...p.slots].sort((a, b) => a.dow - b.dow || a.startMin - b.startMin || (a.id < b.id ? -1 : 1));
const sortedCands = (p: Problem) => [...p.candidates].sort((a, b) => (a.id < b.id ? -1 : 1));

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 계획 점수(분×%). 평가 불가(null) 후보·빈 슬롯은 0점으로 두되 유효성 검사가 따로 거른다. */
export function scorePlan(sp: SearchProblem, plan: Plan): number {
  const slots = orderedSlots(sp.problem);
  const byId = new Map(sp.problem.candidates.map((c) => [c.id, c]));
  let sum = 0;
  let prev: ProblemCandidate | null = null;
  for (const s of slots) {
    const cid = plan[s.id] ?? null;
    const c = cid ? (byId.get(cid) ?? null) : null;
    if (c) {
      const e = sp.problem.expected(s, c);
      sum += lenOf(s) * ((e ?? 0) + (prev && sp.adjacency ? sp.adjacency(prev, c) : 0));
    }
    prev = c;
  }
  return sum;
}

export const isValid = (sp: SearchProblem, plan: Plan): boolean => validatePlan(sp.problem, plan).length === 0;

/** 앞 i+1개 슬롯까지의 부분 배정이 이미 어긴 하드 제약이 있는가(빈 슬롯·잠금은 아직 판단하지 않음). */
function partialViolates(p: Problem, plan: Plan, slots: ProblemSlot[], i: number): boolean {
  const sub: Problem = { ...p, slots: slots.slice(0, i + 1), constraints: { ...p.constraints, allowEmpty: true, locks: [] } };
  const part: Plan = {};
  for (const s of sub.slots) part[s.id] = plan[s.id] ?? null;
  return validatePlan(sub, part).length > 0;
}

/** 슬롯 i에 놓을 수 있는 후보(평가 가능·허용·잠금 반영). 다른 슬롯과의 한도 충돌은 여기서 보지 않는다. */
function optionsAt(p: Problem, s: ProblemSlot): ProblemCandidate[] {
  const lock = (p.constraints.locks ?? []).find((l) => l.slotId === s.id);
  return sortedCands(p).filter((c) => (!lock || c.id === lock.candId) && p.expected(s, c) !== null && (p.constraints.allowed?.(s, c) ?? true) === true);
}

// ── 정답(완전탐색, 이웃 가산 포함) ─────────────────────────────────
export function solveExactAdj(sp: SearchProblem): MethodResult {
  const p = sp.problem;
  const slots = orderedSlots(p);
  const opts = slots.map((s) => optionsAt(p, s));
  const maxAdj = (c: ProblemCandidate) => (sp.adjacency ? Math.max(0, ...p.candidates.map((q) => sp.adjacency!(q, c))) : 0);
  // 낙관 상한: 슬롯별 (최고 기대 + 최고 연속 가산) × 길이의 합 — 실제보다 작을 수 없다
  const best1 = opts.map((o, i) => (o.length ? Math.max(...o.map((c) => (p.expected(slots[i], c) as number) + maxAdj(c))) * lenOf(slots[i]) : 0));
  const suffix = new Array(slots.length + 1).fill(0);
  for (let i = slots.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + best1[i];
  let best: { plan: Plan; score: number } | null = null;
  let evals = 0;
  const plan: Plan = {};
  const rec = (i: number, sum: number, prev: ProblemCandidate | null) => {
    if (best && sum + suffix[i] <= best.score + 1e-12) return;
    if (i === slots.length) {
      if (validatePlan(p, plan).length === 0 && (!best || sum > best.score + 1e-12)) best = { plan: { ...plan }, score: sum };
      return;
    }
    for (const c of opts[i]) {
      plan[slots[i].id] = c.id;
      if (!partialViolates(p, plan, slots, i)) {
        evals++;
        rec(i + 1, sum + lenOf(slots[i]) * ((p.expected(slots[i], c) as number) + (prev && sp.adjacency ? sp.adjacency(prev, c) : 0)), c);
      }
      delete plan[slots[i].id];
    }
  };
  rec(0, 0, null);
  const f = best as { plan: Plan; score: number } | null;
  return { plan: f?.plan ?? null, score: f?.score ?? null, evals };
}

// ── 탐욕 구성 ─────────────────────────────────────────────────────
/** 시간순으로 슬롯을 보며 (기대 + 앞 편성과의 연속 가산)이 가장 큰 유효 후보를 고른다. 이웃 가산을 앞쪽만 본다. */
export function methodGreedy(sp: SearchProblem, order?: number[]): MethodResult {
  const p = sp.problem;
  const slots = orderedSlots(p);
  const plan: Plan = {};
  let evals = 0;
  const visit = order ?? slots.map((_, i) => i);
  for (const i of visit) {
    const s = slots[i];
    let pick: { id: string; v: number } | null = null;
    for (const c of optionsAt(p, s)) {
      plan[s.id] = c.id;
      // 아직 채우지 않은 슬롯이 있어도 부분 위반만 본다(순서가 시간순이 아니어도 동작하도록 채운 슬롯만 모은다)
      const filled = slots.filter((x) => plan[x.id] !== undefined);
      const sub: Problem = { ...p, slots: filled, constraints: { ...p.constraints, allowEmpty: true, locks: [] } };
      const ok = validatePlan(sub, Object.fromEntries(filled.map((x) => [x.id, plan[x.id] ?? null]))).length === 0;
      delete plan[s.id];
      if (!ok) continue;
      const prevSlot = slots[i - 1];
      const prevC = prevSlot && plan[prevSlot.id] ? p.candidates.find((q) => q.id === plan[prevSlot.id]) : null;
      evals++;
      const v = (p.expected(s, c) as number) + (prevC && sp.adjacency ? sp.adjacency(prevC, c) : 0);
      if (!pick || v > pick.v + EPS) pick = { id: c.id, v };
    }
    if (pick) plan[s.id] = pick.id;
  }
  const done = Object.keys(plan).length === slots.length && isValid(sp, plan);
  return { plan: done ? plan : null, score: done ? scorePlan(sp, plan) : null, evals };
}

// ── 국소탐색(운영 엔진과 같은 이웃: 교체 → 맞교환) ──────────────────
export function improve(sp: SearchProblem, start: Plan, opts: { swap: boolean }): MethodResult {
  const p = sp.problem;
  const slots = orderedSlots(p);
  const lockIds = new Set((p.constraints.locks ?? []).map((l) => l.slotId));
  const plan: Plan = { ...start };
  let cur = scorePlan(sp, plan);
  let evals = 1;
  let improved = true;
  while (improved) {
    improved = false;
    for (const s of slots) {
      if (lockIds.has(s.id)) continue;
      const saved = plan[s.id];
      for (const c of optionsAt(p, s)) {
        if (c.id === saved) continue;
        plan[s.id] = c.id;
        if (isValid(sp, plan)) {
          const v = scorePlan(sp, plan);
          evals++;
          if (v > cur + EPS) {
            cur = v;
            improved = true;
            break;
          }
        }
        plan[s.id] = saved;
      }
    }
    if (!opts.swap) continue;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i].id;
        const b = slots[j].id;
        if (lockIds.has(a) || lockIds.has(b) || plan[a] === plan[b]) continue;
        const [ca, cb] = [plan[a], plan[b]];
        plan[a] = cb;
        plan[b] = ca;
        if (isValid(sp, plan)) {
          const v = scorePlan(sp, plan);
          evals++;
          if (v > cur + EPS) {
            cur = v;
            improved = true;
            continue;
          }
        }
        plan[a] = ca;
        plan[b] = cb;
      }
    }
  }
  return { plan, score: cur, evals };
}

export function methodLocal(sp: SearchProblem, opts: { swap: boolean }): MethodResult {
  const g = methodGreedy(sp);
  if (!g.plan) return g;
  const r = improve(sp, g.plan, opts);
  return { ...r, evals: r.evals + g.evals };
}

// ── 다중 시작(시드 고정) ──────────────────────────────────────────
/** 시작 0은 탐욕, 나머지는 시드로 섞은 슬롯 순서의 무작위 유효 구성. 각각 교체+맞교환으로 다듬어 최고를 고른다. */
export function methodMultiStart(sp: SearchProblem, starts: number, seed: number): MethodResult {
  const p = sp.problem;
  const slots = orderedSlots(p);
  const rnd = mulberry(seed);
  let best: MethodResult = { plan: null, score: null, evals: 0 };
  let evals = 0;
  for (let k = 0; k < starts; k++) {
    let start: Plan | null = null;
    if (k === 0) start = methodGreedy(sp).plan;
    else {
      // 무작위 구성: 슬롯 순서를 섞고, 각 슬롯에 유효 후보 중 무작위 하나
      const order = slots.map((_, i) => i).sort(() => rnd() - 0.5);
      const plan: Plan = {};
      let ok = true;
      for (const i of order) {
        const s = slots[i];
        const cs = optionsAt(p, s).filter((c) => {
          plan[s.id] = c.id;
          const filled = slots.filter((x) => plan[x.id] !== undefined);
          const sub: Problem = { ...p, slots: filled, constraints: { ...p.constraints, allowEmpty: true, locks: [] } };
          const v = validatePlan(sub, Object.fromEntries(filled.map((x) => [x.id, plan[x.id] ?? null]))).length === 0;
          delete plan[s.id];
          return v;
        });
        if (!cs.length) {
          ok = false;
          break;
        }
        plan[s.id] = cs[Math.floor(rnd() * cs.length)].id;
      }
      start = ok && isValid(sp, plan) ? plan : null;
    }
    if (!start) continue;
    const r = improve(sp, start, { swap: true });
    evals += r.evals;
    if (r.plan && (best.score === null || (r.score as number) > best.score + EPS)) best = { plan: r.plan, score: r.score, evals: 0 };
  }
  return { ...best, evals };
}

// ── 빔 탐색 ───────────────────────────────────────────────────────
export function methodBeam(sp: SearchProblem, width: number): MethodResult {
  const p = sp.problem;
  const slots = orderedSlots(p);
  const opts = slots.map((s) => optionsAt(p, s));
  let beam: { plan: Plan; score: number; last: ProblemCandidate | null }[] = [{ plan: {}, score: 0, last: null }];
  let evals = 0;
  for (let i = 0; i < slots.length; i++) {
    const next: typeof beam = [];
    for (const st of beam) {
      for (const c of opts[i]) {
        const plan = { ...st.plan, [slots[i].id]: c.id };
        if (partialViolates(p, plan, slots, i)) continue;
        evals++;
        const gain = lenOf(slots[i]) * ((p.expected(slots[i], c) as number) + (st.last && sp.adjacency ? sp.adjacency(st.last, c) : 0));
        next.push({ plan, score: st.score + gain, last: c });
      }
    }
    // 동률은 plan 문자열 순으로 결정론
    next.sort((a, b) => b.score - a.score || (JSON.stringify(a.plan) < JSON.stringify(b.plan) ? -1 : 1));
    beam = next.slice(0, width);
    if (!beam.length) return { plan: null, score: null, evals };
  }
  const done = beam.find((b) => isValid(sp, b.plan));
  return { plan: done?.plan ?? null, score: done?.score ?? null, evals };
}

export { horizonMinutes };
