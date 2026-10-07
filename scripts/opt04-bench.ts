// OPT04 벤치 — 탐색 엔진의 계산 시간·평가 횟수·결과 지문을 합성 세계에서 잰다(운영 DB·네트워크 접근 없음).
// 속도 개선이 결과를 바꾸지 않았는지 확인하는 용도: 같은 시드의 `hash`(편성 블록+목적함수 지문)가 전후로 같아야 한다.
// 실행: npx tsx scripts/opt04-bench.ts --seeds 1 --modes keep|ai|both [--json 파일]
import fs from "node:fs";
import { mapOwnAirings } from "../src/lib/idealSchedule/mapping";
import { mergeIdealConfig } from "../src/lib/idealSchedule/config";
import { runIdealScheduleEngine, fingerprint, type EngineRunInput, type EngineRunResult, type GenreResolver } from "../src/lib/idealSchedule/engine";
import { addDays } from "../src/lib/idealSchedule/time";
import type { ResidualRow } from "../src/lib/idealSchedule/uncertainty";
import type { SearchControl, SearchReport } from "../src/lib/idealSchedule/searchControl";

const KPI = "수도권 2049";
const START = "2026-07-06"; // 월
const WEEKS = 12;
const TARGET_WEEK = "2026-09-28";
let N_PROGRAMS = 20;
let APPEAL_SD = 0.2;
/** true면 매주 편성표가 바뀌는 세계(프로그램 효과와 슬롯 효과를 분리해 학습할 수 있다). 기본 false = 한 슬롯에 같은 프로그램이 계속 놓이는 세계(두 효과가 섞여 구분되지 않음). */
let ROTATE = false;
/** 합성 세계의 프로그램 수·프로그램 간 진짜 매력 차이(로그 표준편차)를 바꾼다 — OPT05 낙관 편향 실험용(기본값은 OPT04 측정과 같다) */
export function configureWorld(o: { programs?: number; appealSd?: number; rotate?: boolean }) {
  if (o.rotate !== undefined) ROTATE = o.rotate;
  if (o.programs !== undefined) N_PROGRAMS = o.programs;
  if (o.appealSd !== undefined) APPEAL_SD = o.appealSd;
}
const INTERACTION_SD = 0;
const DRIFT_SD = 0;
const DROP_PRIME = 0;

// 결정론적 난수(mulberry32)
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
function normal(r: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
}

const slotEffect = (h: number) => (h <= 6 ? 0.2 : h <= 11 ? 0.35 : h <= 16 ? 0.5 : h <= 18 ? 0.8 : h === 21 ? 1.3 : h <= 23 ? 1.0 : 0.6);
const dowEffect = (dow: number) => (dow >= 6 ? 1.1 : 1.0);
const pad = (n: number) => String(n).padStart(2, "0");

export interface World {
  appeal: number[]; // 프로그램별 진짜 매력(합성)
  gamma: number[][]; // 프로그램×4시간 블록 상호작용(로그)
  drift: number[][]; // 프로그램별 주차 누적 변동(로그), 길이 WEEKS+1
  grid: number[][]; // grid[dow-1][hour-2] = 프로그램 번호
  /** 매주 다른 편성표(rotate 세계에서만): gridW[주][dow-1][hour-2] */
  gridW?: number[][][];
  noiseSd: number;
}
export const truthRating = (w: World, programIdx: number, dow: number, hour: number, wk = WEEKS) =>
  0.1 * w.appeal[programIdx] * Math.exp(w.gamma[programIdx][Math.floor((hour - 2) / 4)] + w.drift[programIdx][wk]) * slotEffect(hour) * dowEffect(dow);

export function makeWorld(seed: number): World {
  const r = rng(seed);
  const appeal = Array.from({ length: N_PROGRAMS }, () => Math.exp(APPEAL_SD * normal(r)));
  const gamma = Array.from({ length: N_PROGRAMS }, () => Array.from({ length: 6 }, () => INTERACTION_SD * normal(r)));
  const drift = Array.from({ length: N_PROGRAMS }, () => {
    const d = [0];
    for (let k = 1; k <= WEEKS; k++) d.push(d[k - 1] + DRIFT_SD * normal(r));
    return d;
  });
  // 같은 프로그램이 주 여러 번 나오도록 요일별 24칸을 프로그램 풀에서 배정(연속 같은 프로그램 방지)
  const grid: number[][] = [];
  for (let d = 0; d < 7; d++) {
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      let p = Math.floor(r() * N_PROGRAMS);
      if (h > 0 && p === row[h - 1]) p = (p + 1) % N_PROGRAMS;
      row.push(p);
    }
    grid.push(row);
  }
  let gridW: number[][][] | undefined;
  if (ROTATE) {
    const rr = rng(seed * 13 + 7); // 별도 난수열 — 기본 세계의 난수 소비를 바꾸지 않는다
    gridW = Array.from({ length: WEEKS }, () =>
      Array.from({ length: 7 }, () => {
        const row: number[] = [];
        for (let h = 0; h < 24; h++) {
          let p = Math.floor(rr() * N_PROGRAMS);
          if (h > 0 && p === row[h - 1]) p = (p + 1) % N_PROGRAMS;
          row.push(p);
        }
        return row;
      })
    );
  }
  return { appeal, gamma, drift, grid, gridW, noiseSd: 0.25 };
}

