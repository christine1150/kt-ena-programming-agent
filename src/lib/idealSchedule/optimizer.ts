// Global Weekly Optimization(설계 문서 G절) — 결정론적 구성 + 국소탐색. 난수 없음, 동률은 후보 key 순.
//
// KEEP_CURRENT(기존 틀 유지): 골격 슬롯에 후보를 배정(탐욕 구성 → 교체·맞교환 국소탐색).
// AI_OPTIMIZED(AI 시간 최적화): 요일별 빈 구간을 grid 단위 DP로 채움(블록 길이 = 프로그램 실측 runtime).
//   DP 상태는 위치별 "직전 프로그램이 서로 다른 상위 2개"만 보관해 연속 편성 패널티·lead 연관을 반영한다.
//   일·주 반복 cap은 초과 프로그램의 상위 배치만 고정하고 나머지를 금지한 뒤 그날 DP를 다시 푸는 방식으로 강제.
// 두 모드 모두 같은 Scorer·같은 목적함수(evaluateSchedule)를 쓰므로 결과 점수를 직접 비교할 수 있다.
//
// 반복 cap·연속 편성·같은 시 반복은 "프로그램" 단위(programKey — 본방/재방을 같은 프로그램으로 셈)로 판정한다.
// 목적함수 변화는 영향받는 요일(바뀐 블록의 요일 + 같은 프로그램이 놓인 요일)만 다시 평가해 계산한다 —
// 요일 간 상호작용은 "같은 시 반복" 하나뿐이라 전체 재평가와 결과가 같다.
import type { IdealScheduleConfig } from "./config";
import { freeIntervals, type ConstraintResolution } from "./constraints";
import { cutSkeletonByFixed, type SkeletonSlot } from "./skeleton";
import { Scorer, type BlockEval, type EngineCandidate } from "./scoring";
import { BROADCAST_DAY_END_MIN, BROADCAST_DAY_START_MIN, hourBucket } from "./time";
import { UNCLASSIFIED, genreFamily } from "./types";
import type { EpisodeAssignment } from "./episodes";

export type BlockStatus = "LOCKED" | "REQUIRED" | "AI" | "MANUAL_OVERRIDE";

export interface PlacedBlock {
  weekday: number;
  startMin: number;
  endMin: number;
  candidate: EngineCandidate;
  status: BlockStatus;
  fixed: boolean;
  constraint?: { id: string; source: string; constraintType: string; rank: number; durationDerived?: boolean };
  slotIndex?: number; // KEEP 모드 슬롯 번호
  episode?: EpisodeAssignment | { none: true; reason: string }; // 부제 반영 모드에서 배정된 에피소드
}

export interface EvaluatedBlock extends PlacedBlock {
  eval: BlockEval;
  timeChanged?: boolean;
  alternatives?: { candidate: EngineCandidate; eval: BlockEval }[];
}

export interface ScheduleEvaluation {
  blocks: EvaluatedBlock[];
  objective: number;
}

const EPS = 1e-9;

// ── 목적함수 ────────────────────────────────────────────────────────
function evaluateInternal(scorer: Scorer, blocks: PlacedBlock[], maxGapMin: number, days: Set<number> | null): ScheduleEvaluation {
  const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  const sameSlotDays = new Map<string, Set<number>>();
  for (const b of sorted) {
    const k = `${b.candidate.programKey}|${hourBucket(b.startMin)}`;
    (sameSlotDays.get(k) ?? sameSlotDays.set(k, new Set()).get(k)!).add(b.weekday);
  }
  const dayMinutes = new Map<number, number>();
  for (const b of sorted) dayMinutes.set(b.weekday, (dayMinutes.get(b.weekday) ?? 0) + (b.endMin - b.startMin));
  const genreShare = new Map<string, number>(); // "day|genre" → 비중
  for (const b of sorted) {
    if (b.candidate.genre === UNCLASSIFIED) continue;
    const k = `${b.weekday}|${genreFamily(b.candidate.genre)}`; // 장르 편중은 상위 묶음 기준
    genreShare.set(k, (genreShare.get(k) ?? 0) + (b.endMin - b.startMin) / (dayMinutes.get(b.weekday) || 1));
  }
  const out: EvaluatedBlock[] = [];
  let objective = 0;
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (days && !days.has(b.weekday)) continue;
    const prev = i > 0 && sorted[i - 1].weekday === b.weekday && b.startMin - sorted[i - 1].endMin <= maxGapMin ? sorted[i - 1] : null;
    const e = scorer.evaluate(b.candidate, {
      weekday: b.weekday,
      startMin: b.startMin,
      endMin: b.endMin,
      prevKey: prev?.candidate.key ?? null,
      prevProgramKey: prev?.candidate.programKey ?? null,
      fixed: b.fixed,
      sameSlotOtherDays: (sameSlotDays.get(`${b.candidate.programKey}|${hourBucket(b.startMin)}`)?.size ?? 1) - 1,
      dayGenreShare: b.candidate.genre === UNCLASSIFIED ? 0 : genreShare.get(`${b.weekday}|${genreFamily(b.candidate.genre)}`) ?? 0,
    });
    objective += e.value;
    out.push({ ...b, eval: e });
  }
  return { blocks: out, objective };
}

