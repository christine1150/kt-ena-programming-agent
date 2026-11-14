// 비교군 격차 자리 수동 적재(고도화 B2) — 크론(/api/cron/benchmark-gaps)과 같은 로직.
// 사용법: npx tsx --env-file=.env scripts/run-benchmark-gaps.ts [자사 채널 코드]
import { runBenchmarkGaps } from "../src/lib/benchmark/run";
import { kstToday } from "../src/lib/workspace/dates";

async function main() {
  const only = process.argv[2] ?? null;
  const t0 = Date.now();
  const results = await runBenchmarkGaps({ asOf: kstToday(), only });
  for (const r of results) console.log(`${r.key}: ${r.status} · 격차 자리 ${r.gaps}개 · 비교군 ${r.benchmarks.join(", ") || "-"}${r.error ? ` · ${r.error}` : ""}`);
  console.log(`${Math.round((Date.now() - t0) / 1000)}초`);
  process.exit(results.some((r) => r.status === "failed") ? 1 : 0);
}
main();
