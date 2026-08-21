// 로컬 Nielsen Data/ 폴더(2013~2026, 우리가 아는 파일명 형식 "닐슨_채널시청률(YYMMDD).xls")를
// 전부 훑어 아직 DB에 없는 날짜를 채워 넣는 1회성 백필 스크립트(사용자 지시, 2026-08-20:
// "익숙한 닐슨 데일리 엑셀 데이터를 파싱하여 모두 업데이트").
//
// 사전 정찰(scripts/tmp-recon-*.mts, 임시 스크립트) 결과: 이 파일명 형식은 2013년부터 있었지만,
// 현재 파서(src/lib/nielsenDaily.ts)가 요구하는 필수 시트(ENA/ENA Drama/ENA Play 타깃상세)가
// 2023-07-02 이전 파일에는 없다 — ENA Drama 채널 타깃상세 시트가 그 날짜부터 나타나기 시작하는
// 것으로 보인다(그 이전은 파일 구조 자체가 다름, DATA_DICTIONARY.md 범위 밖). 이 스크립트는
// 모든 파일을 시도하되, 파싱 실패는 원래 설계대로 안전하게 건너뛴다(DB에 영향 없음) — 그래서
// 2013~2023-07-01분은 자동으로 스킵되고, 2023-07-02~2026-08-19(이미 백필됨)만 실제로 반영된다.
// 이미 DB에 있는 날짜(source_type='nielsen_daily')는 다시 돌리지 않는다(재실행 시 시간 절약,
// 재업로드=덮어쓰기라 다시 돌려도 안전하지만 이미 검증된 데이터를 또 처리할 필요는 없음).
//
// 실제 파싱·적재 로직은 반드시 src/lib/nielsenIngest.ts를 그대로 재사용한다(CLAUDE.md 고정
// 원칙: 관리자 업로드·자동 수집·이 백필이 전부 같은 로직을 태워야 함 — 새 파싱 로직을 만들지 않음).
//
// 사용법: npx tsx scripts/backfill-nielsen-historical-2023-2025.mts
process.loadEnvFile(".env");

import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "Nielsen Data");
const DAILY_RE = /^닐슨_채널시청률\((\d{6})\)\.xls$/;

function walk(dir: string, out: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (DAILY_RE.test(e.name)) out.push(full);
  }
}