/** 스케줄 전체 평가: 요일별 정렬 → 직전 블록·그날 장르 비중·같은 시 반복 횟수를 계산해 블록마다 평가. */
export function evaluateSchedule(scorer: Scorer, blocks: PlacedBlock[], maxGapMin: number): ScheduleEvaluation {
  return evaluateInternal(scorer, blocks, maxGapMin, null);
}

/** 한 변경이 영향을 주는 요일: 바뀐 블록들의 요일 + 관련 프로그램이 "같은 시"에 놓인 요일(요일 간 상호작용은
 *  같은 시 반복 패널티뿐이므로 그 밖의 요일 값은 변하지 않는다). */
function affectedDays(blocks: PlacedBlock[], changed: PlacedBlock[], programKeys: string[]): Set<number> {
  const days = new Set(changed.map((b) => b.weekday));
  const keys = new Set(programKeys);
  const hours = new Set(changed.map((b) => hourBucket(b.startMin)));
  for (const b of blocks) if (keys.has(b.candidate.programKey) && hours.has(hourBucket(b.startMin))) days.add(b.weekday);
  return days;
}

/** 변경 적용 전후 목적함수 차이(영향 요일만 재평가). apply/revert는 호출부가 블록을 직접 바꾸는 함수. */
function deltaOf(scorer: Scorer, blocks: PlacedBlock[], maxGap: number, changed: PlacedBlock[], apply: () => void, revert: () => void, oldKeys: string[]) {
  apply();
  const newKeys = changed.map((b) => b.candidate.programKey);
  revert();
  const days = affectedDays(blocks, changed, [...oldKeys, ...newKeys]);
  const before = evaluateInternal(scorer, blocks, maxGap, days).objective;
  apply();
  const after = evaluateInternal(scorer, blocks, maxGap, days).objective;
  return after - before; // 적용된 상태로 반환 — 채택하지 않으면 호출부가 revert
}

// ── 공통 도우미 ─────────────────────────────────────────────────────
export interface EngineInput {
  mode: "KEEP_CURRENT" | "AI_OPTIMIZED";
  config: IdealScheduleConfig;
  scorer: Scorer;
  pool: EngineCandidate[];
  resolution: ConstraintResolution;
  fixedBlocks: PlacedBlock[]; // resolution.fixed를 후보로 변환한 것(LOCKED/REQUIRED/MANUAL_OVERRIDE)
  skeleton: SkeletonSlot[];
  archetypeRuntime: Map<string, number>; // 장르 → 자사 같은 장르 runtime 중앙값(AI 모드 원형 블록 길이)
  benchmarkMaxShare: number; // 경쟁 Benchmark·장르 원형이 차지할 수 있는 AI 편성 분 비율(0 = 배치 안 함)
  /** 프로그램별 일·주 한도 대체값(부제 반영 모드의 에피소드 시리즈 = 관측 최대 방영 수) */
  programCapOverride?: Map<string, { daily: number; weekly: number }>;
}

let capOverride: Map<string, { daily: number; weekly: number }> | undefined; // optimizeWeek 호출 동안만 설정

const isHypothetical = (c: EngineCandidate) => c.contentType !== "OWN";

/** 가상 후보(경쟁 Benchmark·장르 원형) 편성 분 예산 확인. */
function benchmarkBudgetOk(c: EngineCandidate, len: number, blocks: PlacedBlock[], budgetMin: number, ignore: PlacedBlock[] = []): boolean {
  if (!isHypothetical(c)) return true;
  const ign = new Set(ignore);
  let used = 0;
  for (const b of blocks) if (!b.fixed && !ign.has(b) && isHypothetical(b.candidate)) used += b.endMin - b.startMin;
  return used + len <= budgetMin + EPS;
}

