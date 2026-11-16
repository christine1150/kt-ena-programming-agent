// skyUHD "프로그램 방영 성과" CSV(IPTV STB 가구·전국) → iptv_stb_ratings(채널 SKYUHD) 빈 곳 채우기(2026-11-16).
// 1페이지 skyUHD 일간 세부 내역의 IPTV 열은 iptv_stb_ratings 를 시간 겹침으로 읽는다. 캡처를 받지 못한 날을 CSV(가구 기준)로 메운다.
// 규칙: 이미 있는 행(캡처 등)은 건드리지 않는다 — 같은 방송일에 시간이 겹치는 기존 행이 있으면 그 CSV 구간은 넣지 않는다.
//  · 달력상 00:00~01:59 시작은 전날 방송일 24~26시대(+1440분). 프로그램명에 <재>가 있으면 그대로, 없으면 <본>을 붙인다(캡처 규칙과 동일).
//  · 시청률은 CSV 값을 그대로(소수 7자리) 담는다.
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/fill-skyuhd-stb-from-csv.mts "<csv 경로>" [--apply]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("사용법: npx tsx ... scripts/fill-skyuhd-stb-from-csv.mts <csv 경로> [--apply]");
  process.exit(1);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let c = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { c += '"'; i++; } else q = false;
      } else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(c); c = ""; }
    else c += ch;
  }
  out.push(c);
  return out;
}
const pad = (n: number | string) => String(n).padStart(2, "0");
const prevDate = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) throw new Error(`시각 형식 오류: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
const lines = text.split(/\r?\n/);
const meta = lines.slice(0, 6).join(" ");
if (!/IPTV STB/.test(meta) || !/skyUHD/i.test(meta)) {
  console.error("skyUHD IPTV STB(가구) 파일이 아닙니다.");
  process.exit(1);
}

type Row = { broadcast_date: string; channel_code: string; start_minute: number; end_minute: number; program_name: string; rating: number | null; below_floor: boolean; source_file: string };
const csvRows = new Map<string, Row>();
let skipped = 0;
const src = `TVINDEX 방영 성과 CSV(가구·전국) 대체 적재 ${file.split(/[\\/]/).pop()}`;
for (const line of lines) {
  if (!line.startsWith('"')) continue;
  const r = parseCsvLine(line);
  if (r.length < 7) continue;
  const dm = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(r[1]);
  const tm = /^(\d{1,2}:\d{2}) ~ (\d{1,2}:\d{2})$/.exec(r[2].trim());
  const v = Number(r[3].replace(/,/g, ""));
  if (!dm || !tm || !Number.isFinite(v)) { skipped++; continue; } // 머리글 등
  const cal = `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}`;
  const s = toMin(tm[1]);
  let e = toMin(tm[2]);
  if (e <= s) e += 1440;
  const early = s < 120;
  const start = early ? s + 1440 : s;
  const end = early ? e + 1440 : e;
  if (end > 1800) { skipped++; continue; }
  const bd = early ? prevDate(cal) : cal;
  const name = /<[본재]>/.test(r[0]) ? r[0] : `${r[0]} <본>`;
  csvRows.set(`${bd}|${start}`, { broadcast_date: bd, channel_code: "SKYUHD", start_minute: start, end_minute: end, program_name: name, rating: v, below_floor: false, source_file: src });
}
const all = [...csvRows.values()];
console.log(`CSV 구간 ${all.length}행 (해석 못 해 건너뛴 ${skipped}행), 방송일 ${all.map((x) => x.broadcast_date).sort()[0]} ~ ${all.map((x) => x.broadcast_date).sort().at(-1)}`);

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
// 기존 skyUHD 행(쪽 나눔 — 1000행 제한)
const existing: { broadcast_date: string; start_minute: number; end_minute: number }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from("iptv_stb_ratings").select("broadcast_date,start_minute,end_minute").eq("channel_code", "SKYUHD").order("broadcast_date").order("start_minute").range(from, from + 999);
  if (error) throw new Error(error.message);
  existing.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const byDate = new Map<string, { s: number; e: number }[]>();
for (const x of existing) (byDate.get(x.broadcast_date) ?? byDate.set(x.broadcast_date, []).get(x.broadcast_date)!).push({ s: x.start_minute, e: x.end_minute });
console.log(`기존 skyUHD 캡처표 ${existing.length}행, ${byDate.size}일`);

const toAdd = all.filter((r) => !(byDate.get(r.broadcast_date) ?? []).some((x) => r.start_minute < x.e && x.s < r.end_minute));
const overlapped = all.length - toAdd.length;
const addDates = new Set(toAdd.map((r) => r.broadcast_date));
const filledByDay = new Map<string, number>();
for (const r of toAdd) filledByDay.set(r.broadcast_date, (filledByDay.get(r.broadcast_date) ?? 0) + 1);
console.log(`추가 ${toAdd.length}행 (${addDates.size}일), 기존 행과 겹쳐 넣지 않은 ${overlapped}행`);
const recent = [...filledByDay].filter(([d]) => d >= "2026-11-01").sort();
console.log("11월 일별 추가:", recent.map(([d, n]) => `${d}=${n}`).join(" ") || "없음");
if (!APPLY) {
  console.log("점검만 했습니다. 넣으려면 --apply 를 붙이세요.");
  process.exit(0);
}
for (let i = 0; i < toAdd.length; i += 1000) {
  const { error } = await supabase.from("iptv_stb_ratings").upsert(toAdd.slice(i, i + 1000), { onConflict: "broadcast_date,channel_code,start_minute" });
  if (error) throw new Error(error.message);
  process.stdout.write(`\r${Math.min(i + 1000, toAdd.length)}/${toAdd.length}`);
}
console.log("\n적재 완료");
