// 경쟁채널 프로그램별 3개 타깃(개인2049/2039/유료방송가구) 백필 — 로컬 Nielsen Data/ 일별 파일을 다시 읽어
// competitor_program_target_ratings만 채운다(2026-10-02, 예측 시청률 시스템). ratings 등 다른 테이블은
// 건드리지 않는다(ingestNielsenDailyFile을 쓰면 덮어쓰기라 불필요하게 무겁고 위험하므로 파서만 재사용).
// 이미 채워진 날짜는 건너뛰어 중단 후 재실행해도 이어진다.
//
// 사용법: npx tsx scripts/backfill-competitor-program-target-ratings.mts [시작일 YYYY-MM-DD] [종료일]
process.loadEnvFile(".env");

import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "Nielsen Data");
const DAILY_RE = /^닐슨_채널시청률\((\d{6})\)\.xls$/;
const FROM = process.argv[2] ?? "2024-11-13"; // ratings 적재 시작일과 맞춤
const TO = process.argv[3] ?? "2099-12-31";

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (DAILY_RE.test(e.name)) out.push(full);
  }
}

async function main() {
  const { parseNielsenDailyWorkbook } = await import("../src/lib/nielsenDaily");
  const { supabase } = await import("../src/lib/supabase");

  const { data: comps } = await supabase.from("competitors").select("competitor_name");
  const registered = new Set((comps ?? []).map((c) => c.competitor_name as string));
  console.log("등록 경쟁채널", registered.size, "개");

  const files: string[] = [];
  walk(root, files);
  const byDate = new Map<string, string>();
  for (const f of files) {
    const m = path.basename(f).match(DAILY_RE)!;
    byDate.set(`20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`, f);
  }
  const dates = [...byDate.keys()].filter((d) => d >= FROM && d <= TO).sort();
  console.log(`대상 ${dates.length}일 (${dates[0]} ~ ${dates[dates.length - 1]})`);

  let done = 0, skipped = 0, failed = 0, rows = 0;
  for (const date of dates) {
    const { count } = await supabase.from("competitor_program_target_ratings").select("*", { count: "exact", head: true }).eq("broadcast_date", date);
    if ((count ?? 0) > 0) { skipped++; continue; }

    const file = byDate.get(date)!;
    const parsed = parseNielsenDailyWorkbook(fs.readFileSync(file), path.basename(file), registered);
    if (!parsed.ok) { failed++; console.log("파싱 실패", date, parsed.message.slice(0, 60)); continue; }

    const out = parsed.competitorProgramTargetRows
      .filter((r) => registered.has(r.competitorName))
      .map((r) => ({
        broadcast_date: date, competitor_name: r.competitorName, start_time: r.startTime, end_time: r.endTime,
        program_name: r.programName, target_label: r.targetLabel, rating: r.rating, share: r.share,
      }));
    let ok = true;
    for (let i = 0; i < out.length; i += 1000) {
      let err: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.from("competitor_program_target_ratings").upsert(out.slice(i, i + 1000), { onConflict: "broadcast_date,competitor_name,start_time,program_name,target_label", ignoreDuplicates: true });
        err = error?.message ?? null;
        if (!err) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      if (err) { ok = false; console.log("insert 실패", date, err.slice(0, 80)); break; }
    }
    if (ok) { done++; rows += out.length; if (done % 20 === 0) console.log(`진행 ${done}일 완료 (누적 ${rows}행, 마지막 ${date})`); }
    else failed++;
  }
  console.log(`끝: 완료 ${done}일, 이미있음 ${skipped}일, 실패 ${failed}일, 저장 ${rows}행`);
}
main().catch((e) => { console.error(e); process.exit(1); });
