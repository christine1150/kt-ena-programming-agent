// 사용자 지시(2026-08-20): 닐슨이 주는 주간/월간/연간 집계 파일(`닐슨_채널시청률(YYMMDD-YYMMDD).xls`)은
// "그 기간의 정확한 채널별 순위·평균 시청률"이 이미 계산되어 들어있다. 이 값을, 우리가 일별 파일을
// 쌓아서 SQL로 직접 계산한 같은 기간 평균(get_rating_summary)과 비교해 "우리 계산이 닐슨 공식
// 집계와 같은지" 검수하는 참고용 스크립트다. 일별 업로드 파이프라인(nielsenIngest.ts)과는 별개로,
// CLAUDE.md에 이미 고정된 원칙대로 주간/월간 파일은 정식 업로드 기능에 반영하지 않고
// (src/app/api/admin/upload/nielsen-daily/route.ts가 거부) 이 검수 용도로만 쓴다.
//
// 파싱 로직은 새로 만들지 않고 nielsenDaily.ts의 parseRankSheet와 완전히 같은 알고리즘을 그대로
// 복제했다(라이브러리가 TS라 이 순수 Node 스크립트에서 바로 import할 수 없어, 기존
// scripts/backfill-skyuhd-channel-rank.mjs가 이미 쓴 것과 같은 방식 — 결과가 100% 같은 것을
// ENA/2026-08-19 단일 채널·단일일로 직접 대조해 확인했다).
//
// 사용법:
//   node --env-file=.env scripts/verify-against-nielsen-aggregate.mjs                 # Nielsen Data 전체에서 주간/월간/연간 파일을 찾아 전부 검수
//   node --env-file=.env scripts/verify-against-nielsen-aggregate.mjs <파일 경로>       # 특정 파일 하나만 검수
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const RANK_SHEETS = ["유료방송가입가구", "개인"];
const OUR_CHANNEL_DISPLAY_NAMES = new Set(["ENA", "ENA DRAMA", "ENA PLAY", "ENA STORY", "OLIFE", "ONCE", "SkyUHD"]);

function toChannelCode(displayName) {
  return displayName.trim().toUpperCase().replace(/\s+/g, "_");
}
function parseNumberCell(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const v = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isNaN(v) ? null : v;
}

// nielsenDaily.ts의 parseRankSheet와 동일한 알고리즘(라벨 행 탐지 → 7컬럼 폭 블록 → 우리 채널만 추출).
function parseRankSheet(rows, ourChannelDisplayNames) {
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
      if (!ourChannelDisplayNames.has(channelName)) continue;
      results.push({
        channelCode: toChannelCode(channelName),
        targetLabel: block.label,
        rank: parseNumberCell(rankRaw) ?? 0,
        rating: parseNumberCell(row[block.col + 2]),
      });
    }
  }
  return results;
}

