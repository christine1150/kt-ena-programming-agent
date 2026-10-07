// OPT05 성능 검증 벤치 — 예측 정확도(검증 A)와 탐색 품질·낙관 편향(검증 B)을 분리해 잰다. 운영 DB·네트워크에 접근하지 않는다.
// 모든 수치는 **합성 세계**(정답을 아는 가상 채널)에서 낸 것으로 "방법의 성질"을 보는 실험이며 실제 채널 결과가 아니다.
// 검증 C(채택 후 실제 성과)는 방송 후에만 알 수 있어 이 벤치로 만들지 않는다 — 기록·대조 도구는 src/lib/idealSchedule/adoption.ts.
// 실행: npm run opt05:bench -- [--worlds 4] [--seeds 4] [--quick] [--json 결과파일]
import fs from "node:fs";
import { mapOwnAirings } from "../src/lib/idealSchedule/mapping";
import { addDays, hourBucket } from "../src/lib/idealSchedule/time";
import type { Genre, OwnAiringsBundle } from "../src/lib/idealSchedule/types";
import {
  GROUPS,
  GROUP_LABEL,
  channelRecentModel,
  empiricalIntervals,
  exposureOf,
  existingModel,
  metricsOf,
  pooledModel,
  programRecentModel,
  runRollingOrigin,
  slotMedianModel,
  slotRecentModel,
  withOptimizeTarget,
  type Exposure,
  type GroupKey,
  type Metrics,
} from "../src/lib/idealSchedule/validation";
import { robustnessCheck, type RobustBlock } from "../src/lib/idealSchedule/robustness";
import { syntheticRaw } from "./opt02-eval";
import { configureWorld, runWorld, truthRating, type World } from "./opt04-bench";
import type { EngineRunResult } from "../src/lib/idealSchedule/engine";

const KPI_A = "수도권 2049";
const KPI_B = "전국 유료가구";
const START = "2026-01-05";
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
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
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ───────────── 검증 A: 예측 정확도 ─────────────

export const MODELS = [
  existingModel("exist", "현재 모델(6단계 수축)"),
  slotRecentModel(4),
  slotRecentModel(8),
  slotMedianModel(8),
  programRecentModel(4),
  pooledModel(3),
  channelRecentModel(4),
];
export const MODEL_LABEL = new Map(MODELS.map((m) => [m.id, m.label]));

export interface AccuracyCell {
  world: number;
  target: string;
  lead: number;
  model: string;
  test: Metrics;
  coverage: number | null;
  relWidth: number | null;
  groups: Record<GroupKey, Metrics>;
  exposure: Exposure;
}

/** 합성 세계 하나를 두 타깃(수도권 2049, 전국 유료가구)으로 평가한다. spikes > 0이면 그 비율의 방영에 6배 극단값을 넣는다(강건성 비교용). */
export function runAccuracy(opts: { worlds: number; weeks?: number; leads?: number[]; spikes?: number }): AccuracyCell[] {
  const weeks = opts.weeks ?? 40;
  const leads = opts.leads ?? [0, 7];
  const out: AccuracyCell[] = [];
  for (let w = 1; w <= opts.worlds; w++) {
    const { raw, genres } = syntheticRaw(w * 101, weeks);
    const r = rng(w * 977 + 5);
    for (const a of raw.airings) {
      const base = a.m[KPI_A];
      if (opts.spikes && r() < opts.spikes && base.r !== null) a.m[KPI_A] = { ...base, r: base.r * 6 };
      const v = a.m[KPI_A].r;
      // 두 번째 타깃: 같은 방영의 가구 시청률(약 1.8배, 별도 잡음)
      a.m[KPI_B] = { r: v === null ? null : v * 1.8 * Math.exp(0.3 * normal(r) - 0.045), s: null, reach: null, ts: null };
    }
    const base = mapOwnAirings(raw);
    const origins = Array.from({ length: weeks - 16 }, (_, i) => addDays(START, (16 + i) * 7));
    const genreOf = (n: string): Genre => genres.get(n) ?? "미분류";
    for (const target of [KPI_A, KPI_B]) {
      const bundle: OwnAiringsBundle = withOptimizeTarget(base, target);
      for (const lead of leads) {
        const rows = runRollingOrigin(bundle, { targetWeeks: origins, leadDays: lead, genreOf, models: MODELS });
        const all = [...new Set(rows.map((x) => x.originWeek))].sort();
        const test = new Set(all.slice(Math.floor(all.length / 2)));
        for (const m of MODELS) {
          const mine = rows.filter((x) => x.model === m.id);
          const held = mine.filter((x) => test.has(x.originWeek));
          const iv = empiricalIntervals(rows, [m.id])[0];
          const groups = {} as Record<GroupKey, Metrics>;
          for (const g of Object.keys(GROUPS) as GroupKey[]) groups[g] = metricsOf(held.filter(GROUPS[g]));
          out.push({ world: w, target, lead, model: m.id, test: metricsOf(held), coverage: iv.coverage, relWidth: iv.relativeWidth, groups, exposure: exposureOf(held) });
        }
      }
    }
  }
  return out;
}

