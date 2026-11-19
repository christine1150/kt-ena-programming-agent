// EBS 시청률.xlsx(닐슨, 유료방송가구·National, 프로그램 단위) → external_channel_program_ratings 적재.
// 실행: npx tsx --env-file=.env scripts/load-ebs-ratings.mts "<EBS 시청률.xlsx 경로>"
// 같은 (채널·방송일·시작·프로그램·타깃)은 upsert라 다시 실행해도 중복되지 않는다.
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2];
if (!file) throw new Error("엑셀 경로를 인자로 주세요.");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
// 머리글: '타겟' 아래 줄이 타깃 이름, '지역' 오른쪽이 지역
let target = "유료방송가구", region = "National";
ws.eachRow((row, i) => {
  if (i > 25) return;
  const v = row.values as unknown[];
  if (v[1] === "타겟") target = String((ws.getRow(i + 1).values as unknown[])[1] ?? target);
  if (v[6] === "지역") region = String(v[7] ?? region);
});
const tm = (d: unknown) => (d instanceof Date ? d.toISOString().slice(11, 19) : null);
const rows: Record<string, unknown>[] = [];
ws.eachRow((row, i) => {
  if (i <= 21) return;
  const v = row.values as unknown[];
  if (!(v[1] instanceof Date) || typeof v[7] !== "number") return;
  const name = String(v[2]).trim();
  const len = tm(v[5]);
  rows.push({
    channel_name: "EBS",
    broadcast_date: (v[1] as Date).toISOString().slice(0, 10),
    start_time: tm(v[3]), end_time: tm(v[4]),
    duration_sec: len ? Number(len.slice(0, 2)) * 3600 + Number(len.slice(3, 5)) * 60 + Number(len.slice(6, 8)) : null,
    program_name: name, program_base: name.replace(/<재>/g, "").replace(/\s+/g, ""), is_rerun: name.includes("<재>"),
    genre: v[6] ? String(v[6]) : null, target_label: target, region, rating: v[7],
    source_file: "EBS 시청률.xlsx (2026-11-19)",
  });
});
console.log(`읽음 ${rows.length}행, 타깃 ${target}, 지역 ${region}`);
let done = 0;
for (let i = 0; i < rows.length; i += 1000) {
  const { error } = await sb.from("external_channel_program_ratings").upsert(rows.slice(i, i + 1000), { onConflict: "channel_name,broadcast_date,start_time,program_name,target_label" });
  if (error) throw error;
  done += Math.min(1000, rows.length - i);
}
console.log(`적재 ${done}행`);