// 파일명(YYMMDD-YYMMDD)에서 실제 조회에 쓸 날짜 범위를 뽑는다. 이 스크립트는 검수 전용이라
// nielsenAnnual.ts의 "1/1~12/31 전체"라는 제약 없이 주간/월간도 그대로 받는다.
function extractDateRangeFromFileName(fileName) {
  const m = fileName.match(/\((\d{6})-(\d{6})\)/);
  if (!m) return null;
  const toIso = (raw) => `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
  return { dateFrom: toIso(m[1]), dateTo: toIso(m[2]) };
}

async function verifyFile(filePath) {
  const fileName = filePath.split(/[/\\]/).pop();
  const range = extractDateRangeFromFileName(fileName);
  if (!range) {
    console.log(`⏭  ${fileName}: 파일명에서 날짜 범위를 못 찾아 건너뜀`);
    return null;
  }

  let wb;
  try {
    wb = XLSX.read(readFileSync(filePath), { type: "buffer" });
  } catch {
    console.log(`⚠️  ${fileName}: 파일을 열 수 없어 건너뜀`);
    return null;
  }

  const rankRows = [];
  for (const sheetName of RANK_SHEETS) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true });
    rankRows.push(...parseRankSheet(rows, OUR_CHANNEL_DISPLAY_NAMES));
  }

  if (rankRows.length === 0) {
    console.log(`⚠️  ${fileName}: 랭킹 시트에서 우리 채널 행을 찾지 못함(시트 구조가 다를 수 있음)`);
    return null;
  }

  console.log(`\n=== ${fileName} (${range.dateFrom} ~ ${range.dateTo}) ===`);
  console.log(
    "채널".padEnd(12) + "타깃".padEnd(20) + "닐슨 파일 평균".padEnd(16) + "우리 SQL 평균".padEnd(16) + "차이".padEnd(10) + "판정"
  );

  let matchCount = 0;
  let mismatchCount = 0;
  let noDataCount = 0;

  for (const row of rankRows) {
    // 파일 여러 개를 이어서 훑을 때 짧은 시간에 요청이 몰리면 "fetch failed"(일시적 네트워크
    // 오류)가 실제로 발생했다 — 요청 사이 짧게 쉬고, 실패하면 한 번 더 시도한다.
    await new Promise((r) => setTimeout(r, 30));
    const rpcArgs = {
      p_channel_code: row.channelCode,
      p_target_label: row.targetLabel,
      p_date_from: range.dateFrom,
      p_date_to: range.dateTo,
    };
    let { data, error } = await supabase.rpc("get_rating_summary", rpcArgs);
    if (error) {
      await new Promise((r) => setTimeout(r, 300));
      ({ data, error } = await supabase.rpc("get_rating_summary", rpcArgs));
    }
    if (error) {
      console.log(`  ${row.channelCode} / ${row.targetLabel}: SQL 오류 — ${error.message}`);
      continue;
    }
    const ours = data?.[0]?.avg_rating ?? null;
    const fileRating = row.rating;
    let verdict;
    if (ours === null || fileRating === null) {
      verdict = "데이터없음";
      noDataCount++;
    } else {
      const diff = ours - fileRating;
      const tolerance = Math.max(0.001, fileRating * 0.01); // 절대 0.001 또는 상대 1% 중 큰 쪽까지는 허용
      verdict = Math.abs(diff) <= tolerance ? "일치" : "⚠ 불일치";
      if (verdict === "일치") matchCount++;
      else mismatchCount++;
    }
    const diffText = ours !== null && fileRating !== null ? (ours - fileRating).toFixed(5) : "—";
    console.log(
      row.channelCode.padEnd(12) +
        row.targetLabel.padEnd(20) +
        String(fileRating ?? "—").padEnd(16) +
        String(ours !== null ? ours.toFixed(5) : "—").padEnd(16) +
        diffText.padEnd(10) +
        verdict
    );
  }

  console.log(`  → 일치 ${matchCount}건 / 불일치 ${mismatchCount}건 / 데이터없음 ${noDataCount}건`);
  return { fileName, matchCount, mismatchCount, noDataCount };
}

function findAggregateFiles(baseDir) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^닐슨_채널시청률\(\d{6}-\d{6}\)\.xls$/.test(entry.name)) found.push(full);
    }
  };
  walk(baseDir);
  return found.sort();
}

const argPath = process.argv[2];
let targets;
if (!argPath) {
  targets = findAggregateFiles(join(process.cwd(), "Nielsen Data"));
} else if (statSync(argPath).isDirectory()) {
  targets = findAggregateFiles(argPath);
} else {
  targets = [argPath];
}

console.log(`검수 대상 파일 ${targets.length}개`);

let totalMatch = 0;
let totalMismatch = 0;
let totalNoData = 0;
for (const filePath of targets) {
  const result = await verifyFile(filePath);
  if (result) {
    totalMatch += result.matchCount;
    totalMismatch += result.mismatchCount;
    totalNoData += result.noDataCount;
  }
}

console.log(`\n========== 전체 요약 ==========`);
console.log(`일치 ${totalMatch}건 / 불일치 ${totalMismatch}건 / 데이터없음(우리 쪽에 해당 기간 데이터 없음) ${totalNoData}건`);