// ───────────── 검증 B: 탐색 품질·낙관 편향 ─────────────

interface Blk {
  weekday: number;
  startMin: number;
  endMin: number;
  programIdx: number | null;
  expected: number | null;
}
const idxOf = (id: string | null) => (id ? Number(String(id).replace("P", "")) : null);
function planBlocks(res: EngineRunResult, which: "PLAN" | "CURRENT"): Blk[] {
  if (which === "PLAN") return res.output.blocks.map((b) => ({ weekday: b.weekday, startMin: b.startMin, endMin: b.endMin, programIdx: idxOf(b.candidate.programId), expected: b.eval.expected }));
  return (res.evaluations.CURRENT?.rows ?? []).map((r) => ({ weekday: r.block.weekday, startMin: r.block.startMin, endMin: r.block.endMin, programIdx: idxOf(r.block.candidate.programId), expected: r.block.eval.expected }));
}
function minuteAvg(blocks: Blk[], pick: (b: Blk) => number | null): { avg: number | null; map: Map<string, number> } {
  const m = new Map<string, number>();
  for (const b of blocks) {
    const v = pick(b);
    if (v === null) continue;
    for (let t = Math.floor(b.startMin); t < b.endMin; t++) m.set(`${b.weekday}|${t}`, v);
  }
  return { avg: m.size ? [...m.values()].reduce((a, c) => a + c, 0) / m.size : null, map: m };
}
const truthOf = (world: World) => (b: Blk) => (b.programIdx === null ? null : truthRating(world, b.programIdx, b.weekday, hourBucket(b.startMin)));

export interface SearchRow {
  seed: number;
  plan: string;
  /** 엔진이 보고하는 개선율(같은 모델 기대 ÷ 기준 주 기대 − 1) */
  reported: number | null;
  /** 정답(합성 세계의 잡음 없는 값)으로 센 개선율 */
  trueImprovement: number | null;
  /** 선택된 블록의 예측이 정답보다 평균 몇 % 높았나(기대 ÷ 정답 − 1) — 선택이 만드는 낙관 */
  predictionBias: number | null;
  violations: number;
  changedShare: number | null;
  ms: number;
  evaluations: number | null;
}

function evaluatePlan(seed: number, plan: string, run: { res: EngineRunResult; ms: number; world: World }): SearchRow {
  const truth = truthOf(run.world);
  const cur = planBlocks(run.res, "CURRENT");
  const mine = planBlocks(run.res, "PLAN");
  const tc = minuteAvg(cur, truth).avg;
  const ti = minuteAvg(mine, truth).avg;
  const curExp = run.res.evaluations.CURRENT?.expectedAvgRating ?? null;
  const reported = run.res.summary.expectedAvgRating !== null && curExp ? run.res.summary.expectedAvgRating / curExp - 1 : null;
  const pi = minuteAvg(mine, (b) => b.programIdx).map;
  const pc = minuteAvg(cur, (b) => b.programIdx).map;
  let both = 0;
  let diff = 0;
  for (const k of pi.keys()) if (pc.has(k)) {
    both++;
    if (pi.get(k) !== pc.get(k)) diff++;
  }
  const ratios = mine.filter((b) => b.expected !== null && truth(b)).map((b) => (b.expected as number) / (truth(b) as number) - 1);
  return {
    seed,
    plan,
    reported,
    trueImprovement: ti !== null && tc ? ti / tc - 1 : null,
    predictionBias: mean(ratios),
    violations: run.res.summary.validation?.violations.length ?? -1,
    changedShare: both ? diff / both : null,
    ms: run.ms,
    evaluations: run.res.summary.search?.evaluations ?? null,
  };
}

