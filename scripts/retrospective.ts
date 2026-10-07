// 단계 16 — 방송 후 확정 실적과 당시 예측의 회고(읽기 전용). 저장된 백테스트 결과(그 주 전날까지의 자료로 만든 예측 vs 방송 후 닐슨 실적)를 채널·타깃별로 집계한다.
// DB에는 SELECT만 한다. 방송하지 않은 대체안의 예상치는 실적이 없으므로 다루지 않고, 관측된 변화를 AI의 인과 효과로 해석하지 않는다.
// 사용: node --env-file=.env --import tsx scripts/retrospective.ts [--out 결과.md]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { renderRetroMarkdown, summarizeByChannelTarget, summarizeByTarget, summarizeRetro, type AiringDetail, type WeekResult } from "../src/lib/ops/retrospective";

const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("DB 연결 설정이 없습니다(읽기 전용 점검에도 필요).");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: channels } = await db.from("channels").select("id, code");
  const codeById = new Map((channels ?? []).map((c) => [c.id as string, c.code as string]));
  const { data: runs, error: re } = await db.from("ideal_schedule_backtest_runs").select("id, channel_id");
  if (re) throw new Error(`백테스트 실행 목록을 읽지 못했습니다: ${re.message}`);
  const channelOfRun = new Map((runs ?? []).map((r) => [r.id as string, codeById.get(r.channel_id as string) ?? "?"]));
  const { data: rows, error } = await db.from("ideal_schedule_backtest_results").select("backtest_run_id, week_start, target_label, detail");
  if (error) throw new Error(`백테스트 결과를 읽지 못했습니다: ${error.message}`);
  const results: WeekResult[] = (rows ?? []).map((r) => ({
    channelCode: channelOfRun.get(r.backtest_run_id as string) ?? "?",
    targetLabel: String(r.target_label),
    weekStart: String(r.week_start),
    detail: ((r.detail as AiringDetail[] | null) ?? []).map((d) => ({ expected: d.expected ?? null, actual: d.actual ?? null, fallbackLevel: d.fallbackLevel ?? null, low: d.low ?? null, high: d.high ?? null })),
  }));
  const md = renderRetroMarkdown(summarizeByChannelTarget(results), summarizeByTarget(results));
  const all = summarizeRetro(results);
  const header = `주 ${all.weeks[0] ?? "—"} ~ ${all.weeks[all.weeks.length - 1] ?? "—"} (${all.weeks.length}주), 저장된 주별 결과 ${results.length}개, 비교한 방영 ${all.compared}건, 비교하지 못한 방영 ${all.notCompared}건(예상 또는 실적 없음)\n\n`;
  console.log(header + md);
  if (outPath) fs.writeFileSync(outPath, header + md + "\n");
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