type Raw = { date: string; start: string; end: string; program_id: string; program_name: string; first_run: boolean | null; m: Record<string, { r: number | null; s: number | null; reach: number | null; ts: number | null }> };

function history(w: World, seed: number): { airings: Raw[]; dates: string[] } {
  const r = rng(seed * 7919 + 13);
  const airings: Raw[] = [];
  const dates: string[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const date = addDays(START, i);
    dates.push(date);
    const dow = (i % 7) + 1;
    for (let h = 2; h < 26; h++) {
      const p = (w.gridW ? w.gridW[Math.floor(i / 7)] : w.grid)[dow - 1][h - 2];
      const rating = Math.max(0, truthRating(w, p, dow, h, Math.floor(i / 7)) * Math.exp(w.noiseSd * normal(r) - (w.noiseSd * w.noiseSd) / 2));
      if (DROP_PRIME > 0 && date >= addDays(TARGET_WEEK, -7) && date < TARGET_WEEK && h >= 19 && h <= 23 && r() < DROP_PRIME) continue;
      const startH = h % 24;
      const endH = (h + 1) % 24;
      airings.push({
        date,
        start: `${pad(startH)}:00:00`,
        end: `${pad(endH)}:00:00`,
        program_id: `P${p}`,
        program_name: `프로그램${p}`,
        first_run: null,
        m: { [KPI]: { r: rating, s: rating * 10, reach: null, ts: 600 } },
      });
    }
  }
  return { airings, dates };
}

const baseWeights = { kpi: 35, target: 20, weekday_slot: 20, trend: 10, stability: 5, lead: 10 };
// 요일×시 적합도·최근추세 성분은 기대값(idx)에 이미 들어 있는 정보와 겹칠 수 있어, 두 성분을 뺀 변형으로 중복 반영의 영향을 잰다.
const noOverlap = { kpi: 35, target: 20, weekday_slot: 0, trend: 0, stability: 5, lead: 10 };
const kpiOnly = { kpi: 100, target: 0, weekday_slot: 0, trend: 0, stability: 0, lead: 0 };
const cfgFor = (weights: typeof baseWeights) =>
  mergeIdealConfig(
    {
      weights,
      repeat_rules: { daily_cap: 4, weekly_cap: 20, consecutive_penalty: 0.15, same_slot_penalty: 0.05, genre_concentration_penalty: 0.05, low_confidence_penalty: 0.1, runtime_mismatch_penalty: 0.1 },
      expected_kpi: { lookback_days: 84, recent_days: 28, recent_weight: 2, shrinkage_k: 4, min_n: 3, full_confidence_n: 12, exclude_holidays: true },
      strategy: { strong_threshold: 1.2, match_weight: 0.5, counter_weight: 0.5, benchmark_confidence_cap: 0.4, target_mismatch_penalty: 0.2, include_benchmark_in_totals: false, competitor_target_mode: "AUTO_MATCH_KPI", benchmark_placement: "NONE" },
      structure: { default_mode: "KEEP_CURRENT", skeleton_weeks: 4, grid_minutes: 5, runtime_tolerance_min: 10, max_gap_min: 10, max_local_search_iter: 2000 },
      targets: { GROUP_A: { kpi: KPI, extra: [], composition: null }, GROUP_B: { kpi: "전국 유료가구", extra: [], composition: null }, SKYUHD: { kpi: null, extra: [], composition: null } },
    } as never,
    null
  );
const genreOf: GenreResolver = () => "미분류";


// 장르가 있는 세계(장르 편중·상위 묶음 경로를 쓴다): 프로그램 번호로 장르를 돌려 배정
const CYCLE = ["오리지널 드라마", "드라마", "예능", "영미 드라마"] as const;
const genreCycle: GenreResolver = (_scope, _owner, name) => CYCLE[Number(name.replace(/\D/g, "")) % CYCLE.length];
const tweakConfig = <T extends { structure: { max_local_search_iter: number }; repeat_rules: { daily_cap: number; weekly_cap: number } }>(cfg: T, maxIter?: number, caps?: { daily: number; weekly: number }): T => ({
  ...cfg,
  structure: { ...cfg.structure, max_local_search_iter: maxIter ?? cfg.structure.max_local_search_iter },
  repeat_rules: caps ? { ...cfg.repeat_rules, daily_cap: caps.daily, weekly_cap: caps.weekly } : cfg.repeat_rules,
});