/** 같은 예측표(같은 합성 세계·같은 학습 자료)에서 기존 편성·탐욕 구성만·탐욕+국소탐색·AI 시간 최적화를 비교한다. */
export function runSearchQuality(seeds: number[], opts: { skipKeep?: boolean; rotate?: boolean } = {}): SearchRow[] {
  const rows: SearchRow[] = [];
  configureWorld({ rotate: opts.rotate ?? false });
  try {
    collectSearchQuality(seeds, opts, rows);
  } finally {
    configureWorld({ rotate: false });
  }
  return rows;
}

function collectSearchQuality(seeds: number[], opts: { skipKeep?: boolean }, rows: SearchRow[]) {
  for (const seed of seeds) {
    const greedy = runWorld(seed, "KEEP_CURRENT", undefined, { maxIter: 0 });
    // 기존 편성(CURRENT)은 어느 실행에서나 같다 — 탐욕 실행에서 읽는다
    const truth = truthOf(greedy.world);
    const cur = planBlocks(greedy.res, "CURRENT");
    const curRow: SearchRow = {
      seed,
      plan: "기존 편성(지난주 실제)",
      reported: 0,
      trueImprovement: 0,
      predictionBias: mean(cur.filter((b) => b.expected !== null && truth(b)).map((b) => (b.expected as number) / (truth(b) as number) - 1)),
      violations: 0,
      changedShare: 0,
      ms: 0,
      evaluations: null,
    };
    rows.push(curRow, evaluatePlan(seed, "탐욕 구성만", greedy));
    if (!opts.skipKeep) rows.push(evaluatePlan(seed, "탐욕 + 국소탐색(기존 틀 유지)", runWorld(seed, "KEEP_CURRENT")));
    rows.push(evaluatePlan(seed, "AI 시간 최적화", runWorld(seed, "AI_OPTIMIZED")));
  }
}

export interface OptimismRow {
  programs: number;
  appealSd: number;
  mode: string;
  worlds: number;
  reported: number | null;
  trueImprovement: number | null;
  overshoot: number | null;
  predictionBias: number | null;
  violations: number;
}

/** 후보(프로그램) 수를 늘릴수록 근거 없는 예상 개선율이 커지는지 — appealSd=0이면 프로그램 간 진짜 차이가 없어 정답 개선율은 0이다. */
export function runOptimism(sizes: number[], seeds: number[], appealSd: number, modes: ("KEEP_CURRENT" | "AI_OPTIMIZED")[], rotate = true): OptimismRow[] {
  const out: OptimismRow[] = [];
  try {
    for (const n of sizes) {
      configureWorld({ programs: n, appealSd, rotate });
      for (const mode of modes) {
        const rs: SearchRow[] = seeds.map((s) => evaluatePlan(s, mode, runWorld(s, mode)));
        const avg = (xs: (number | null)[]) => mean(xs.filter((x): x is number => x !== null));
        const rep = avg(rs.map((r) => r.reported));
        const tru = avg(rs.map((r) => r.trueImprovement));
        out.push({ programs: n, appealSd, mode, worlds: seeds.length, reported: rep, trueImprovement: tru, overshoot: rep !== null && tru !== null ? rep - tru : null, predictionBias: avg(rs.map((r) => r.predictionBias)), violations: rs.reduce((s, r) => s + Math.max(0, r.violations), 0) });
      }
    }
  } finally {
    configureWorld({ programs: 20, appealSd: 0.2, rotate: false });
  }
  return out;
}