export interface EngineOutput {
  mode: "KEEP_CURRENT" | "AI_OPTIMIZED";
  blocks: EvaluatedBlock[];
  objective: number;
  emptySlots: { weekday: number; startMin: number; endMin: number; reason: string }[];
  gaps: { weekday: number; startMin: number; endMin: number }[];
  localSearchMoves: number;
}

/** 반복 cap(프로그램 단위, 고정 블록 제외) + 후보 단위 주간 한도(본방): 이 후보를 weekday에 하나 더 놓아도 되는가. */
function capsOk(c: EngineCandidate, weekday: number, blocks: PlacedBlock[], config: IdealScheduleConfig, ignore: PlacedBlock[] = []): boolean {
  const ign = new Set(ignore);
  let day = 0;
  let week = 0;
  let sameUnit = 0;
  for (const b of blocks) {
    if (b.fixed || ign.has(b)) continue;
    if (b.candidate.key === c.key) sameUnit++;
    if (b.candidate.programKey !== c.programKey) continue;
    week++;
    if (b.weekday === weekday) day++;
  }
  if (c.weeklyLimit !== null && sameUnit + 1 > c.weeklyLimit) return false;
  const ov = capOverride?.get(c.programKey);
  return day + 1 <= (ov?.daily ?? config.repeat_rules.daily_cap) && week + 1 <= (ov?.weekly ?? config.repeat_rules.weekly_cap);
}

/** 블록 자리의 대체 후보 순위(Swap용) — 같은 자리에 넣었을 때의 블록 평가값 순. */
function alternativesFor(scorer: Scorer, blocks: PlacedBlock[], target: PlacedBlock, cands: EngineCandidate[], maxGap: number, topN: number) {
  const rows: { candidate: EngineCandidate; eval: BlockEval }[] = [];
  const original = target.candidate;
  const day = new Set([target.weekday]);
  for (const c of cands) {
    target.candidate = c;
    const ev = evaluateInternal(scorer, blocks, maxGap, day).blocks.find((b) => b.startMin === target.startMin);
    if (ev) rows.push({ candidate: c, eval: ev.eval });
  }
  target.candidate = original;
  // 순위: 자사 실측 기반 후보(OWN)를 먼저, 가정 기반 후보(경쟁 Benchmark·장르 원형)는 뒤에 별도로 — 가정값이
  // 실측 기반 후보보다 앞 순위로 섞이지 않게 한다(2026-09-30 API 점검).
  const byValue = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.eval.value - a.eval.value || (a.candidate.key < b.candidate.key ? -1 : 1);
  const own = rows.filter((r) => !isHypothetical(r.candidate)).sort(byValue).slice(0, topN);
  const hyp = rows.filter((r) => isHypothetical(r.candidate)).sort(byValue).slice(0, Math.ceil(topN / 2));
  return [...own, ...hyp];
}

// ── KEEP_CURRENT ────────────────────────────────────────────────────
/** 슬롯 후보. includeSuggestions=true면 배치 불가(제안 전용) 가상 후보까지 포함 — 대체 후보(Swap) 목록용. */
function slotCandidates(slot: SkeletonSlot, pool: EngineCandidate[], input: EngineInput, includeSuggestions = false): EngineCandidate[] {
  const len = slot.endMin - slot.startMin;
  const tol = input.config.structure.runtime_tolerance_min;
  const occupantKeys = new Set(slot.occupants.map((o) => o.key));
  const strong = input.scorer.ctx.strongSlots?.has(`${slot.weekday}|${hourBucket(slot.startMin)}`) ?? false;
  return pool.filter((c) => {
    const allowed = c.aiEligible || (includeSuggestions && isHypothetical(c));
    if (c.contentType === "ARCHETYPE") return strong && allowed;
    if (occupantKeys.has(c.key)) return true; // 현재 이 슬롯을 차지하는 프로그램은 표본이 적어도 후보(기존 틀 유지)
    return allowed && c.runtimeMin !== null && Math.abs(c.runtimeMin - len) <= tol;
  });
}

