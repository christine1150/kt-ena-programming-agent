// nielsenDaily.ts의 §1.2 경쟁채널 프로그램 파서 버그(블록 경계를 무시하고 첫 헤더 이름으로
// 시트 끝까지 읽던 문제)를 고친 뒤, 이미 업로드된 2026-01-01~08-18 Nielsen 일별 파일 전체를
// 다시 훑어 competitor_program_ratings를 새로 채우는 1회성 백필 스크립트.
// (ratings/competitor_ratings는 이미 정상 백필돼 있으므로 건드리지 않는다 — 이 테이블만 대상)
//
// 사용법 (my-app 폴더에서 실행):
//   node --env-file=.env scripts/backfill-competitor-program-ratings.mjs
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(".env에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없습니다.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// ── src/lib/nielsenDaily.ts와 동일한 파싱 로직(경쟁채널 프로그램 블록 부분만 발췌) ──
function normalizeTime(raw) {
  if (typeof raw === "number") {
    const totalSeconds = Math.round(raw * 86400);
    const hour = Math.floor(totalSeconds / 3600) % 24;
    const minute = Math.floor((totalSeconds % 3600) / 60);
    const second = totalSeconds % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }
  const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10) % 24;
  return `${String(hour).padStart(2, "0")}:${m[2]}:${m[3]}`;
}
function parseNumberCell(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const v = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isNaN(v) ? null : v;
}
function findCompetitorBlocks(rows) {
  const blocks = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? "").trim() === "시작시간") {
        const name = String(rows[r - 1]?.[c] ?? "").trim();
        if (name) blocks.push({ headerRowIdx: r, col: c, name });
      }
    }
  }
  return blocks;
}
// 버그 수정(2026-08-21, src/lib/nielsenDaily.ts와 동일하게 재검증): 시트 하나를 그 시트의
// "자사 채널"에만 고정 귀속시켰더니, Competitor Master를 직접 조회한 결과 ENA_STORY/ENA_PLAY의
// 등록 경쟁채널 일부가 다른 시트(자기 시트가 아닌)에 흩어져 있는 게 실제로 확인됐다 — 4개 시트의
// 모든 경쟁채널 블록을 하나의 풀로 모아 분석 대상 6개 채널 전부에 내보내고, 실제 귀속은 아래
// registeredByChannel(그 채널의 실제 Competitor Master 등록 여부)로 걸러지도록 바꿨다.
const ALL_SELF_DISPLAY_NAMES = ["ENA", "ENA DRAMA", "ENA STORY", "ENA PLAY", "ONCE", "OLIFE"];
function parseCompetitorProgramSheet(rows) {
  const results = [];
  const selfSet = new Set(ALL_SELF_DISPLAY_NAMES);
  for (const block of findCompetitorBlocks(rows)) {
    if (selfSet.has(block.name)) continue;
    const targetLabelRow = rows[block.headerRowIdx + 1];
    const targetLabel = String(targetLabelRow?.[block.col + 3] ?? "").trim() || null;
    for (let r = block.headerRowIdx + 2; r < rows.length; r++) {
      const row = rows[r];
      const first = String(row?.[block.col] ?? "").trim();
      if (first === "하루 전체" || first === "하루전체") break;
      if (!first) continue;
      const programName = String(row?.[block.col + 2] ?? "").trim();
      if (!programName) continue;
      results.push({
        competitorName: block.name,
        startTime: normalizeTime(row[block.col]),
        endTime: normalizeTime(row?.[block.col + 1]),
        programName,
        targetLabel,
        rating: parseNumberCell(row?.[block.col + 3]),
        share: parseNumberCell(row?.[block.col + 6]),
      });
    }
  }
  return results;
}

const COMPETITOR_SHEET_NAMES = ["ENA경쟁채널시청률", "ENA DRAMA경쟁채널시청률", "ENA PLAY경쟁채널시청률", "ONCE,OLIFE경쟁채널시청률"];
const COMPETITOR_TARGET_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_STORY", "ENA_PLAY", "ONCE", "OLIFE"];

// ── 채널/경쟁채널 마스터 로드 ──
const { data: channels } = await supabase.from("channels").select("id, code");
const channelIdByCode = new Map((channels ?? []).map((c) => [c.code, c.id]));

const { data: competitorRows } = await supabase.from("competitors").select("competitor_name, channel_id");
const registeredByChannel = new Map(); // channel_id -> Set(competitor_name)
for (const row of competitorRows ?? []) {
  if (!row.channel_id) continue;
  const set = registeredByChannel.get(row.channel_id) ?? new Set();
  set.add(row.competitor_name);
  registeredByChannel.set(row.channel_id, set);
}

// ── 대상 파일 목록: Nielsen Data/2026/01~08 안의 "닐슨_채널시청률(YYMMDD).xls"만 (범위/skyUHD 제외) ──
const baseDir = join(process.cwd(), "Nielsen Data", "2026");
const monthDirs = readdirSync(baseDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{2}$/.test(d.name))
  .map((d) => d.name)
  .sort();

let totalFiles = 0;
let totalRows = 0;
let totalSkippedUnregistered = 0;

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

    // 4개 시트의 경쟁채널 블록을 전부 하나의 풀로 모은다.
    const pooledRows = [];
    for (const sheetName of COMPETITOR_SHEET_NAMES) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true });
      pooledRows.push(...parseCompetitorProgramSheet(rows));
    }

    const rowsToInsert = [];
    let skippedUnregistered = 0;
    // 분석 대상 6개 채널 전부에 대해, 그 채널의 Competitor Master 등록 여부로 걸러 귀속시킨다.
    for (const ourChannelCode of COMPETITOR_TARGET_CHANNEL_CODES) {
      const ourChannelId = channelIdByCode.get(ourChannelCode);
      if (!ourChannelId) continue;
      const registered = registeredByChannel.get(ourChannelId) ?? new Set();
      for (const row of pooledRows) {
        if (!row.startTime) continue;
        if (!registered.has(row.competitorName)) {
          skippedUnregistered += 1;
          continue;
        }
        rowsToInsert.push({
          broadcast_date: reportDate,
          our_channel_id: ourChannelId,
          competitor_name: row.competitorName,
          start_time: row.startTime,
          end_time: row.endTime,
          program_name: row.programName,
          target_label: row.targetLabel,
          rating: row.rating,
          share: row.share,
        });
      }
    }

    await supabase.from("competitor_program_ratings").delete().eq("broadcast_date", reportDate);
    if (rowsToInsert.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
        const { error } = await supabase.from("competitor_program_ratings").insert(rowsToInsert.slice(i, i + CHUNK));
        if (error) console.log(`  ❌ ${reportDate} insert 오류: ${error.message}`);
      }
    }

    totalFiles += 1;
    totalRows += rowsToInsert.length;
    totalSkippedUnregistered += skippedUnregistered;
    console.log(`✅ ${reportDate} (${fileName}): ${rowsToInsert.length}건 저장 (미등록 채널 건너뜀 ${skippedUnregistered}건)`);
  }
}

console.log(`\n총 ${totalFiles}개 파일 처리, ${totalRows}건 저장, 미등록 채널 ${totalSkippedUnregistered}건 제외`);