export interface RobustnessMc {
  sigma: number;
  candidates: number;
  trials: number;
  /** 보고되는 점추정 개선율 평균 / 정답 개선율 평균 / 차이 */
  reported: number;
  trueImprovement: number;
  overshoot: number;
  /** 시나리오 [p10, p90] 안에 정답 개선율이 든 비율 — 명목 80% */
  coverage: number;
  /** 정답 개선율이 p10보다 낮았던 비율(과대 전망의 빈도) */
  belowP10: number;
  /** 시나리오 양수 확률이 80% 이상이라고 한 시행 중 정답 개선율이 실제로 양수였던 비율 */
  confidentCorrect: number | null;
  confidentShare: number;
}

/**
 * 오차 모형을 우리가 아는 몬테카를로(엔진 없음): 프로그램 단위 오차(로그정규 σ)를 공유한 예측으로 슬롯마다 예측 최고 프로그램을 고르는 "선택 편성안"을 만들고,
 * 선택이 만드는 낙관(winner's curse)과 robustnessCheck 구간의 적중을 측정한다. 시나리오의 오차 분포는 *선택과 무관한* 검증 잔차(무조건 분포)를 쓰므로,
 * 선택으로 생긴 편향까지는 덮지 못한다는 점을 수치로 보여 주는 실험이다.
 */
export function runRobustnessMc(candidates: number, trials: number, sigma = 0.25, seed = 7): RobustnessMc {
  const r = rng(seed * 31 + candidates);
  const slots = 168;
  const slotFx = Array.from({ length: slots }, (_, i) => 0.4 + 1.2 * (((i * 37) % 24) / 24));
  const ratioSamples = Array.from({ length: 400 }, () => Math.exp(sigma * normal(r) - (sigma * sigma) / 2));
  let rep = 0;
  let tru = 0;
  let inside = 0;
  let below = 0;
  let confident = 0;
  let confidentOk = 0;
  for (let t = 0; t < trials; t++) {
    const q = Array.from({ length: candidates }, () => Math.exp(0.2 * normal(r))); // 프로그램의 진짜 매력(작은 차이)
    const err = Array.from({ length: candidates }, () => Math.exp(sigma * normal(r) - (sigma * sigma) / 2)); // 프로그램 단위 예측 오차(배율)
    const baseAssign = Array.from({ length: slots }, () => Math.floor(r() * candidates)); // 기준안: 임의 편성
    const pred = (p: number, s: number) => q[p] * err[p] * slotFx[s];
    const truth = (p: number, s: number) => q[p] * slotFx[s];
    const planAssign = Array.from({ length: slots }, (_, s) => {
      let best = 0;
      for (let p = 1; p < candidates; p++) if (pred(p, s) > pred(best, s)) best = p;
      return best;
    });
    const avg = (assign: number[], f: (p: number, s: number) => number) => assign.reduce((a, p, s) => a + f(p, s), 0) / slots;
    const reported = avg(planAssign, pred) / avg(baseAssign, pred) - 1;
    const trueImp = avg(planAssign, truth) / avg(baseAssign, truth) - 1;
    const toBlocks = (assign: number[]): RobustBlock[] => assign.map((p, s) => ({ programKey: `P${p}`, minutes: 60, expected: pred(p, s), grade: "A" as const }));
    const rb = robustnessCheck(toBlocks(planAssign), toBlocks(baseAssign), { A: ratioSamples, B: ratioSamples, C: ratioSamples }, { scenarios: 200, seed: t + 1 });
    rep += reported;
    tru += trueImp;
    if (rb.p10 !== null && rb.p90 !== null) {
      if (trueImp >= rb.p10 && trueImp <= rb.p90) inside++;
      if (trueImp < rb.p10) below++;
    }
    if (rb.pPositive !== null && rb.pPositive >= 0.8) {
      confident++;
      if (trueImp > 0) confidentOk++;
    }
  }
  return {
    sigma,
    candidates,
    trials,
    reported: rep / trials,
    trueImprovement: tru / trials,
    overshoot: (rep - tru) / trials,
    coverage: inside / trials,
    belowP10: below / trials,
    confidentCorrect: confident ? confidentOk / confident : null,
    confidentShare: confident / trials,
  };
}

// ───────────── 출력 ─────────────

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const f3 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : (v * 100).toFixed(3));
const avgOf = (xs: (number | null | undefined)[]) => mean(xs.filter((x): x is number => x !== null && x !== undefined));