function optimizeKeepCurrent(input: EngineInput): EngineOutput {
  const { config, scorer } = input;
  scorer.detail = false;
  const maxGap = config.structure.max_gap_min;
  // 기존 틀 유지: 길이를 실측 중앙값으로 채운 고정 블록(주요 콘텐츠 자동 연동)이 같은 프로그램이 차지하던 골격
  // 슬롯에서 시작하면, 골격 슬롯 끝까지를 그 블록 자리로 본다 — 중앙값이 실제 슬롯보다 짧아 뒤에 몇 분짜리
  // 조각 슬롯이 생기고 거기에 같은 프로그램이 또 들어가던 문제(2026-09-30 실데이터 점검) 방지.
  const fixedBlocks = input.fixedBlocks.map((f) => {
    if (!f.constraint?.durationDerived) return f;
    const slot = input.skeleton.find(
      (s) => s.weekday === f.weekday && Math.abs(s.startMin - f.startMin) <= config.structure.grid_minutes && s.occupants.some((o) => o.key.startsWith(`${f.candidate.programKey}|`))
    );
    if (!slot || slot.endMin <= f.endMin) return f;
    const clash = input.fixedBlocks.some((o) => o !== f && o.weekday === f.weekday && o.startMin < slot.endMin && o.startMin >= f.endMin);
    return clash ? f : { ...f, endMin: slot.endMin };
  });
  const occupied = [...fixedBlocks, ...input.resolution.blockedZones];
  const slots = cutSkeletonByFixed(input.skeleton, occupied, config.structure.grid_minutes);
  const candsBySlot = slots.map((s) => slotCandidates(s, input.pool, input));
  const budgetMin = input.benchmarkMaxShare * slots.reduce((sum, s) => sum + (s.endMin - s.startMin), 0);

  const blocks: PlacedBlock[] = [...fixedBlocks];
  const assigned: (PlacedBlock | null)[] = slots.map(() => null);
  const emptySlots: EngineOutput["emptySlots"] = [];

  // 1) 탐욕 구성: 가치 큰 슬롯부터(슬롯 baseline × 길이), 동률은 요일·시각 순
  const baseOf = (s: SkeletonSlot) => (scorer.ctx.fs.rating.baseline(s.weekday, hourBucket(s.startMin)) ?? 0) * (s.endMin - s.startMin);
  const order = slots.map((_, i) => i).sort((a, b) => baseOf(slots[b]) - baseOf(slots[a]) || slots[a].weekday - slots[b].weekday || slots[a].startMin - slots[b].startMin);
  for (const i of order) {
    const s = slots[i];
    const pb: PlacedBlock = { weekday: s.weekday, startMin: s.startMin, endMin: s.endMin, candidate: candsBySlot[i][0], status: "AI", fixed: false, slotIndex: i };
    let best: { c: EngineCandidate; d: number } | null = null;
    for (const c of candsBySlot[i]) {
      if (!capsOk(c, s.weekday, blocks, config) || !benchmarkBudgetOk(c, s.endMin - s.startMin, blocks, budgetMin)) continue;
      pb.candidate = c;
      blocks.push(pb);
      const days = affectedDays(blocks, [pb], [c.programKey]);
      const withIt = evaluateInternal(scorer, blocks, maxGap, days).objective;
      blocks.pop();
      const without = evaluateInternal(scorer, blocks, maxGap, days).objective;
      const d = withIt - without;
      if (!best || d > best.d + EPS) best = { c, d };
    }
    if (!best) {
      emptySlots.push({ weekday: s.weekday, startMin: s.startMin, endMin: s.endMin, reason: candsBySlot[i].length === 0 ? "후보 없음" : "반복 cap 초과로 배치 가능한 후보 없음" });
      continue;
    }
    pb.candidate = best.c;
    blocks.push(pb);
    assigned[i] = pb;
  }

  // 2) 국소탐색: 교체 → 맞교환, 목적함수가 엄격히 좋아질 때만 채택
  let moves = 0;
  const maxIter = config.structure.max_local_search_iter;
  let improved = true;
  while (improved && moves < maxIter) {
    improved = false;
    for (let i = 0; i < slots.length && moves < maxIter; i++) {
      const cur = assigned[i];
      if (!cur) continue;
      for (const c of candsBySlot[i]) {
        if (c.key === cur.candidate.key || !capsOk(c, cur.weekday, blocks, config, [cur]) || !benchmarkBudgetOk(c, cur.endMin - cur.startMin, blocks, budgetMin, [cur])) continue;
        const saved = cur.candidate;
        const d = deltaOf(scorer, blocks, maxGap, [cur], () => (cur.candidate = c), () => (cur.candidate = saved), [saved.programKey]);
        if (d > EPS) {
          moves++;
          improved = true;
        } else cur.candidate = saved;
      }
    }
    for (let i = 0; i < slots.length && moves < maxIter; i++) {
      for (let j = i + 1; j < slots.length && moves < maxIter; j++) {
        const a = assigned[i];
        const b = assigned[j];
        if (!a || !b || a.candidate.programKey === b.candidate.programKey) continue;
        const ca = a.candidate;
        const cb = b.candidate;
        if (!candsBySlot[i].includes(cb) || !candsBySlot[j].includes(ca)) continue;
        const apply = () => {
          a.candidate = cb;
          b.candidate = ca;
        };
        const revert = () => {
          a.candidate = ca;
          b.candidate = cb;
        };
        if (!capsOk(cb, a.weekday, blocks, config, [a, b]) || !capsOk(ca, b.weekday, blocks, config, [a, b])) continue;
        if (!benchmarkBudgetOk(cb, a.endMin - a.startMin, blocks, budgetMin, [a, b]) || !benchmarkBudgetOk(ca, b.endMin - b.startMin, blocks, budgetMin, [a, b])) continue;
        const d = deltaOf(scorer, blocks, maxGap, [a, b], apply, revert, [ca.programKey, cb.programKey]);
        if (d > EPS) {
          moves++;
          improved = true;
        } else revert();
      }
    }
  }

  scorer.detail = true;
  const final = evaluateSchedule(scorer, blocks, maxGap);
  for (const eb of final.blocks) {
    if (eb.fixed || eb.slotIndex === undefined) continue;
    const src = assigned[eb.slotIndex]!;
    // 대체 후보(Swap용)는 배치 기준(길이 ±허용오차)보다 넓게: 편성 가능한 자사 프로그램 전체를 같은 자리에서 평가해
    // 길이 불일치 패널티가 반영된 순위로 보여준다(2026-09-30 화면 점검: 긴 슬롯은 후보가 1개뿐이라 교체할 수 없었음).
    const altPool = [...new Set([...slotCandidates(slots[eb.slotIndex], input.pool, input, true), ...input.pool.filter((c) => c.aiEligible && c.contentType === "OWN")])];
    eb.alternatives = alternativesFor(scorer, blocks, src, altPool, maxGap, 10);
  }
  return { mode: "KEEP_CURRENT", blocks: final.blocks, objective: final.objective, emptySlots, gaps: [], localSearchMoves: moves };
}

