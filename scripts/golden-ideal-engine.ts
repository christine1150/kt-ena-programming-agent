// AI 편성 엔진 전후 동일성 확인용 골든 출력 — 리팩터(준비 단계 추출 등) 전에 저장하고, 후에 같은 입력으로 다시 내 비교한다.
// 합성 입력만 쓴다(DB·네트워크 없음). 시계 의존 값(phaseMs 등)은 시계를 주입하지 않아 생기지 않는다.
// 실행: npx tsx scripts/golden-ideal-engine.ts <저장 파일>              — 저장
//       npx tsx scripts/golden-ideal-engine.ts <저장 파일> --compare    — 비교(다르면 종료 코드 1)
import fs from "node:fs";
import { mapCompetitorData, mapOwnAirings } from "../src/lib/idealSchedule/mapping";
import { mergeIdealConfig } from "../src/lib/idealSchedule/config";
import { runIdealScheduleEngine, type EngineRunInput, type GenreResolver } from "../src/lib/idealSchedule/engine";
import { normalizePlanRows } from "../src/lib/idealSchedule/planEpisodes";
import { addDays } from "../src/lib/idealSchedule/time";
import type { HardConstraintInput } from "../src/lib/idealSchedule/constraints";

const KPI = "수도권 2049";
const cfg = mergeIdealConfig(
  {
    weights: { kpi: 35, target: 20, weekday_slot: 20, trend: 10, stability: 5, lead: 10 },
    repeat_rules: { daily_cap: 3, weekly_cap: 14, consecutive_penalty: 0.15, same_slot_penalty: 0.05, genre_concentration_penalty: 0.05, low_confidence_penalty: 0.1, runtime_mismatch_penalty: 0.1 },
    expected_kpi: { lookback_days: 84, recent_days: 28, recent_weight: 2, shrinkage_k: 4, min_n: 3, full_confidence_n: 12, exclude_holidays: true },
    strategy: { strong_threshold: 1.2, match_weight: 0.5, counter_weight: 0.5, benchmark_confidence_cap: 0.4, target_mismatch_penalty: 0.2, include_benchmark_in_totals: false, competitor_target_mode: "AUTO_MATCH_KPI", benchmark_placement: "NONE", benchmark_max_share: 0.05 },
    structure: { default_mode: "KEEP_CURRENT", skeleton_weeks: 4, grid_minutes: 5, runtime_tolerance_min: 10, max_gap_min: 10, max_local_search_iter: 2000 },
    targets: { GROUP_A: { kpi: KPI, extra: ["전국 유료가구"], composition: { num: KPI, den: "전국 유료가구" } }, GROUP_B: { kpi: "전국 유료가구", extra: [], composition: null }, SKYUHD: { kpi: null, extra: [], composition: null } },
  },
  null
);

type RawA = { date: string; start: string; end: string | null; program_id: string; program_name: string; first_run: boolean | null; m: Record<string, { r: number | null; s: number | null; reach: number | null; ts: number | null }> };
const mk = (date: string, start: string, end: string, pid: string, r: number | null, first: boolean | null = null): RawA => ({
  date,
  start,
  end,
  program_id: pid,
  program_name: `프로그램${pid}`,
  first_run: first,
  m: { [KPI]: { r, s: r === null ? null : r * 10, reach: null, ts: r === null ? null : 600 }, "전국 유료가구": { r: r === null ? null : r * 2, s: null, reach: null, ts: null } },
});
const PROGS: { id: string; start: string; end: string; r: number; first?: boolean; onlyWeek?: number; days?: number[] }[] = [
  { id: "A", start: "20:00:00", end: "21:00:00", r: 1.0 },
  { id: "B", start: "21:00:00", end: "22:00:00", r: 1.0 },
  { id: "C", start: "22:00:00", end: "23:00:00", r: 0.5 },
  { id: "D", start: "23:00:00", end: "00:00:00", r: 0.4 },
  { id: "E", start: "00:00:00", end: "00:30:00", r: 0.2 },
  { id: "F", start: "19:00:00", end: "20:00:00", r: 0.9, first: true, onlyWeek: 0 },
  { id: "G", start: "19:00:00", end: "20:00:00", r: 0.9, first: true, onlyWeek: 3 },
  { id: "H", start: "10:00:00", end: "11:00:00", r: 0.15, days: [0, 2, 4] },
  { id: "I", start: "10:00:00", end: "11:00:00", r: 0.1, days: [1, 3, 5, 6] },
  { id: "J", start: "14:00:00", end: "15:30:00", r: 0.3 },
];
const raw = { channel_code: "ENA", kpi_label: KPI, date_from: "2026-07-06", date_to: "2026-09-27", holidays: [] as string[], dates_with_data: [] as string[], airings: [] as RawA[] };
for (let w = 0; w < 6; w++) {
  for (let d = 0; d < 7; d++) {
    const date = addDays("2026-08-17", w * 7 + d);
    raw.dates_with_data.push(date);
    for (const p of PROGS) {
      if (p.onlyWeek !== undefined && p.onlyWeek !== w - 2) continue;
      if (p.days && !p.days.includes(d)) continue;
      const noise = 1 + 0.07 * Math.sin(w * 3.1 + d * 1.3 + p.id.charCodeAt(0));
      raw.airings.push(mk(date, p.start, p.end, p.id, p.r * noise, p.first ?? null));
    }
  }
}
const genreOf: GenreResolver = (scope, _o, name) => (scope === "COMPETITOR" ? (name.startsWith("드라마") ? "드라마" : "미분류") : name === "프로그램A" ? "오리지널 드라마" : name === "프로그램B" || name === "프로그램D" ? "예능" : "미분류");
const compAirings: { competitor: string; date: string; start: string; end: string; program_name: string; target_label: string; r: number; s: null }[] = [];
for (let w = 0; w < 6; w++) {
  const mon = addDays("2026-08-17", w * 7);
  compAirings.push({ competitor: "tvN", date: mon, start: "21:00:00", end: "22:00:00", program_name: "드라마X", target_label: "개인2049", r: 3.0, s: null });
  for (let d = 0; d < 7; d++) compAirings.push({ competitor: "tvN", date: addDays(mon, d), start: "10:00:00", end: "11:00:00", program_name: "재방Y", target_label: "개인2049", r: 0.3, s: null });
}
const compBundle = mapCompetitorData({ date_from: "2026-07-06", date_to: "2026-09-27", airings: compAirings, daily: [] });
const bundle = mapOwnAirings(raw as never);
const lastWeek = bundle.airings.filter((a) => a.date >= "2026-09-21" && a.date <= "2026-09-27");
const lock = (id: string, weekday: number, startMin: number, durationMin: number | null, name: string, rank: 1 | 2 | 3 = 3): HardConstraintInput =>
  ({ id, rank, priority: 0, source: "WEEKLY_INPUT", constraintType: "FIXED_SLOT", programId: null, programName: name, weekday, startMin, durationMin, activeFrom: null, activeTo: null, locked: rank === 1 });
