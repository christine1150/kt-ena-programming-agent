// 사용자 지시(2026-09-07): "OLIFE 종합 정보.xlsx"(가구/연령대별/플랫폼별/평일주말)와
// "260101-260906 누적.xlsx"(2026년 시장 전체 채널 누적 순위, 유료방송가구/수도권2049)를 학습해
// DB에 등록. 읽기: 원본 파일 → 파싱(src/lib/olifeReferenceParse.ts) → upsert.
// 실행: npx tsx --env-file=.env scripts/ingest-olife-reference.mts <올ife종합정보.xlsx> <누적.xlsx>
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { parseOlifeReferenceWorkbook, parseYtdCumulativeWorkbook } from "../src/lib/olifeReferenceParse";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다(--env-file=.env).");
  process.exit(1);
}
const sb = createClient(supabaseUrl, supabaseKey);

const [, , olifeInfoPath, ytdPath] = process.argv;
if (!olifeInfoPath || !ytdPath) {
  console.error("사용법: tsx scripts/ingest-olife-reference.mts <OLIFE 종합 정보.xlsx> <누적.xlsx>");
  process.exit(1);
}

async function upsertChunked<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  onConflict: string,
  chunkSize = 500
): Promise<number> {
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from(table).upsert(chunk as Record<string, unknown>[], { onConflict });
    if (error) throw new Error(`${table} upsert 실패(${i}~${i + chunk.length}): ${error.message}`);
    done += chunk.length;
  }
  return done;
}

async function main() {
  // ── ① OLIFE 종합 정보.xlsx → olife_reference_metrics ──
  console.log("\n=== OLIFE 종합 정보.xlsx 파싱 ===");
  const infoBuf = readFileSync(olifeInfoPath);
  const { rows: refRows, warnings: refWarnings } = parseOlifeReferenceWorkbook(infoBuf);
  console.log("파싱된 행 수:", refRows.length);
  if (refWarnings.length) console.log("경고:", refWarnings);

  const byDim: Record<string, number> = {};
  for (const r of refRows) byDim[r.dimension] = (byDim[r.dimension] ?? 0) + 1;
  console.log("dimension별 행 수:", byDim);

  const refDbRows = refRows.map((r) => ({
    granularity: r.granularity,
    period_date: r.periodDate,
    year: r.year,
    month: r.month,
    dimension: r.dimension,
    target_label: r.targetLabel,
    rating: r.rating,
    share: r.share,
    avg_time_spent_seconds: r.avgTimeSpentSeconds,
    avg_time_spent_ratio: r.avgTimeSpentRatio,
    reach: r.reach,
    source_file: olifeInfoPath.split(/[\\/]/).pop(),
  }));
  const refUpserted = await upsertChunked("olife_reference_metrics", refDbRows, "granularity,period_date,dimension,target_label");
  console.log("olife_reference_metrics upsert 완료:", refUpserted, "건");

  await sb.from("file_uploads").insert({
    file_name: olifeInfoPath.split(/[\\/]/).pop(),
    file_type: "olife_reference",
    status: "processed",
    error_message: refWarnings.length > 0 ? refWarnings.join(" / ") : null,
  });

  // ── ② 260101-260906 누적.xlsx → market_ytd_rank_snapshot ──
  console.log("\n=== 누적.xlsx 파싱 ===");
  const ytdBuf = readFileSync(ytdPath);
  const { rows: ytdRows, warnings: ytdWarnings } = parseYtdCumulativeWorkbook(ytdBuf);
  console.log("파싱된 행 수:", ytdRows.length);
  if (ytdWarnings.length) console.log("경고:", ytdWarnings);
  const byTarget: Record<string, number> = {};
  for (const r of ytdRows) byTarget[r.targetLabel] = (byTarget[r.targetLabel] ?? 0) + 1;
  console.log("target별 행 수:", byTarget);

  const ytdDbRows = ytdRows.map((r) => ({
    target_label: r.targetLabel,
    channel_name: r.channelName,
    rank: r.rank,
    rating: r.rating,
    share: r.share,
    avg_time_spent_seconds: r.avgTimeSpentSeconds,
    avg_time_spent_ratio: r.avgTimeSpentRatio,
    date_from: r.dateFrom,
    date_to: r.dateTo,
  }));
  const ytdUpserted = await upsertChunked("market_ytd_rank_snapshot", ytdDbRows, "target_label,channel_name,date_from,date_to");
  console.log("market_ytd_rank_snapshot upsert 완료:", ytdUpserted, "건");

  await sb.from("file_uploads").insert({
    file_name: ytdPath.split(/[\\/]/).pop(),
    file_type: "market_ytd_rank",
    status: "processed",
    error_message: ytdWarnings.length > 0 ? ytdWarnings.join(" / ") : null,
  });

  console.log("\n=== 완료 ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
