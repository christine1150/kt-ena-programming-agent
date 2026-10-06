// OPT01 추적 스크립트 — 편성표 뽑기 엔진의 "+N% 개선율"이 어떻게 만들어지고, 합성 세계(정답을 아는 가상 채널)에서 실제와 얼마나 어긋나는지를
// 재현 가능하게 측정한다. 운영 DB·네트워크에 접근하지 않는다. 실제 채널의 결과가 아니라 "엔진 구조의 성질"을 보는 실험이다.
// 실행: npm run opt01:trace  (옵션: --seeds 12 --json 결과파일)
//
// 측정하는 것
//  1) 보고된 개선율 = 이번 안 주간 기대 ÷ 기준 주(CURRENT) 주간 기대 − 1  (SummaryPanel·엔진 요약과 같은 식)
//  2) 같은 시간(두 편성 모두 평가값이 있는 분)만으로 다시 계산한 개선율 — 분모·분자의 시간 범위가 다른지
//  3) 정답(합성 세계의 잡음 없는 평균)으로 계산한 실제 개선율 — 추천안이 "고르면서 부풀려지는" 정도(낙관 편향)
//  4) 기본 가중치(점수 혼합) vs 시청률 우선(KPI 100%) — 목적함수와 보고 지표의 차이
import fs from "node:fs";
import { mapOwnAirings } from "../src/lib/idealSchedule/mapping";
import { mergeIdealConfig } from "../src/lib/idealSchedule/config";
import { runIdealScheduleEngine, type EngineRunInput, type EngineRunResult, type GenreResolver } from "../src/lib/idealSchedule/engine";
import { addDays, hourBucket } from "../src/lib/idealSchedule/time";

const KPI = "수도권 2049";
const START = "2026-07-06"; // 월
const WEEKS = 12;
const TARGET_WEEK = "2026-09-28";
const N_PROGRAMS = 20;
// 프로그램 간 진짜 매력 차이의 크기(로그 표준편차) — 작을수록 '고르기'로 얻을 진짜 이득이 작다. --appeal로 바꾼다.
let APPEAL_SD = 0.45;
// 모델이 모르는 구조 — 프로그램×시간대 상호작용(INTERACTION_SD)과 주별 매력 변동(DRIFT_SD, 무작위 걸음). 둘 다 0이면 엔진의 모형(프로그램×슬롯 곱)이 정답과 같다.
let INTERACTION_SD = 0;
let DRIFT_SD = 0;
// 기준 주(CURRENT)의 프라임(19~23시) 방영 기록이 이 확률로 비어 있는 경우(특집 결방·측정 공백 등) — 분자·분모의 시간 범위가 달라지는 상황을 재현한다.
let DROP_PRIME = 0;

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

interface World {
  appeal: number[]; // 프로그램별 진짜 매력(합성)
  gamma: number[][]; // 프로그램×4시간 블록 상호작용(로그)
  drift: number[][]; // 프로그램별 주차 누적 변동(로그), 길이 WEEKS+1
  grid: number[][]; // grid[dow-1][hour-2] = 프로그램 번호
  noiseSd: number;
}
const truthRating = (w: World, programIdx: number, dow: number, hour: number, wk = WEEKS) =>
  0.1 * w.appeal[programIdx] * Math.exp(w.gamma[programIdx][Math.floor((hour - 2) / 4)] + w.drift[programIdx][wk]) * slotEffect(hour) * dowEffect(dow);

function makeWorld(seed: number): World {
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
  return { appeal, gamma, drift, grid, noiseSd: 0.25 };
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
      const p = w.grid[dow - 1][h - 2];
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

interface Block {
  weekday: number;
  startMin: number;
  endMin: number;
  programIdx: number | null;
  expected: number | null;
}

function minuteMap(blocks: Block[], pick: (b: Block) => number | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of blocks) {
    const v = pick(b);
    if (v === null) continue;
    for (let t = b.startMin; t < b.endMin; t++) m.set(`${b.weekday}|${t}`, v);
  }
  return m;
}
const avg = (m: Map<string, number>) => (m.size ? [...m.values()].reduce((a, b) => a + b, 0) / m.size : null);