function yymmddToIso(yymmdd: string): string {
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

async function main() {
  const { loadNielsenIngestContext, ingestNielsenDailyFile } = await import("../src/lib/nielsenIngest");
  const { supabase } = await import("../src/lib/supabase");

  const all: string[] = [];
  walk(root, all);

  // 파일명 → ISO 날짜, 정렬. 같은 날짜가 여러 폴더에 중복 존재하면(드묾) 나중 것으로 덮어씀 —
  // 어차피 재업로드=덮어쓰기라 안전.
  const byDate = new Map<string, string>();
  for (const f of all) {
    const m = path.basename(f).match(DAILY_RE)!;
    byDate.set(yymmddToIso(m[1]), f);
  }
  console.log(`전체 후보 파일(날짜 기준 중복 제거): ${byDate.size}개`);

  // 이미 로드된 날짜는 건너뛴다(효율성 — 재업로드해도 안전하지만 이미 검증된 데이터를 또 돌릴
  // 필요는 없음). ratings 테이블을 직접 세면 행 수가 너무 많아(수십만 행) PostgREST 기본
  // 페이지 제한에 걸려 일부만 잡히므로, ingestNielsenDailyFile이 매 파일마다 기록하는
  // file_uploads(훨씬 적은 행 수)에서 "성공 처리된 날짜"를 가져온다.
  const { data: existingRows } = await supabase
    .from("file_uploads")
    .select("reference_date")
    .eq("file_type", "nielsen_daily")
    .eq("status", "processed");
  const existingDates = new Set((existingRows ?? []).map((r: { reference_date: string }) => r.reference_date));
  console.log(`이미 DB에 있는 날짜(file_uploads 처리 이력 기준): ${existingDates.size}개`);

  let todo = [...byDate.entries()].filter(([date]) => !existingDates.has(date)).sort((a, b) => a[0].localeCompare(b[0]));
  // 테스트용 필터(선택) — BACKFILL_START_DATE로 시작점을 당기고, BACKFILL_LIMIT으로 소규모
  // 검증 후 전체 실행.
  if (process.env.BACKFILL_START_DATE) todo = todo.filter(([date]) => date >= process.env.BACKFILL_START_DATE!);
  const limit = process.env.BACKFILL_LIMIT ? parseInt(process.env.BACKFILL_LIMIT, 10) : null;
  if (limit) todo = todo.slice(0, limit);
  console.log(`이번에 처리할 날짜: ${todo.length}개 (${todo[0]?.[0]} ~ ${todo[todo.length - 1]?.[0]})`);

  const ctx = await loadNielsenIngestContext();
  if ("error" in ctx) {
    console.error("컨텍스트 로드 실패:", ctx.error);
    process.exit(1);
  }
  // TS는 const 변수에 대한 타입 좁히기를 중첩 클로저(worker) 안까지 유지하지 않으므로,
  // 위에서 이미 런타임 검사를 마친 뒤 명시적으로 좁혀진 타입으로 재바인딩한다.
  const readyCtx = ctx;

  let successCount = 0;
  let parseFailCount = 0;
  let dbErrorCount = 0;
  const parseFailuresByReason = new Map<string, number>();
  const coverageWarnings: { date: string; message: string }[] = [];
  const newTargetLabelWarnings: { date: string; message: string }[] = [];
  const dbErrors: { date: string; message: string }[] = [];

  // 파일마다 서로 다른 broadcast_date를 건드리므로(같은 날짜 중복 제거함) 동시에 여러 개
  // 처리해도 충돌하지 않는다. 사고 기록(2026-08-21): 동시성 5로 돌렸다가 짧은 시간에 ratings
  // 테이블이 급증하면서(약 140만 행) 인덱스 누락과 겹쳐 Page 1의 "최신 날짜" 조회가 타임아웃
  // 나 서비스가 잠깐 먹통이 됐다(원인 인덱스는 이미 추가함, migrations/20260821000000). 재발
  // 방지로 동시성을 낮춘다 — 라이브 서비스에 주는 부하를 줄이는 게 속도보다 우선.
  const CONCURRENCY = 2;
  let cursor = 0;
  let processed = 0;

  async function worker() {
    while (cursor < todo.length) {
      const idx = cursor++;
      const [date, filePath] = todo[idx];
      const fileName = path.basename(filePath);
      try {
        const buffer = fs.readFileSync(filePath);
        const summary = await ingestNielsenDailyFile(buffer, fileName, readyCtx);
        if (summary.alert === "DATA_QUALITY_ALERT") {
          parseFailCount++;
          const key = (summary.message ?? "").slice(0, 60);
          parseFailuresByReason.set(key, (parseFailuresByReason.get(key) ?? 0) + 1);
        } else if (!summary.ok) {
          dbErrorCount++;
          dbErrors.push({ date, message: summary.message ?? "알 수 없는 오류" });
        } else {
          successCount++;
          for (const w of summary.qualityWarnings ?? []) {
            if (w.includes("채널 데이터가 이 파일에 전혀 없습니다")) coverageWarnings.push({ date, message: w });
            else if (w.includes("처음 보는 타깃 이름")) newTargetLabelWarnings.push({ date, message: w });
          }
        }
      } catch (e: unknown) {
        dbErrorCount++;
        dbErrors.push({ date, message: e instanceof Error ? e.message : String(e) });
      }
      processed++;
      if (processed % 25 === 0 || processed === todo.length) {
        console.log(
          `[진행] ${processed}/${todo.length} (성공 ${successCount}, 구조상 스킵 ${parseFailCount}, DB오류 ${dbErrorCount}) — 최근 처리: ${date}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const summaryOut = {
    totalCandidateDates: byDate.size,
    alreadyLoaded: existingDates.size,
    attempted: todo.length,
    successCount,
    parseFailCount,
    dbErrorCount,
    parseFailuresByReason: Object.fromEntries(parseFailuresByReason),
    coverageWarningsSample: coverageWarnings.slice(0, 30),
    coverageWarningsTotal: coverageWarnings.length,
    newTargetLabelWarningsSample: newTargetLabelWarnings.slice(0, 30),
    newTargetLabelWarningsTotal: newTargetLabelWarnings.length,
    dbErrorsSample: dbErrors.slice(0, 30),
  };
  fs.writeFileSync(
    path.join(process.cwd(), "scripts", "backfill-nielsen-historical-summary.json"),
    JSON.stringify(summaryOut, null, 2)
  );
  console.log("\n=== 완료 ===");
  console.log(JSON.stringify(summaryOut, null, 2));
}

main().catch((e) => {
  console.error("스크립트 실패:", e);
  process.exit(1);
});