const planRaw = (date: string, start: string, end: string | null, name: string, ep: number | null, tags: string | null = null) =>
  ({ week_start: "2026-09-28", broadcast_date: date, start_time: start, end_time: end, program_name_raw: name, episode_number: ep, episode_subtitle: null, matched_program_id: null, tags });
const planRows = normalizePlanRows([
  planRaw("2026-09-28", "19:00", "20:00", "프로그램G", 5, "[본]"),
  planRaw("2026-09-28", "20:00", "21:00", "프로그램A", null),
  planRaw("2026-09-28", "21:00", "22:30", "신규예능Z", 1, "[본]"),
  planRaw("2026-09-29", "10:00", "11:00", "프로그램I", null, "[재]"),
  planRaw("2026-09-29", "22:00", "23:00", "프로그램C", null),
]);
const resid = Array.from({ length: 60 }, (_, i) => ({ expected: 1, actual: 0.8 + (i % 5) * 0.1, fallbackLevel: (i % 4) + 1 }));

const base: EngineRunInput = { weekStart: "2026-09-28", asOfDate: "2026-09-27", mode: "KEEP_CURRENT", strategyMode: "AUTO", config: cfg, bundle, competitorBundle: null, constraints: [], genreOf, evaluateAirings: [{ label: "CURRENT", weekStart: "2026-09-21", airings: lastWeek }] };
const scenarios: Record<string, EngineRunInput> = {
  keep: base,
  ai: { ...base, mode: "AI_OPTIMIZED" },
  locks: { ...base, constraints: [lock("L1", 1, 1260, 60, "프로그램B"), lock("L2", 3, 1320, null, "신규드라마X", 2), lock("L3", 6, 600, 60, "프로그램H")] },
  compMatch: { ...base, competitorBundle: compBundle, strategyMode: "MATCH" },
  compMix: { ...base, competitorBundle: compBundle, strategyMode: "AUTO", benchmarkPlacement: "MIX", mode: "AI_OPTIMIZED" },
  plan: { ...base, planRows, planFilled: 0 },
  residuals: { ...base, residuals: resid },
  customTarget: { ...base, channelKpiLabel: "전국 유료가구" },
  series: { ...base, constraints: [lock("S1", 1, 1140, 60, "프로그램새시즌")], seriesPriors: [{ targetName: "프로그램새시즌", baseName: "프로그램G", episodes: [0.8, 0.9, 1.0, 1.1], levelRatio: 1, slotDow: 1, slotHour: 19 }] },
};

function run() {
  const out: Record<string, unknown> = {};
  for (const [k, inp] of Object.entries(scenarios)) {
    const r = runIdealScheduleEngine(inp);
    out[k] = { output: r.output, resolution: r.resolution, summary: r.summary, skeleton: r.skeleton, fingerprint: r.fingerprint, evaluations: r.evaluations };
  }
  return JSON.parse(JSON.stringify(out));
}

const file = process.argv[2];
if (!file) throw new Error("저장 파일 경로가 필요합니다.");
const now = run();
if (process.argv.includes("--compare")) {
  const prev = JSON.parse(fs.readFileSync(file, "utf8"));
  let diffs = 0;
  for (const k of Object.keys(prev)) {
    const a = JSON.stringify(prev[k]);
    const b = JSON.stringify(now[k]);
    const same = a === b;
    if (!same) diffs++;
    console.log(`${same ? "✅" : "❌"} ${k}${same ? "" : " — 결과가 다름"} (${a.length}자)`);
  }
  console.log(diffs === 0 ? "\n전후 동일" : `\n다른 시나리오 ${diffs}개`);
  process.exit(diffs === 0 ? 0 : 1);
} else {
  fs.writeFileSync(file, JSON.stringify(now));
  console.log(`저장: ${Object.keys(now).length}개 시나리오 → ${file}`);
  for (const [k, v] of Object.entries(now as Record<string, { output: { blocks: unknown[] }; summary: { expectedAvgRating: number | null } }>)) console.log(` - ${k}: 블록 ${v.output.blocks.length}, 주간 기대 ${v.summary.expectedAvgRating}`);
}
