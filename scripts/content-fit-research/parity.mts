// 운영 TS 엔진(src/lib/contentFit) ↔ JS 레퍼런스(candidates/final.mjs) 일치 검증: 실데이터 덤프의 전 채널·전 평가 시점.
//   npx tsx scripts/content-fit-research/parity.mts
// 점수·판정·지수·추세·신뢰도·이동 시간대가 모두 같아야 한다(불일치 0건). 엔진을 고칠 때마다 다시 돌려 본다.
import fs from "node:fs";
import path from "node:path";
import { computeContentFit } from "../../src/lib/contentFit/index";
import { buildSnapshot, EVAL_DATES, CHANNELS, DATA_DIR } from "./harness.mjs";
import { computeFinal } from "./candidates/final.mjs";

const NATIONAL = new Set(["ENA_STORY", "OLIFE", "ONCE"]);
const J = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
const { targets } = J("channels.json");
const kpiInfo = J("kpi_info.json");
const metro = targets.find((t: { label: string }) => t.label === "수도권 2049").id;

let checked = 0, bad = 0;
const issues: string[] = [];
for (const code of CHANNELS as string[]) {
  const kpi = NATIONAL.has(code) ? kpiInfo[code].targetId : metro;
  const rows = J(`ratings_${code}.json`).filter((r: { target_id: string; rating: number | null }) => r.target_id === kpi && r.rating != null);
  const airings = rows.map((r: Record<string, unknown>) => ({
    programId: r.program_id as string, date: r.broadcast_date as string, startTime: r.start_time as string,
    rating: r.rating as number, reach: r.reach as number | null, timeSpentShare: r.time_spent_share as number | null, firstRun: r.is_first_run as boolean | null,
  }));
  const dates = [...(EVAL_DATES as Record<string, string[]>)[code], "2026-10-13"];
  for (const T of dates) {
    const ts = computeContentFit(airings, T);
    const snap = buildSnapshot(code, T);
    const js = computeFinal(snap);
    const tsMap = new Map(ts.items.map((i) => [i.programId, i]));
    for (const [pid, r] of js as Map<string, { tier: string; tag: string | null; score: number | null; moveTo?: string | null; parts: Record<string, number | null> }>) {
      const t = tsMap.get(pid);
      checked++;
      if (!t) { bad++; issues.push(`${code} ${T} ${pid}: TS에 없음`); continue; }
      const tierJs = r.tier === "A" ? "FORMAL" : r.tier === "B" ? "REFERENCE" : "HOLD";
      const diffs: string[] = [];
      if (t.tier !== tierJs) diffs.push(`tier ${t.tier}/${tierJs}`);
      if ((r.tag ?? null) !== t.tag) diffs.push(`tag ${t.tag}/${r.tag}`);
      if (r.score !== null || t.score !== null) {
        if (r.score === null || t.score === null || Math.abs(r.score - t.score) > 1e-9) diffs.push(`score ${t.score}/${r.score}`);
      }
      if (r.parts.L !== undefined) {
        const near = (a: number | null, b: number | null, tol = 6e-4) => a !== null && b !== null && Math.abs(a - b) < tol; // JS 쪽은 소수 3자리 반올림값
        if (!near(t.slotIndex, r.parts.L)) diffs.push(`L ${t.slotIndex}/${r.parts.L}`);
        if (!near(t.scaleIndex, r.parts.A)) diffs.push(`A ${t.scaleIndex}/${r.parts.A}`);
        if (r.parts.trend !== null && !(t.trend && Math.abs(t.trend.delta - (r.parts.trend as number)) < 6e-3)) diffs.push(`trend ${t.trend?.delta}/${r.parts.trend}`);
        if (r.parts.trend === null && t.trend) diffs.push("trend 있음/없음");
        if (Math.abs(t.reliability - (r.parts.w as number)) > 6e-3) diffs.push(`w ${t.reliability}/${r.parts.w}`);
      }
      if ((r.moveTo ?? null) !== t.moveTo) diffs.push(`moveTo ${t.moveTo}/${r.moveTo}`);
      if (diffs.length) { bad++; if (issues.length < 25) issues.push(`${code} ${T} ${snap.programs.get(pid)?.name}: ${diffs.join(", ")}`); }
    }
  }
}
console.log(`대조 ${checked}건, 불일치 ${bad}건`);
for (const s of issues) console.log(" ", s);
if (bad > 0) process.exit(1);
