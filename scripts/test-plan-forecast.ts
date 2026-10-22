// 편성표 예측 전용 경로(evaluatePlanOnly, 단계 D-1) 테스트 — 합성 입력, DB·네트워크 없음.
// 실행: npm run test:plan-forecast
// 보증하는 것: 편성을 바꾸지 않고(최적화 없음) 칸마다 편성안 생성과 같은 모델로 기대값을 낸다(실제 편성 평가와 칸별 기대값 일치),
// 이력 없는 칸은 근거 C·안내, 결정론·지문, 종료 근사 표시, 고정 기록 칸 변환·집계 연결.
// 보증하지 못하는 것: 실제 채널에서의 예측 정확도(실제 자료 검증 미완료).
import { mapOwnAirings } from "../src/lib/idealSchedule/mapping";
import { mergeIdealConfig } from "../src/lib/idealSchedule/config";
import { evaluatePlanOnly, runIdealScheduleEngine, type GenreResolver } from "../src/lib/idealSchedule/engine";
import { normalizePlanRows, type PlanRowRaw } from "../src/lib/idealSchedule/planEpisodes";
import { addDays, broadcastMinToLabel } from "../src/lib/idealSchedule/time";
import { toForecastSlots } from "../src/lib/scheduleForecast/fromEngine";
import { aggregateDays } from "../src/lib/scheduleForecast/core";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const KPI = "수도권 2049";
const cfg = mergeIdealConfig(
  {
    weights: { kpi: 35, target: 20, weekday_slot: 20, trend: 10, stability: 5, lead: 10 },
    repeat_rules: { daily_cap: 3, weekly_cap: 14, consecutive_penalty: 0.15, same_slot_penalty: 0.05, genre_concentration_penalty: 0.05, low_confidence_penalty: 0.1, runtime_mismatch_penalty: 0.1 },
    expected_kpi: { lookback_days: 84, recent_days: 28, recent_weight: 2, shrinkage_k: 4, min_n: 3, full_confidence_n: 12, exclude_holidays: true },
    strategy: { strong_threshold: 1.2, match_weight: 0.5, counter_weight: 0.5, benchmark_confidence_cap: 0.4, target_mismatch_penalty: 0.2, include_benchmark_in_totals: false, competitor_target_mode: "AUTO_MATCH_KPI", benchmark_placement: "NONE", benchmark_max_share: 0.05 },
    structure: { default_mode: "KEEP_CURRENT", skeleton_weeks: 4, grid_minutes: 5, runtime_tolerance_min: 10, max_gap_min: 10, max_local_search_iter: 2000 },
    targets: { GROUP_A: { kpi: KPI, extra: [], composition: null }, GROUP_B: { kpi: "전국 유료가구", extra: [], composition: null }, SKYUHD: { kpi: null, extra: [], composition: null } },
  },
  null
);
type RawA = { date: string; start: string; end: string; program_id: string; program_name: string; first_run: boolean | null; m: Record<string, { r: number | null; s: number | null; reach: number | null; ts: number | null }> };
const PROGS = [
  { id: "A", start: "20:00:00", end: "21:00:00", r: 1.0, first: null },
  { id: "B", start: "21:00:00", end: "22:00:00", r: 0.8, first: true },
  { id: "C", start: "22:00:00", end: "23:00:00", r: 0.5, first: null },
  { id: "D", start: "23:00:00", end: "00:00:00", r: 0.4, first: null },
];
const raw = { channel_code: "ENA", kpi_label: KPI, date_from: "2026-07-06", date_to: "2026-09-27", holidays: [] as string[], dates_with_data: [] as string[], airings: [] as RawA[] };
for (let i = 0; i < 42; i++) {
  const date = addDays("2026-08-17", i);
  raw.dates_with_data.push(date);
  for (const p of PROGS) {
    const r = p.r * (1 + 0.08 * Math.sin(i * 0.9 + p.id.charCodeAt(0)));
    raw.airings.push({ date, start: p.start, end: p.end, program_id: p.id, program_name: `프로그램${p.id}`, first_run: p.first, m: { [KPI]: { r, s: r * 10, reach: null, ts: 600 } } });
  }
}
const genreOf: GenreResolver = (_s, _o, name) => (name === "프로그램A" ? "드라마" : name.includes("예능") ? "예능" : "미분류");
const bundle = mapOwnAirings(raw as never);
const W = "2026-09-28";
const WEEK_PREV = "2026-09-21";
const toClock = (m: number) => broadcastMinToLabel(m).replace(/^2([4-5])/, (_x, d) => `0${Number(d) - 4}`);
const prevAirings = bundle.airings.filter((a) => a.date >= WEEK_PREV && a.date <= addDays(WEEK_PREV, 6));
// 지난주 실제 편성을 그대로 다음 주 편성표로(본방 프로그램은 [본] 표시) — 칸·시간이 같으면 실제 편성 평가와 칸별 기대값이 같아야 한다
const planRaw: PlanRowRaw[] = prevAirings.map((a) => ({
  week_start: W,
  broadcast_date: addDays(W, a.dow - 1),
  start_time: toClock(a.startMin),
  end_time: null,
  program_name_raw: a.programName,
  episode_number: null,
  episode_subtitle: null,
  matched_program_id: null,
  tags: a.airingType === "FIRST" ? "[본]" : null,
}));
const plan = normalizePlanRows(planRaw);
const base = { asOfDate: "2026-09-27", config: cfg, bundle, competitorBundle: null, genreOf, strategyMode: "AUTO" as const };