// ── AI_OPTIMIZED ────────────────────────────────────────────────────
interface DpEntry {
  value: number;
  gapRun: number; // 직전까지 이어진 여백 분(연속 여백 합계도 max_gap_min 이내)
  lastKey: string | null;
  lastProgramKey: string | null;
  prev: DpEntry | null;
  placed: { candidate: EngineCandidate; startMin: number; endMin: number } | null; // null = 여백
}

function runIntervalDp(
  weekday: number,
  interval: { startMin: number; endMin: number },
  cands: { c: EngineCandidate; len: number }[],
  input: EngineInput,
  prevAtStart: EngineCandidate | null,
  sameSlotCount: (programKey: string, hour: number) => number
): { placements: { candidate: EngineCandidate; startMin: number; endMin: number }[]; gaps: { startMin: number; endMin: number }[] } {
  const grid = input.config.structure.grid_minutes;
  const maxGap = input.config.structure.max_gap_min;
  const K = Math.floor((interval.endMin - interval.startMin) / grid);
  const pos = (k: number) => interval.startMin + k * grid;
  const best: DpEntry[][] = Array.from({ length: K + 1 }, () => []);
  const better = (x: DpEntry, y: DpEntry) => x.value > y.value + EPS || (Math.abs(x.value - y.value) <= EPS && String(x.lastKey) < String(y.lastKey));
  const insert = (k: number, e: DpEntry) => {
    // 위치별 상위 2개(직전 프로그램이 서로 다른 것) 유지 — 동률은 lastKey 순으로 결정론
    const list = best[k];
    const same = list.findIndex((x) => x.lastProgramKey === e.lastProgramKey);
    if (same >= 0) {
      if (better(e, list[same])) list[same] = e;
    } else list.push(e);
    list.sort((x, y) => (better(x, y) ? -1 : better(y, x) ? 1 : 0));
    if (list.length > 2) list.length = 2;
  };
  insert(0, { value: 0, gapRun: 0, lastKey: prevAtStart?.key ?? null, lastProgramKey: prevAtStart?.programKey ?? null, prev: null, placed: null });
  for (let j = 0; j <= K; j++) {
    for (const e of [...best[j]]) {
      for (let g = 1; e.gapRun + g * grid <= maxGap && j + g <= K; g++) {
        insert(j + g, { value: e.value, gapRun: e.gapRun + g * grid, lastKey: e.lastKey, lastProgramKey: e.lastProgramKey, prev: e, placed: null });
      }
      for (const { c, len } of cands) {
        const k = j + len / grid;
        if (k > K) continue;
        const startMin = pos(j);
        const endMin = startMin + len;
        const ev = input.scorer.evaluate(c, {
          weekday,
          startMin,
          endMin,
          prevKey: e.lastKey,
          prevProgramKey: e.lastProgramKey,
          fixed: false,
          sameSlotOtherDays: sameSlotCount(c.programKey, hourBucket(startMin)),
          dayGenreShare: 0, // 장르 편중은 DP 이후 전체 평가·국소탐색에서 반영
        });
        insert(k, { value: e.value + ev.value, gapRun: 0, lastKey: c.key, lastProgramKey: c.programKey, prev: e, placed: { candidate: c, startMin, endMin } });
      }
    }
  }
  // 끝까지 채운 해가 있으면 그것, 없으면(길이 조합이 안 맞음) 가치가 가장 큰 위치에서 멈추고 나머지를 여백으로
  let endK = K;
  if (best[K].length === 0) {
    endK = 0;
    for (let k = 0; k <= K; k++) if (best[k].length && (best[endK].length === 0 || best[k][0].value >= best[endK][0].value - EPS)) endK = k;
  }
  const placements: { candidate: EngineCandidate; startMin: number; endMin: number }[] = [];
  for (let e: DpEntry | null = best[endK][0] ?? null; e; e = e.prev) if (e.placed) placements.push(e.placed);
  placements.reverse();
  const gaps: { startMin: number; endMin: number }[] = [];
  let cursor = interval.startMin;
  for (const p of placements) {
    if (p.startMin > cursor) gaps.push({ startMin: cursor, endMin: p.startMin });
    cursor = p.endMin;
  }
  if (cursor < interval.endMin) gaps.push({ startMin: cursor, endMin: interval.endMin });
  return { placements, gaps };
}

