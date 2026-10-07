// 단계 16 — 읽기 전용 원본 대조 + backfill dry-run. 로컬 닐슨 일간 원본을 지금 파서로 읽은 값과 DB에 저장된 채널 집계(ratings)를 견줘
// 영향 채널·기간, 갱신 범위, 사전 계산·AI 문장 캐시·보고서 영향, rollback 절차를 보고한다. **DB에는 SELECT만 한다(쓰기·RPC 없음).**
// 원본 엑셀은 읽기만 하고 어디에도 복사·전송하지 않으며, 보고서에는 값이 아니라 건수·채널·날짜만 남긴다.
//
// 사용: node --env-file=.env --import tsx scripts/dryrun-engine-diff.ts [원본 폴더] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out 결과.md]
//   원본 폴더 기본값: "Nielsen Data/2026/10". 일간 파일(닐슨_채널시청률(YYMMDD).xls)만 읽는다.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseNielsenDailyWorkbook } from "../src/lib/nielsenDaily";
import { compareRankRecords, planBackfill, renderDryRunMarkdown, type RankRecord } from "../src/lib/ops/dryRun";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const dir = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--"))) ?? "Nielsen Data/2026/10";
const from = opt("--from");
const to = opt("--to");
const outPath = opt("--out");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("DB 연결 설정이 없습니다(읽기 전용 점검에도 필요).");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const files = fs.readdirSync(dir).filter((f) => /^닐슨_채널시청률\(\d{6}\)\.xls$/.test(f)).sort();
  const source: RankRecord[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const parsed = parseNielsenDailyWorkbook(fs.readFileSync(path.join(dir, f)), f);
    if (!parsed.ok) {
      skipped.push(`${f}: ${parsed.message ?? "파싱 실패"}`);
      continue;
    }
    if ((from && parsed.reportDate < from) || (to && parsed.reportDate > to)) continue;
    for (const r of parsed.rankRows) {
      source.push({ date: parsed.reportDate, channelCode: r.channelCode, targetLabel: r.targetLabel, rank: r.rank, rating: r.rating, share: r.share, reach: r.reach, timeSpentSeconds: r.timeSpentSeconds });
    }
  }
  const dates = [...new Set(source.map((r) => r.date))].sort();

  const { data: channels, error: ce } = await db.from("channels").select("id, code");
  const { data: targets, error: te } = await db.from("targets").select("id, label");
  if (ce || te) throw new Error(`기준 정보를 읽지 못했습니다: ${ce?.message ?? te?.message}`);
  const codeById = new Map((channels ?? []).map((c) => [c.id as string, c.code as string]));
  const labelById = new Map((targets ?? []).map((t) => [t.id as string, t.label as string]));

  const stored: RankRecord[] = [];
  for (const date of dates) {
    const { data, error } = await db
      .from("ratings")
      .select("channel_id, target_id, rating, share, reach, time_spent_seconds, rank")
      .eq("source_type", "nielsen_daily")
      .is("program_id", null)
      .eq("broadcast_date", date)
      .not("rank", "is", null);
    if (error) throw new Error(`${date} 저장값을 읽지 못했습니다: ${error.message}`);
    for (const r of data ?? []) {
      const code = codeById.get(r.channel_id as string);
      const label = labelById.get(r.target_id as string);
      if (!code || !label) continue;
      // 원본에는 우리 채널·두 타깃만 비교 대상이므로, 저장값도 같은 범위(우리 채널 코드가 원본에 한 번이라도 나온 것)만 본다
      stored.push({ date, channelCode: code, targetLabel: label, rank: r.rank as number | null, rating: r.rating as number | null, share: r.share as number | null, reach: r.reach as number | null, timeSpentSeconds: r.time_spent_seconds as number | null });
    }
  }
  const sourceChannels = new Set(source.map((r) => r.channelCode));
  const sourceLabels = new Set(source.map((r) => r.targetLabel));
  const storedScoped = stored.filter((r) => sourceChannels.has(r.channelCode) && sourceLabels.has(r.targetLabel));
  const compared = compareRankRecords(source, storedScoped);

  const martRowsByDate: Record<string, number> = {};
  const llmTextRowsByDate: Record<string, number> = {};
  for (const date of [...new Set(compared.diffs.map((d) => d.date))]) {
    const m = await db.from("mart_daily_dashboard_cache").select("*", { count: "exact", head: true }).eq("as_of_date", date);
    const l = await db.from("mart_llm_text_cache").select("*", { count: "exact", head: true }).eq("as_of_date", date);
    martRowsByDate[date] = m.count ?? 0;
    llmTextRowsByDate[date] = l.count ?? 0;
  }
  const snap = await db.from("mart_llm_text_cache").select("*", { count: "exact", head: true }).eq("kind", "report_snapshot");

  const plan = planBackfill(compared, { martRowsByDate, llmTextRowsByDate, reportSnapshotCount: snap.error ? null : (snap.count ?? 0) });
  const md = renderDryRunMarkdown("읽기 전용 원본 대조·backfill dry-run", { files: files.length, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null }, plan);
  const tail = skipped.length ? `\n## 읽지 못한 파일\n\n${skipped.map((s) => `- ${s}`).join("\n")}\n` : "";
  console.log(md + tail);
  if (outPath) fs.writeFileSync(outPath, md + tail);
  // 값이 다른 행의 위치(채널·날짜·필드)는 콘솔에만 — 문서에는 건수만 남긴다
  for (const d of compared.diffs.slice(0, 40)) console.log(`  [${d.kind}] ${d.date} ${d.channelCode} / ${d.targetLabel}${d.fields.length ? " : " + d.fields.join(",") : ""}`);
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
