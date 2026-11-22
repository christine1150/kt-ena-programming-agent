// 편성표 엑셀 한 개를 업로드 화면과 같은 처리(ingestScheduleGridFile)로 DB에 반영한다.
// 사용: npx tsx --env-file=.env scripts/ingest-schedule-grid-file.mts "<파일경로>" [--apply]
// 기본은 확인만(파싱 결과 + 그 주 기존 행 수), --apply 일 때만 저장한다(같은 주 행을 새 파일로 통째로 바꿈).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseScheduleGridWorkbook } from "../src/lib/scheduleGridParse";
import { readStyleMarks } from "../src/lib/scheduleGridStyle";
import { ingestScheduleGridFile } from "../src/lib/scheduleGridSource";
import { supabase } from "../src/lib/supabase";

const path = process.argv[2];
const apply = process.argv.includes("--apply");
if (!path) {
  console.error("파일 경로가 필요합니다.");
  process.exit(1);
}
const buf = readFileSync(path);
const name = basename(path);

const { marks } = await readStyleMarks(buf);
const parsed = parseScheduleGridWorkbook(buf, name, marks);
if (!parsed.ok) {
  console.error("파싱 실패:", parsed.message);
  process.exit(1);
}
const tagCount: Record<string, number> = {};
for (const r of parsed.rows) {
  const t = /\[(초|본|재)\]/.exec(r.tags ?? "")?.[0] ?? "(없음)";
  tagCount[t] = (tagCount[t] ?? 0) + 1;
}
console.log(`채널 ${parsed.channelCode} · ${parsed.weekStart}~${parsed.weekEnd} · 행 ${parsed.rows.length}`, tagCount);

const { data: ch } = await supabase.from("channels").select("id").eq("code", parsed.channelCode).maybeSingle();
if (ch) {
  const { count } = await supabase
    .from("program_schedule_grid")
    .select("*", { count: "exact", head: true })
    .eq("channel_id", ch.id)
    .gte("broadcast_date", parsed.weekStart)
    .lte("broadcast_date", parsed.weekEnd);
  console.log(`그 주 기존 행 ${count ?? 0}`);
}

if (!apply) {
  console.log("(확인만 — 저장하려면 --apply)");
  process.exit(0);
}
const file = new File([buf], name);
const res = await ingestScheduleGridFile(file);
console.log(JSON.stringify(res));
process.exit(res.ok ? 0 : 1);