export interface BenchRow {
  seed: number;
  mode: string;
  ms: number;
  objective: number;
  moves: number;
  blocks: number;
  hash: string;
  violations: number;
  expectedAvg: number | null;
  search: SearchReport | undefined;
}

export function runWorld(seed: number, mode: "KEEP_CURRENT" | "AI_OPTIMIZED", search?: SearchControl, opts: { genres?: boolean; maxIter?: number; caps?: { daily: number; weekly: number }; residuals?: ResidualRow[] } = {}): { res: EngineRunResult; ms: number; world: World } {
  const world = makeWorld(seed);
  const h = history(world, seed);
  const raw = { channel_code: "ENA", kpi_label: KPI, date_from: START, date_to: addDays(START, WEEKS * 7 - 1), holidays: [] as string[], dates_with_data: h.dates, airings: h.airings };
  const bundle = mapOwnAirings(raw as never);
  const input: EngineRunInput = {
    weekStart: TARGET_WEEK,
    asOfDate: addDays(TARGET_WEEK, -1),
    mode,
    strategyMode: "AUTO",
    config: tweakConfig(cfgFor(baseWeights), opts.maxIter, opts.caps),
    bundle,
    competitorBundle: null,
    constraints: [],
    genreOf: opts.genres ? genreCycle : genreOf,
    evaluateAirings: [{ label: "CURRENT", weekStart: addDays(TARGET_WEEK, -7), airings: bundle.airings }],
    search: { now: () => performance.now(), ...search },
    residuals: opts.residuals,
  };
  const t0 = Date.now();
  const res = runIdealScheduleEngine(input);
  return { res, ms: Date.now() - t0, world };
}

export function runBench(seed: number, mode: "KEEP_CURRENT" | "AI_OPTIMIZED", search?: SearchControl, opts: { genres?: boolean; maxIter?: number; caps?: { daily: number; weekly: number }; residuals?: ResidualRow[] } = {}): BenchRow {
  const { res, ms } = runWorld(seed, mode, search, opts);
  const sig = res.output.blocks.map((b) => `${b.weekday}|${b.startMin}|${b.endMin}|${b.candidate.key}`).join(";") + `#${res.output.objective.toFixed(10)}`;
  return {
    seed,
    mode,
    ms,
    objective: res.output.objective,
    moves: res.output.localSearchMoves,
    blocks: res.output.blocks.length,
    hash: fingerprint(sig),
    violations: res.summary.validation?.violations.length ?? -1,
    expectedAvg: res.summary.expectedAvgRating,
    search: res.summary.search,
  };
}

if (process.argv[1] && /opt04-bench/.test(process.argv[1])) {
  const argv = process.argv.slice(2);
  const nSeeds = Number(argv[argv.indexOf("--seeds") + 1]) || 1;
  const modes = argv.includes("--modes") ? argv[argv.indexOf("--modes") + 1] : "both";
  const ctl: SearchControl = {};
  if (argv.includes("--budget")) ctl.maxEvaluations = Number(argv[argv.indexOf("--budget") + 1]);
  if (argv.includes("--verify")) ctl.verifyDelta = true;
  if (argv.includes("--start")) ctl.startFrom = argv[argv.indexOf("--start") + 1] === "incumbent" ? "INCUMBENT" : "GREEDY";
  const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
  const rows: BenchRow[] = [];
  for (let s = 1; s <= nSeeds; s++) {
    for (const mode of ["KEEP_CURRENT", "AI_OPTIMIZED"] as const) {
      if ((modes === "ai" && mode !== "AI_OPTIMIZED") || (modes === "keep" && mode !== "KEEP_CURRENT")) continue;
      const r = runBench(s, mode, ctl);
      rows.push(r);
      console.log(`seed ${s} ${mode} ${r.ms}ms obj=${r.objective.toFixed(6)} moves=${r.moves} blocks=${r.blocks} violations=${r.violations} hash=${r.hash}`);
      if (r.search) console.log(`  └ ${r.search.stoppedBy} evals=${r.search.evaluations} deltas=${r.search.deltaCalls} cache=${r.search.expectedCacheHits}/${r.search.expectedCacheMisses} 구성직후=${r.search.objectiveAfterConstruction?.toFixed(4)} 탐색직후=${r.search.objectiveAfterSearch?.toFixed(4)} 시작=${r.search.startedFrom} 차분검증=${r.search.deltaCheck ? `${r.search.deltaCheck.checked}건/불일치${r.search.deltaCheck.mismatches}/최대차${r.search.deltaCheck.maxAbsDiff.toExponential(1)}` : "-"} phase=${JSON.stringify(Object.fromEntries(Object.entries(r.search.phaseMs ?? {}).map(([k, v]) => [k, Math.round(v)])))}`);
    }
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
}