function optimizeAiTimes(input: EngineInput): EngineOutput {
  const { config, scorer } = input;
  scorer.detail = false;
  const grid = config.structure.grid_minutes;
  const maxGap = config.structure.max_gap_min;
  const roundLen = (m: number) => Math.max(grid, Math.round(m / grid) * grid);
  const withLen = (c: EngineCandidate) => {
    const rt = c.contentType === "ARCHETYPE" ? input.archetypeRuntime.get(c.genre) ?? null : c.runtimeMin;
    return rt === null ? null : { c, len: roundLen(rt) };
  };
  const candLens = input.pool
    .filter((c) => c.aiEligible)
    .map(withLen)
    .filter((x): x is { c: EngineCandidate; len: number } => x !== null);
  // 제안 전용 가상 후보(경쟁 Benchmark·장르 원형) — 배치하지 않고 대체 후보 목록에만 넣는다
  const suggestLens = input.pool
    .filter((c) => !c.aiEligible && isHypothetical(c))
    .map(withLen)
    .filter((x): x is { c: EngineCandidate; len: number } => x !== null);

  // 가상 후보 편성 분 예산(MIX 모드): 주간 예산을 요일별 빈 시간 비율로 나눈다
  const occupiedForBudget = [...input.fixedBlocks, ...input.resolution.blockedZones];
  const freeByDay = new Map<number, number>();
  for (let d = 1; d <= 7; d++) {
    freeByDay.set(d, freeIntervals(d, BROADCAST_DAY_START_MIN, BROADCAST_DAY_END_MIN, occupiedForBudget).reduce((s, iv) => s + (iv.endMin - iv.startMin), 0));
  }
  const totalFree = [...freeByDay.values()].reduce((a, b) => a + b, 0);
  const weekBudget = input.benchmarkMaxShare * totalFree;

  const blocks: PlacedBlock[] = [...input.fixedBlocks];
  const gapsOut: EngineOutput["gaps"] = [];
  const weekCount = new Map<string, number>();
  const occupiedAll = [...input.fixedBlocks, ...input.resolution.blockedZones];

  for (let day = 1; day <= 7; day++) {
    const pins: PlacedBlock[] = [];
    const banned = new Set<string>();
    // 앞선 요일에 확정된 AI 블록 기준 "같은 시 반복" 횟수(요일마다 한 번만 계산)
    const sameSlotDays = new Map<string, Set<number>>();
    for (const b of blocks) {
      if (b.fixed) continue;
      const k = `${b.candidate.programKey}|${hourBucket(b.startMin)}`;
      (sameSlotDays.get(k) ?? sameSlotDays.set(k, new Set()).get(k)!).add(b.weekday);
    }
    const sameSlotCount = (programKey: string, hour: number) => sameSlotDays.get(`${programKey}|${hour}`)?.size ?? 0;
    for (;;) {
      const intervals = freeIntervals(day, BROADCAST_DAY_START_MIN, BROADCAST_DAY_END_MIN, [...occupiedAll, ...pins]);
      // 한도 그룹: "P:프로그램"(일·주 cap) + 주간 한도가 있는 후보 단위 "K:후보"(본방 신규 회차 공급 한계)
      const limitOf = (group: string): number => {
        if (group.startsWith("P:")) {
          const pk = group.slice(2);
          const ov = capOverride?.get(pk);
          return Math.min(ov?.daily ?? config.repeat_rules.daily_cap, (ov?.weekly ?? config.repeat_rules.weekly_cap) - (weekCount.get(group) ?? 0)) - pins.filter((p) => p.candidate.programKey === pk).length;
        }
        const key = group.slice(2);
        const unitLimit = candLens.find((x) => x.c.key === key)?.c.weeklyLimit ?? Infinity;
        return unitLimit - (weekCount.get(group) ?? 0) - pins.filter((p) => p.candidate.key === key).length;
      };
      const groupsOf = (c: EngineCandidate) => (c.weeklyLimit === null ? [`P:${c.programKey}`] : [`P:${c.programKey}`, `K:${c.key}`]);
      const cands = candLens.filter(({ c }) => groupsOf(c).every((g) => !banned.has(g) && limitOf(g) > 0) && !(isHypothetical(c) && banned.has("HYPOTHETICAL")));
      const dayPlacements: PlacedBlock[] = [];
      const dayGaps: { startMin: number; endMin: number }[] = [];
      for (const iv of intervals) {
        const before = [...input.fixedBlocks.filter((b) => b.weekday === day), ...pins, ...dayPlacements]
          .filter((b) => b.endMin <= iv.startMin && iv.startMin - b.endMin <= maxGap)
          .sort((a, b) => a.endMin - b.endMin)
          .pop();
        const { placements, gaps } = runIntervalDp(day, iv, cands, input, before?.candidate ?? null, sameSlotCount);
        for (const p of placements) dayPlacements.push({ weekday: day, startMin: p.startMin, endMin: p.endMin, candidate: p.candidate, status: "AI", fixed: false });
        dayGaps.push(...gaps);
      }
      // 한도 위반 — 가장 많이 초과한 그룹(동률은 이름 순)의 상위 가치 배치만 고정하고 나머지 금지 후 재계산
      const byGroup = new Map<string, PlacedBlock[]>();
      for (const p of dayPlacements) for (const g of groupsOf(p.candidate)) (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(p);
      let worst: { group: string; excess: number; list: PlacedBlock[] } | null = null;
      for (const [group, list] of [...byGroup].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const excess = list.length - limitOf(group);
        if (excess > 0 && (!worst || excess > worst.excess)) worst = { group, excess, list };
      }
      // 가상 후보 예산 — 반복 cap 처리보다 먼저 본다. 고정(pin)된 것과 새로 놓인 것을 합쳐 가치 큰 순으로 예산
      // 안에서만 남기고(초과분 고정 해제), 이후 그날 가상 후보는 금지한다. cap 처리 중 고정된 가상 블록이 예산을
      // 우회하던 문제(2026-09-30 점검: MIX 모드 가상 편성 43%) 수정.
      const dayBudget = totalFree > 0 ? (weekBudget * (freeByDay.get(day) ?? 0)) / totalFree : 0;
      const hypAll = [...pins, ...dayPlacements].filter((p) => isHypothetical(p.candidate));
      const hypMin = hypAll.reduce((s, p) => s + (p.endMin - p.startMin), 0);
      if (hypMin > dayBudget + EPS) {
        const ranked = hypAll
          .map((b) => ({
            b,
            v: scorer.evaluate(b.candidate, { weekday: day, startMin: b.startMin, endMin: b.endMin, prevKey: null, prevProgramKey: null, fixed: false, sameSlotOtherDays: 0, dayGenreShare: 0 }).value,
          }))
          .sort((x, y) => y.v - x.v || x.b.startMin - y.b.startMin);
        const keepHyp = new Set<PlacedBlock>();
        let used = 0;
        for (const { b } of ranked) {
          if (used + (b.endMin - b.startMin) > dayBudget + EPS) continue;
          used += b.endMin - b.startMin;
          keepHyp.add(b);
        }
        const nonHypPins = pins.filter((p) => !isHypothetical(p.candidate));
        pins.length = 0;
        pins.push(...nonHypPins, ...[...keepHyp].sort((x, y) => x.startMin - y.startMin));
        banned.add("HYPOTHETICAL");
        continue;
      }
      if (!worst) {
        const all = [...pins, ...dayPlacements];
        blocks.push(...all);
        for (const b of all) for (const g of groupsOf(b.candidate)) weekCount.set(g, (weekCount.get(g) ?? 0) + 1);
        gapsOut.push(...dayGaps.map((g) => ({ weekday: day, ...g })));
        break;
      }
      const keep = Math.max(0, limitOf(worst.group));
      const valued = worst.list
        .map((b) => ({
          b,
          v: scorer.evaluate(b.candidate, { weekday: day, startMin: b.startMin, endMin: b.endMin, prevKey: null, prevProgramKey: null, fixed: false, sameSlotOtherDays: 0, dayGenreShare: 0 }).value,
        }))
        .sort((x, y) => y.v - x.v || x.b.startMin - y.b.startMin);
      for (const { b } of valued.slice(0, keep)) pins.push(b);
      banned.add(worst.group);
    }
  }

  // 국소탐색: 같은 길이(grid 반올림) 후보로 교체 — 시간 틀은 DP 결과 그대로
  let moves = 0;
  const maxIter = config.structure.max_local_search_iter;
  const byLen = new Map<number, EngineCandidate[]>();
  for (const { c, len } of candLens) (byLen.get(len) ?? byLen.set(len, []).get(len)!).push(c);
  let improved = true;
  while (improved && moves < maxIter) {
    improved = false;
    for (const b of blocks.filter((x) => !x.fixed).sort((x, y) => x.weekday - y.weekday || x.startMin - y.startMin)) {
      if (moves >= maxIter) break;
      for (const c of byLen.get(b.endMin - b.startMin) ?? []) {
        if (c.key === b.candidate.key || !capsOk(c, b.weekday, blocks, config, [b]) || !benchmarkBudgetOk(c, b.endMin - b.startMin, blocks, weekBudget, [b])) continue;
        const saved = b.candidate;
        const d = deltaOf(scorer, blocks, maxGap, [b], () => (b.candidate = c), () => (b.candidate = saved), [saved.programKey]);
        if (d > EPS) {
          moves++;
          improved = true;
        } else b.candidate = saved;
      }
    }
  }

  scorer.detail = true;
  const final = evaluateSchedule(scorer, blocks, maxGap);
  for (const eb of final.blocks) {
    if (eb.fixed) continue;
    eb.timeChanged = !input.skeleton.some((s) => s.weekday === eb.weekday && Math.abs(s.startMin - eb.startMin) <= grid);
    const src = blocks.find((b) => !b.fixed && b.weekday === eb.weekday && b.startMin === eb.startMin)!;
    const len = eb.endMin - eb.startMin;
    const alts = [...(byLen.get(len) ?? []), ...suggestLens.filter((x) => x.len === len).map((x) => x.c)];
    eb.alternatives = alternativesFor(scorer, blocks, src, alts, maxGap, 10);
  }
  return { mode: "AI_OPTIMIZED", blocks: final.blocks, objective: final.objective, emptySlots: [], gaps: gapsOut, localSearchMoves: moves };
}

export function optimizeWeek(input: EngineInput): EngineOutput {
  capOverride = input.programCapOverride;
  try {
    return input.mode === "KEEP_CURRENT" ? optimizeKeepCurrent(input) : optimizeAiTimes(input);
  } finally {
    capOverride = undefined;
  }
}
