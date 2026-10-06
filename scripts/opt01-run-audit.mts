// OPT01 — 저장된 편성안(run) 하나의 "+N%" 개선율을 분자·분모·시간 범위·revision까지 분해해서 보여 주는 읽기 전용 점검 도구.
// 사용자가 .env 접근이 있는 PC에서 직접 실행한다(이 저장소의 자동 작업은 운영 DB를 읽지 않는다):
//   npx tsx --env-file=.env scripts/opt01-run-audit.mts <run_id>
// DB를 읽기만 하며(쓰기·재계산·생성 없음) 값·ID는 터미널에만 출력한다. 가격·권리 정보는 읽지 않는다.
import { loadRun } from "../src/lib/idealSchedule/runStore";
import { compareOnCommonSupport, supportNote } from "../src/lib/idealSchedule/comparison";

const runId = process.argv[2];
if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
  console.error("사용법: npx tsx --env-file=.env scripts/opt01-run-audit.mts <run_id(UUID)>");
  process.exit(1);
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const fmt = (v: number | null, d = 4) => (v === null ? "—" : v.toFixed(d));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

const loaded = await loadRun(runId);
if (!loaded) {
  console.error("실행을 찾을 수 없습니다.");
  process.exit(1);
}
const run = loaded.run as Record<string, unknown>;
const summary = (run.summary ?? {}) as { expectedAvgRating?: number | null; current?: { weekStart?: string; expectedAvgRating?: number | null; actualAvgRating?: number | null } | null; frame?: string; decisions?: unknown };
const blocks = loaded.blocks as Record<string, unknown>[];
type Blk = { weekday: number; startMin: number; endMin: number; expected: number | null; countable: boolean; status: string; name: string };
const toBlk = (b: Record<string, unknown>): Blk => ({
  weekday: Number(b.weekday),
  startMin: Number(b.start_min),
  endMin: Number(b.end_min),
  expected: num(b.expected_kpi),
  countable: b.content_type !== "COMPETITOR_BENCHMARK",
  status: String(b.status),
  name: String(b.program_name),
});
const ideal = blocks.filter((b) => b.layer === "IDEAL").map(toBlk);
const current = blocks.filter((b) => b.layer === "CURRENT").map(toBlk);

// 시간 가중 평균(저장된 요약과 같은 식: 평가값이 있는 블록의 편성 분 가중)
const wavg = (bs: Blk[]) => {
  let n = 0;
  let d = 0;
  for (const b of bs) {
    if (!b.countable || b.expected === null) continue;
    n += b.expected * (b.endMin - b.startMin);
    d += b.endMin - b.startMin;
  }
  return { avg: d > 0 ? n / d : null, num: n, minutes: d };
};
const wi = wavg(ideal);
const wc = wavg(current);
const cmp = compareOnCommonSupport(ideal, current);

console.log(`run ${runId}`);
console.log(`대상 주 ${run.week_start} · 모드 ${run.structure_mode} · 기준일(as_of) ${run.as_of_date} · 기준 주(CURRENT) ${run.current_week_start} · needs_recalc=${run.needs_recalc} · parent_run_id=${run.parent_run_id ?? "없음"} · 저장 ${run.saved_at ?? "미저장"} · 생성 ${run.created_at}`);
console.log(`config 지문 ${String(run.input_fingerprint ?? "—")}  (같은 입력이면 같은 지문)\n`);
console.log("── 분자·분모 ──");
console.log(`저장 요약  이번 안 ${fmt(num(summary.expectedAvgRating))} / 기준 주 ${fmt(num(summary.current?.expectedAvgRating))}  → 저장값 기준 개선율 ${pct(num(summary.expectedAvgRating) !== null && num(summary.current?.expectedAvgRating) ? (num(summary.expectedAvgRating) as number) / (num(summary.current?.expectedAvgRating) as number) - 1 : null)}`);
console.log(`블록 재합산 이번 안 ${fmt(wi.avg)} (평가 시간 ${wi.minutes}분, Σ기대×분 ${fmt(wi.num, 2)}) / 기준 주 ${fmt(wc.avg)} (평가 시간 ${wc.minutes}분, Σ ${fmt(wc.num, 2)})`);
const dirty = run.needs_recalc === true;
console.log(`  → 저장 요약과 블록 재합산이 ${near(num(summary.expectedAvgRating), wi.avg) ? "일치" : "다름"}${dirty ? " (수동 교체 후 재계산 전이라 다를 수 있음 — 0.047/0.048 같은 두 값의 출처 후보)" : ""}`);
console.log("\n── 같은 시간 기준 ──");
console.log(`공통 평가 시간 ${cmp.commonMinutes}분 · 이번 안 ${cmp.idealMinutes}분 · 기준 주 ${cmp.currentMinutes}분`);
console.log(`같은 시간 기준 평균: 이번 안 ${fmt(cmp.idealAvg)} / 기준 주 ${fmt(cmp.currentAvg)} → 개선율 ${pct(cmp.ratio)}  (전체 평균 비교 ${pct(cmp.wholeRatio)}, 차이 ${cmp.distortion === null ? "—" : (cmp.distortion * 100).toFixed(1)}%p)`);
console.log(supportNote(cmp) ?? "두 편성의 평가 시간 범위가 같습니다.");
console.log("\n── 구성 ──");
const by = (bs: Blk[]) => bs.reduce<Record<string, number>>((m, b) => ((m[b.status] = (m[b.status] ?? 0) + 1), m), {});
console.log(`이번 안 블록 ${ideal.length}개 ${JSON.stringify(by(ideal))} · 기대값 없는 블록 ${ideal.filter((b) => b.expected === null).length}개`);
console.log(`기준 주 블록 ${current.length}개 · 기대값 없는 블록 ${current.filter((b) => b.expected === null).length}개`);
console.log(`기대값 0인 블록: 이번 안 ${ideal.filter((b) => b.expected === 0).length}개 / 기준 주 ${current.filter((b) => b.expected === 0).length}개`);
const top = [...ideal].filter((b) => b.expected !== null).sort((a, b) => (b.expected as number) * (b.endMin - b.startMin) - (a.expected as number) * (a.endMin - a.startMin)).slice(0, 5);
console.log("이번 안 기대×분 상위 5:", top.map((b) => `${b.name}(${fmt(b.expected, 3)}×${b.endMin - b.startMin}분)`).join(", "));

function near(a: number | null, b: number | null) {
  return a !== null && b !== null && Math.abs(a - b) < 1e-6;
}