const r = evaluatePlanOnly({ ...base, weekStart: W, planRows: plan });
check("편성표 칸 수 그대로(최적화·추가 배치 없음)", r.slots.length === plan.length && r.slots.length === prevAirings.length, `${r.slots.length}/${plan.length}`);
check("칸의 프로그램·시작 시각을 바꾸지 않음", r.slots.every((s) => plan.some((p) => p.date === s.date && p.startMin === s.startMin && p.name === s.name)));

const engine = runIdealScheduleEngine({ ...base, weekStart: W, mode: "KEEP_CURRENT", constraints: [], evaluateAirings: [{ label: "CURRENT", weekStart: WEEK_PREV, airings: prevAirings }] });
const cur = engine.evaluations.CURRENT;
const curByKey = new Map(cur.rows.map((x) => [`${x.block.weekday}|${x.block.startMin}`, x.block]));
const mism = r.slots.filter((s) => {
  const b = curByKey.get(`${s.weekday}|${s.startMin}`);
  return !b || b.candidate.key !== s.candidateKey || b.eval.expected !== s.expected;
});
check("편성안 생성 엔진의 실제 편성 평가와 칸별 후보·기대값이 정확히 같음(같은 모델·같은 평가기)", mism.length === 0, mism.slice(0, 3).map((s) => `${s.weekday}|${s.startMin} ${s.candidateKey} ${s.expected}`).join(" / "));
check("본방 표시 칸은 본방 후보로 연결", r.slots.filter((s) => s.name === "프로그램B").every((s) => s.candidateKey === "B|FIRST" && s.isNewTag));
check("이력 있는 칸은 근거 등급 A/B, 기대값·근거 방송 수가 있음", r.slots.every((s) => s.matched && s.expected !== null && s.grade !== "C" && s.evidenceAirings > 0));

// 이력 없는 새 프로그램 칸
const plan2 = normalizePlanRows([...planRaw.filter((p) => !(p.broadcast_date === W && p.start_time.startsWith("21"))), { ...planRaw[0], broadcast_date: W, start_time: "21:00", program_name_raw: "새예능X", tags: "[본]" }]);
const r2 = evaluatePlanOnly({ ...base, weekStart: W, planRows: plan2 });
const x = r2.slots.find((s) => s.name === "새예능X")!;
check("이력 없는 칸: 근거 C·기대값은 장르·채널 기준으로 계산, 안내 문구", !!x && !x.matched && x.grade === "C" && x.expected !== null && r2.warnings.some((w) => w.includes("새예능X")));
check("편성표가 바뀌면 지문이 바뀜", r.fingerprint !== r2.fingerprint);
check("같은 입력이면 같은 결과·같은 지문", JSON.stringify(evaluatePlanOnly({ ...base, weekStart: W, planRows: plan })) === JSON.stringify(r));

// 종료 시각 근사 표시
const dayLast = r.slots.filter((s) => s.date === W).sort((a, b) => b.startMin - a.startMin)[0];
check("그날 마지막 칸은 방송일 끝까지로 가정했다고 표시(DAY_END), 나머지는 다음 칸 시작", dayLast.endBasis === "DAY_END" && dayLast.endMin === 26 * 60 && r.slots.filter((s) => s.date === W && s !== dayLast).every((s) => s.endBasis === "NEXT_START"));
check("검증 잔차가 없으면 검증 전(TRAINING/NONE)으로 기록", !r.versions.validated && r.versions.rangeBasis !== "BACKTEST");
check("시청률 외 성분이 섞인 선택 점수(value)를 예측값으로 내보내지 않음", r.slots.every((s) => !("value" in s)));

// 고정 기록 칸 변환·일 집계 연결
const fsl = toForecastSlots(r);
check("고정 기록 칸: 값 그대로 옮기고 종료 근사 표시", fsl.length === r.slots.length && fsl.every((s, i) => s.expected === r.slots[i].expected && s.endApproximated));
const days = aggregateDays(fsl, W);
check("방송일 끝까지로 가정한 마지막 칸의 분은 따로 센다(23:00~26:00 = 180분)", days.every((d) => d.assumedEndMinutes === 180) && fsl.filter((s) => s.endAssumedDayEnd).length === 7);
check("편성표가 20시 이전을 비우면 그날은 부분 예측(0으로 채우지 않음)", days.every((d) => !d.complete && d.uncoveredMinutes > 0 && d.value !== null));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
