// 사용자가 닐슨에서 따로 뽑아 주는 "분당 시청률" 엑셀(시트명 "나는솔로분당시청률" 등, 1분 단위 1,440행)을 program_minute_ratings 에 넣는다.
// 시트 모양: 머리글 위 3줄이 채널 / 지역(수도권·National) / 타깃(유료방송가구·(P) - P2049), 첫 열은 "02:00:00 - 02:00:59" 같은 분 구간.
// 같은 방송일·채널은 다시 넣으면 그 값으로 바뀐다(upsert). 분은 방송일 기준 분 정수(00:03 = 1443)로 저장한다.
//
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/ingest-minute-ratings.mts "<엑셀 경로>" [시트명] [--apply]
import fs from "node:fs";
import * as XLSX from "xlsx";

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
const [xlsxPath, sheetName = "나는솔로분당시청률"] = args;
if (!xlsxPath) {
  console.error('사용법: npx tsx ... scripts/ingest-minute-ratings.mts "<엑셀 경로>" [시트명] [--apply]');
  process.exit(1);
}

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
const ws = wb.Sheets[sheetName];
if (!ws) throw new Error(`시트를 찾을 수 없습니다: ${sheetName} (있는 시트: ${wb.SheetNames.join(", ")})`);
const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

// 방송일: "선택일자:" 줄에 하루만 있어야 한다(범위면 거부).
const dateLine = rows.find((r) => text(r[0]) === "선택일자:");
const dates = text(dateLine?.[1]).match(/\d{4}-\d{2}-\d{2}/g) ?? [];
if (dates.length !== 1 || /\d{4}-\d{2}-\d{2}\s*-\s*\d{4}-\d{2}-\d{2}/.test(text(dateLine?.[1]))) {
  throw new Error(`선택일자가 하루가 아닙니다: "${text(dateLine?.[1])}"`);
}
const broadcastDate = dates[0];

const head = rows.findIndex((r) => text(r[0]) === "번호");
if (head < 3) throw new Error("머리글(번호 행)을 찾지 못했습니다.");
const channelRow = rows[head - 3];
const regionRow = rows[head - 2];
const targetRow = rows[head - 1];

// 열 → (채널, 저장 칸)
const COLUMN_OF: Record<string, "p2049_capital" | "household_capital" | "p2049_national" | "household_national"> = {
  "수도권|(P) - P2049": "p2049_capital",
  "수도권|유료방송가구": "household_capital",
  "National|(P) - P2049": "p2049_national",
  "National|유료방송가구": "household_national",
};
const cols: { col: number; channel: string; field: (typeof COLUMN_OF)[string] }[] = [];
let channelCarry = "";
for (let c = 2; c < targetRow.length; c++) {
  if (text(channelRow[c])) channelCarry = text(channelRow[c]);
  const field = COLUMN_OF[`${text(regionRow[c])}|${text(targetRow[c])}`];
  if (channelCarry && field) cols.push({ col: c, channel: channelCarry, field });
}
if (cols.length === 0) throw new Error("읽을 수 있는 열(수도권/National × 유료방송가구/P2049)이 없습니다.");

type Row = { broadcast_date: string; channel_name: string; minute_of_day: number; source_file: string } & Partial<Record<(typeof COLUMN_OF)[string], number | null>>;
const byKey = new Map<string, Row>();
for (const r of rows.slice(head + 1)) {
  const m = text(r[1]).match(/^(\d{1,2}):(\d{2}):\d{2}\s*-/);
  if (!m) continue;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  for (const { col, channel, field } of cols) {
    const key = `${channel}|${minute}`;
    const row = byKey.get(key) ?? { broadcast_date: broadcastDate, channel_name: channel, minute_of_day: minute, source_file: fs.realpathSync(xlsxPath).split(/[\\/]/).pop() ?? "" };
    row[field] = num(r[col]);
    byKey.set(key, row);
  }
}
const out = [...byKey.values()];
const channels = [...new Set(out.map((r) => r.channel_name))];
console.log(`방송일 ${broadcastDate} · 채널 ${channels.join(", ")} · ${out.length}행 (분 ${Math.min(...out.map((r) => r.minute_of_day))}~${Math.max(...out.map((r) => r.minute_of_day))})`);

if (!APPLY) {
  console.log("점검만 했습니다(DB 변경 없음). 적재하려면 맨 끝에 --apply 를 붙이세요.");
} else {
  const { supabase } = await import("../src/lib/supabase");
  for (let i = 0; i < out.length; i += 1000) {
    const { error } = await supabase.from("program_minute_ratings").upsert(out.slice(i, i + 1000), { onConflict: "broadcast_date,channel_name,minute_of_day" });
    if (error) throw new Error(`적재 실패: ${error.message}`);
  }
  console.log(`적재 완료: ${out.length}행`);
}
