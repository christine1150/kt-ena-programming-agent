// nielsenDaily.ts의 OUR_CHANNEL_DISPLAY_NAMES에 "SkyUHD"를 추가하기 전까지는, "유료방송가입가구"
// 랭킹 시트에 매일 들어있는 SkyUHD 채널 단위 시청률·등위 행이 조용히 걸러지고 있었다
// (skyUHD는 지금까지 별도 수기 파일의 프로그램 단위 데이터만 있었음). 이미 업로드된
// 2026-01-01~08-18 파일 전체를 다시 훑어 SkyUHD의 채널 단위 랭킹 행만 채워 넣는 1회성
// 백필 스크립트 — 다른 채널 데이터는 건드리지 않는다.
//
// 사용법: node --env-file=.env scripts/backfill-skyuhd-channel-rank.mjs
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function parseNumberCell(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const v = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isNaN(v) ? null : v;
}
function timeSpentToSeconds(raw) {
  if (typeof raw === "number") return Math.round(raw * 86400);
  const m = String(raw ?? "").trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

/** parseRankSheet의 SkyUHD 전용 축소판 — 블록 폭 7컬럼(No.|채널명|시청률|점유율|도달율|시청시간|구분칸) */
function parseSkyUhdRankRows(rows) {
  const results = [];
  let labelRowIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    if (String(rows[r]?.[0] ?? "").trim() === "No.") {
      labelRowIdx = r - 1;
      break;
    }
  }
  if (labelRowIdx < 0) return results;
  const labelRow = rows[labelRowIdx];
  const blockCols = [];
  for (let col = 0; col < labelRow.length; col += 7) {
    const label = String(labelRow[col + 1] ?? "").trim().replace(/^-\s*/, "");
    if (label) blockCols.push({ col, label });
  }
  const dataStart = labelRowIdx + 2;
  for (const block of blockCols) {
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const rankRaw = row?.[block.col];
      if (rankRaw === undefined || rankRaw === "") continue;
      const channelName = String(row[block.col + 1] ?? "").trim();
      if (channelName !== "SkyUHD") continue;
      results.push({
        targetLabel: block.label,
        rank: parseNumberCell(rankRaw) ?? 0,
        rating: parseNumberCell(row[block.col + 2]),
        share: parseNumberCell(row[block.col + 3]),
        reach: parseNumberCell(row[block.col + 4]),
        timeSpentSeconds: timeSpentToSeconds(row[block.col + 5]),
      });
    }
  }
  return results;
}

const { data: channel } = await supabase.from("channels").select("id").eq("code", "SKYUHD").maybeSingle();
if (!channel) {
  console.error("SKYUHD 채널을 찾을 수 없습니다.");
  process.exit(1);
}
const skyuhdChannelId = channel.id;

const targetIdCache = new Map();
async function ensureTarget(label) {
  if (targetIdCache.has(label)) return targetIdCache.get(label);
  const { data, error } = await supabase.from("targets").upsert({ code: label, label }, { onConflict: "code" }).select("id").single();
  if (error || !data) return null;
  targetIdCache.set(label, data.id);
  return data.id;
}

const baseDir = join(process.cwd(), "Nielsen Data", "2026");
const monthDirs = readdirSync(baseDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{2}$/.test(d.name))
  .map((d) => d.name)
  .sort();

let totalFiles = 0;
let totalRows = 0;

for (const month of monthDirs) {
  const monthDir = join(baseDir, month);
  const files = readdirSync(monthDir).filter((f) => /^닐슨_채널시청률\(\d{6}\)\.xls$/.test(f));
  for (const fileName of files.sort()) {
    const dateMatch = fileName.match(/\((\d{6})\)/);
    const yy = dateMatch[1].slice(0, 2);
    const mm = dateMatch[1].slice(2, 4);
    const dd = dateMatch[1].slice(4, 6);
    const reportDate = `20${yy}-${mm}-${dd}`;

    const buffer = readFileSync(join(monthDir, fileName));
    let wb;
    try {
      wb = XLSX.read(buffer, { type: "buffer" });
    } catch {
      console.log(`⚠️ ${fileName}: 파일을 열 수 없어 건너뜀`);
      continue;
    }

    const skyuhdRows = [];
    for (const sheetName of ["유료방송가입가구", "개인"]) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true });
      skyuhdRows.push(...parseSkyUhdRankRows(rows));
    }

    // 이 날짜의 기존 SkyUHD 채널 단위 랭킹 행(있다면)을 지우고 새로 채운다.
    await supabase
      .from("ratings")
      .delete()
      .eq("channel_id", skyuhdChannelId)
      .eq("broadcast_date", reportDate)
      .eq("source_type", "nielsen_daily")
      .is("program_id", null);

    const rowsToInsert = [];
    for (const r of skyuhdRows) {
      const targetId = await ensureTarget(r.targetLabel);
      rowsToInsert.push({
        source_type: "nielsen_daily",
        channel_id: skyuhdChannelId,
        program_id: null,
        target_id: targetId,
        broadcast_date: reportDate,
        rating: r.rating,
        share: r.share,
        reach: r.reach,
        time_spent_seconds: r.timeSpentSeconds,
        rank: r.rank,
      });
    }
    if (rowsToInsert.length > 0) {
      const { error } = await supabase.from("ratings").insert(rowsToInsert);
      if (error) console.log(`  ❌ ${reportDate} insert 오류: ${error.message}`);
    }

    totalFiles += 1;
    totalRows += rowsToInsert.length;
    console.log(`✅ ${reportDate}: SkyUHD ${rowsToInsert.length}건 저장`);
  }
}

console.log(`\n총 ${totalFiles}개 파일 처리, SkyUHD 채널 단위 랭킹 ${totalRows}건 저장`);