function blocksOf(res: EngineRunResult, which: "IDEAL" | "CURRENT"): Block[] {
  if (which === "IDEAL")
    return res.output.blocks.map((b) => ({ weekday: b.weekday, startMin: b.startMin, endMin: b.endMin, programIdx: b.candidate.programId ? Number(String(b.candidate.programId).replace("P", "")) : null, expected: b.eval.expected }));
  const cur = res.evaluations.CURRENT;
  return (cur?.rows ?? []).map((r) => ({ weekday: r.block.weekday, startMin: r.block.startMin, endMin: r.block.endMin, programIdx: r.block.candidate.programId ? Number(String(r.block.candidate.programId).replace("P", "")) : null, expected: r.block.eval.expected }));
}

interface Row {
  seed: number;
  mode: string;
  weights: string;
  reported: number | null;
  commonSupport: number | null;
  trueImprovement: number | null;
  idealMinutes: number;
  currentMinutes: number;
  commonMinutes: number;
  changedShare: number | null;
  /** 엔진 산출물 하드 제약 검증(OPT03) 위반 건수 */
  violations: number;
  idealExpectedAvg: number | null;
  currentExpectedAvg: number | null;
}

function runOne(seed: number, mode: "KEEP_CURRENT" | "AI_OPTIMIZED", wname: string, weights: typeof baseWeights): Row {
  const world = makeWorld(seed);
  const h = history(world, seed);
  const raw = { channel_code: "ENA", kpi_label: KPI, date_from: START, date_to: addDays(START, WEEKS * 7 - 1), holidays: [] as string[], dates_with_data: h.dates, airings: h.airings };
  const bundle = mapOwnAirings(raw as never);
  const input: EngineRunInput = {
    weekStart: TARGET_WEEK,
    asOfDate: addDays(TARGET_WEEK, -1),
    mode,
    strategyMode: "AUTO",
    config: cfgFor(weights),
    bundle,
    competitorBundle: null,
    constraints: [],
    genreOf,
    evaluateAirings: [{ label: "CURRENT", weekStart: addDays(TARGET_WEEK, -7), airings: bundle.airings }],
  };
  const res = runIdealScheduleEngine(input);
  const ideal = blocksOf(res, "IDEAL");
  const cur = blocksOf(res, "CURRENT");
  const mi = minuteMap(ideal, (b) => b.expected);
  const mc = minuteMap(cur, (b) => b.expected);
  const reported = res.summary.expectedAvgRating !== null && res.evaluations.CURRENT?.expectedAvgRating ? res.summary.expectedAvgRating / (res.evaluations.CURRENT.expectedAvgRating as number) - 1 : null;
  // 공통 지원(두 편성 모두 평가값이 있는 분)만으로 다시 계산
  const common = [...mi.keys()].filter((k) => mc.has(k));
  const ci = common.length ? common.reduce((s, k) => s + (mi.get(k) as number), 0) / common.length : null;
  const cc = common.length ? common.reduce((s, k) => s + (mc.get(k) as number), 0) / common.length : null;
  // 정답(잡음 없는 평균)으로 평가 — 분 가중 평균
  const truth = (blocks: Block[]) => {
    const m = minuteMap(blocks, (b) => (b.programIdx === null ? null : truthRating(world, b.programIdx, b.weekday, hourBucket(b.startMin))));
    return avg(m);
  };
  const ti = truth(ideal);
  const tc = truth(cur);
  // 바뀐 분 비율(같은 분에서 프로그램이 다른 비율)
  const pi = minuteMap(ideal, (b) => b.programIdx);
  const pc = minuteMap(cur, (b) => b.programIdx);
  let both = 0;
  let diff = 0;
  for (const k of pi.keys()) if (pc.has(k)) {
    both++;
    if (pi.get(k) !== pc.get(k)) diff++;
  }
  return {
    seed,
    mode,
    weights: wname,
    reported,
    commonSupport: ci !== null && cc ? ci / cc - 1 : null,
    trueImprovement: ti !== null && tc ? ti / tc - 1 : null,
    idealMinutes: mi.size,
    currentMinutes: mc.size,
    commonMinutes: common.length,
    changedShare: both ? diff / both : null,
    violations: res.summary.validation?.violations.length ?? -1,
    idealExpectedAvg: res.summary.expectedAvgRating,
    currentExpectedAvg: res.evaluations.CURRENT?.expectedAvgRating ?? null,
  };
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function main() {
  const argv = process.argv.slice(2);
  const nSeeds = Number(argv[argv.indexOf("--seeds") + 1]) || 12;
  const appealArg = Number(argv[argv.indexOf("--appeal") + 1]);
  if (argv.includes("--appeal") && Number.isFinite(appealArg)) APPEAL_SD = appealArg;
  const interArg = Number(argv[argv.indexOf("--interaction") + 1]);
  if (argv.includes("--interaction") && Number.isFinite(interArg)) INTERACTION_SD = interArg;
  const driftArg = Number(argv[argv.indexOf("--drift") + 1]);
  if (argv.includes("--drift") && Number.isFinite(driftArg)) DRIFT_SD = driftArg;
  const dropArg = Number(argv[argv.indexOf("--dropprime") + 1]);
  if (argv.includes("--dropprime") && Number.isFinite(dropArg)) DROP_PRIME = dropArg;
  const modes = argv.includes("--modes") ? argv[argv.indexOf("--modes") + 1] : "both";
  const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
  const rows: Row[] = [];
  const variants: ["KEEP_CURRENT" | "AI_OPTIMIZED", string, typeof baseWeights][] = [
    ["KEEP_CURRENT", "기본 가중치", baseWeights],
    ["KEEP_CURRENT", "시청률 우선", kpiOnly],
    ["AI_OPTIMIZED", "기본 가중치", baseWeights],
    ["AI_OPTIMIZED", "시청률 우선", kpiOnly],
    ["AI_OPTIMIZED", "슬롯·추세 성분 제외", noOverlap],
  ];
  for (let s = 1; s <= nSeeds; s++) {
    for (const [mode, wname, w] of variants) {
      if ((modes === "ai" && mode !== "AI_OPTIMIZED") || (modes === "keep" && mode !== "KEEP_CURRENT")) continue;
      const t0 = Date.now();
      rows.push(runOne(s, mode, wname, w));
      process.stderr.write(`seed ${s} ${mode} ${wname} ${Date.now() - t0}ms\n`);
    }
  }
  console.log(`합성 세계 ${nSeeds}개(프로그램 ${N_PROGRAMS}개, 매력 차이 σ=${APPEAL_SD}, 시간대 상호작용 σ=${INTERACTION_SD}, 주별 변동 σ=${DRIFT_SD}, 기준 주 프라임 공백 ${DROP_PRIME}, 이력 ${WEEKS}주, 방영별 잡음 σ=0.25, 정답 = 잡음 없는 평균). 실제 채널 결과가 아니라 엔진 구조의 성질을 보는 실험이다.\n`);
  console.log("모드 | 가중치 | 보고 개선율 | 공통 시간 개선율 | 정답 개선율 | 낙관 편향(보고−정답) | 정답이 음수인 세계 | 바뀐 분 비율 | 분자/분모 시간(분)");
  const groups = new Map<string, Row[]>();
  for (const r of rows) (groups.get(`${r.mode}|${r.weights}`) ?? groups.set(`${r.mode}|${r.weights}`, []).get(`${r.mode}|${r.weights}`)!).push(r);
  for (const [k, g] of groups) {
    const [mode, w] = k.split("|");
    const rep = mean(g.map((r) => r.reported));
    const tru = mean(g.map((r) => r.trueImprovement));
    const neg = g.filter((r) => r.trueImprovement !== null && r.trueImprovement < 0).length;
    if (g.some((r) => r.violations !== 0)) console.log(`⚠ 제약 검증 위반 세계: ${g.filter((r) => r.violations !== 0).map((r) => `seed ${r.seed}(${r.violations}건)`).join(", ")}`);
    console.log(
      `${mode} | ${w} | ${pct(rep)} | ${pct(mean(g.map((r) => r.commonSupport)))} | ${pct(tru)} | ${rep !== null && tru !== null ? pct(rep - tru) : "—"}p | ${neg}/${g.length} | ${pct(mean(g.map((r) => r.changedShare)))} | ${Math.round(mean(g.map((r) => r.idealMinutes)) ?? 0)}/${Math.round(mean(g.map((r) => r.currentMinutes)) ?? 0)}`
    );
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
}
main();