function printAccuracy(cells: AccuracyCell[], title: string) {
  console.log(`\n## ${title}`);
  for (const target of [KPI_A, KPI_B]) {
    for (const lead of [...new Set(cells.map((c) => c.lead))]) {
      console.log(`\n### 타깃 ${target} · 데이터 마감 ${lead === 0 ? "목표 주 전날" : `목표 주 ${lead}일 전`} (최종 holdout, 세계 평균)`);
      console.log("모델 | MAE(%p) | bias(%p) | 구간 적중률 | 상대 폭 | 평가 건수 | 방송일 | 프로그램 | 프로그램×일");
      for (const m of MODELS) {
        const cs = cells.filter((c) => c.target === target && c.lead === lead && c.model === m.id);
        console.log(
          `${m.label} | ${f3(avgOf(cs.map((c) => c.test.mae)))} | ${f3(avgOf(cs.map((c) => c.test.bias)))} | ${pct(avgOf(cs.map((c) => c.coverage)))} | ${pct(avgOf(cs.map((c) => c.relWidth)), 0)} | ${Math.round(avgOf(cs.map((c) => c.exposure.airings)) ?? 0)} | ${Math.round(avgOf(cs.map((c) => c.exposure.broadcastDays)) ?? 0)} | ${Math.round(avgOf(cs.map((c) => c.exposure.programs)) ?? 0)} | ${Math.round(avgOf(cs.map((c) => c.exposure.programDays)) ?? 0)}`
        );
      }
    }
  }
  console.log(`\n### 집단별 MAE(%p) — 타깃 ${KPI_A}, 마감 목표 주 전날 (괄호: 평가 건수/세계)`);
  const key = ["exist", "slot4w", "slotmed8w", "program4"];
  console.log(["집단", ...key.map((k) => MODEL_LABEL.get(k))].join(" | "));
  for (const g of Object.keys(GROUPS) as GroupKey[]) {
    const cells2 = key.map((id) => {
      const cs = cells.filter((c) => c.target === KPI_A && c.lead === 0 && c.model === id);
      return `${f3(avgOf(cs.map((c) => c.groups[g].mae)))} (${Math.round(avgOf(cs.map((c) => c.groups[g].n)) ?? 0)})`;
    });
    console.log([GROUP_LABEL[g], ...cells2].join(" | "));
  }
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const quick = argv.includes("--quick");
  const worlds = Number(arg("--worlds", quick ? "2" : "4"));
  const nSeeds = Number(arg("--seeds", quick ? "2" : "4"));
  const jsonOut = argv.includes("--json") ? arg("--json", "") : null;
  const seeds = Array.from({ length: nSeeds }, (_, i) => i + 1);
  const result: Record<string, unknown> = {};

  console.log("# OPT05 성능 검증 벤치 — 합성 세계(실제 채널 결과 아님)");
  console.log("\n# 검증 A — 실제 방송에 대한 예측 정확도(시간 순서 rolling-origin, 같은 데이터 마감·같은 지표)");
  const acc = runAccuracy({ worlds });
  result.accuracy = acc;
  printAccuracy(acc, `합성 세계 ${worlds}개(프로그램 34개, 40주, 목표 주 24개/세계, 두 타깃)`);
  const accSpike = runAccuracy({ worlds, spikes: 0.01, leads: [0] });
  result.accuracySpikes = accSpike;
  console.log("\n### 극단값(방영의 1%를 6배)을 섞은 세계 — 평균 vs 중앙값 기준(타깃 2049, 마감 전날, MAE %p)");
  for (const id of ["exist", "slot8w", "slotmed8w"]) {
    console.log(`${MODEL_LABEL.get(id)} | 깨끗한 세계 ${f3(avgOf(acc.filter((c) => c.target === KPI_A && c.lead === 0 && c.model === id).map((c) => c.test.mae)))} | 극단값 세계 ${f3(avgOf(accSpike.filter((c) => c.target === KPI_A && c.model === id).map((c) => c.test.mae)))}`);
  }

  console.log("\n# 검증 B — 탐색 품질과 낙관 편향");
  for (const rotate of [false, true]) {
    const sq = runSearchQuality(seeds, { rotate });
    (result.searchQuality as SearchRow[][] | undefined)?.push(sq) ?? (result.searchQuality = [sq]);
    console.log(`\n### 같은 예측표(합성 세계 ${nSeeds}개, ${rotate ? "매주 편성이 바뀌는 세계 — 프로그램·슬롯 효과를 분리해 학습 가능" : "한 슬롯에 같은 프로그램이 계속 놓이는 세계 — 프로그램·슬롯 효과가 섞여 구분 불가"})에서 편성안 비교 — 개선율은 기존 편성(지난주 실제) 대비`);
    console.log("편성안 | 보고 개선율(같은 모델) | 정답 개선율 | 낙관(보고−정답) | 선택 블록의 예측 편향(기대÷정답−1) | 제약 위반 합계 | 바뀐 분 비율 | 시간(ms) | 평가 호출");
    for (const plan of ["기존 편성(지난주 실제)", "탐욕 구성만", "탐욕 + 국소탐색(기존 틀 유지)", "AI 시간 최적화"]) {
      const rs = sq.filter((r) => r.plan === plan);
      const rep = avgOf(rs.map((r) => r.reported));
      const tru = avgOf(rs.map((r) => r.trueImprovement));
      console.log(`${plan} | ${pct(rep)} | ${pct(tru)} | ${rep !== null && tru !== null ? pct(rep - tru) : "—"} | ${pct(avgOf(rs.map((r) => r.predictionBias)))} | ${rs.reduce((s, r) => s + Math.max(0, r.violations), 0)} | ${pct(avgOf(rs.map((r) => r.changedShare)))} | ${Math.round(avgOf(rs.map((r) => r.ms)) ?? 0)} | ${Math.round(avgOf(rs.map((r) => r.evaluations)) ?? 0) || "—"}`);
    }
  }

  const sizes = quick ? [5, 20] : [5, 10, 20, 40];
  const opt0 = runOptimism(sizes, seeds.slice(0, 3), 0, ["AI_OPTIMIZED"]);
  const opt1 = runOptimism(sizes, seeds.slice(0, 3), 0.2, ["AI_OPTIMIZED"]);
  const optKeep = runOptimism(quick ? [5] : [5, 20], seeds.slice(0, 2), 0, ["KEEP_CURRENT"]);
  result.optimism = [...opt0, ...opt1, ...optKeep];
  console.log("\n### 후보(프로그램) 수를 늘릴수록 근거 없는 예상 개선율이 커지는가");
  console.log("프로그램 수 | 진짜 매력 차이 σ | 모드 | 보고 개선율 | 정답 개선율 | 낙관(보고−정답) | 선택 블록 예측 편향");
  for (const o of [...opt0, ...optKeep, ...opt1]) console.log(`${o.programs} | ${o.appealSd} | ${o.mode === "AI_OPTIMIZED" ? "AI 시간 최적화" : "기존 틀 유지"} | ${pct(o.reported)} | ${pct(o.trueImprovement)} | ${pct(o.overshoot)} | ${pct(o.predictionBias)}`);

  const mcSizes = quick ? [5, 20] : [3, 5, 10, 20, 40];
  const mcSigmas = quick ? [0.1] : [0.05, 0.1, 0.25];
  const mc = mcSigmas.flatMap((sg) => mcSizes.map((n) => runRobustnessMc(n, quick ? 60 : 200, sg)));
  result.robustnessMc = mc;
  console.log("\n### 선택 낙관과 시나리오 구간(몬테카를로, 프로그램 단위 예측 오차 σ, 진짜 매력 차이 σ=0.2, 엔진 없음)");
  console.log("오차 σ | 후보 수 | 보고 개선율 | 정답 개선율 | 낙관 | 정답이 [p10,p90] 안(명목 80%) | 정답이 p10보다 낮음 | '양수 확률≥80%'라 한 시행 비중 | 그중 정답도 양수");
  for (const m of mc) console.log(`${m.sigma} | ${m.candidates} | ${pct(m.reported)} | ${pct(m.trueImprovement)} | ${pct(m.overshoot)} | ${pct(m.coverage, 0)} | ${pct(m.belowP10, 0)} | ${pct(m.confidentShare, 0)} | ${pct(m.confidentCorrect, 0)}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1));
}
if (process.argv[1] && /opt05-bench/.test(process.argv[1])) main();
