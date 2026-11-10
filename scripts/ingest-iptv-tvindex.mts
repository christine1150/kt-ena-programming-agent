// IPTV 셋톱(STB) TV INDEX 내려받기 폴더를 DB 에 넣는다(2026-11-10).
//  · "프로그램 방영 성과" CSV  → iptv_tvindex_airings   (채널 × 타깃 × 방송일 × 시작 분)
//  · skyUHD "주간 편성표" CSV   → iptv_stb_ratings       (기존 1페이지 IPTV 열이 쓰는 표, 채널 SKYUHD)
//  · "편성 성과 인사이트" CSV   → iptv_tvindex_daypart_avg (요일×시간대 평균)
// 방송일은 닐슨과 같은 02:00~익일 02:00 기준: 달력상 00:00~01:59 에 시작한 구간은 전날 방송일의 24~26시대(+1440분)로 담는다.
// 같은 키를 다시 넣으면 새 값으로 바뀐다(upsert). 기본은 점검만 한다.
//
// 사용법: npx tsx --env-file=.env --env-file=.env.local scripts/ingest-iptv-tvindex.mts "<폴더>" [--apply]
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { normalizeProgramCanonicalName } from "../src/lib/programNameMatch";

const APPLY = process.argv.includes("--apply");
const root = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!root) {
  console.error('사용법: npx tsx --env-file=.env --env-file=.env.local scripts/ingest-iptv-tvindex.mts "<폴더>" [--apply]');
  process.exit(1);
}

const OWN = new Set(["ENA", "ENA Drama", "ENA Play", "ENA Story", "OLIFE", "ONCE", "skyUHD"]);
const UHD = new Set(["Asia UHD", "SBS NEX", "UHD Dream", "UMAX", "UXN"]);
const NAME_FIX: Record<string, string> = { "E 채널": "E채널", "ㅡMBC every1": "MBC every1" };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith(".csv")) out.push(p);
  }
  return out;
}
function parseCsv(t: string): string[][] {
  const rows: string[][] = [];
  let r: string[] = [];
  let c = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') { c += '"'; i++; } else q = false;
      } else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { r.push(c); c = ""; }
    else if (ch === "\n") { r.push(c.replace(/\r$/, "")); rows.push(r); r = []; c = ""; }
    else c += ch;
  }
  if (c || r.length) { r.push(c); rows.push(r); }
  return rows;
}
const readCsv = (f: string) => parseCsv(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const pad = (n: number | string) => String(n).padStart(2, "0");
const parseDate = (s: string) => {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
};
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
const num = (s: string | undefined) => {
  if (s == null) return null;
  const v = s.replace(/,/g, "").trim();
  if (v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** "HH:MM ~ HH:MM" + 달력 날짜 → 방송일·시작 분·끝 분 (02:00 경계 규칙) */
function slot(calendarDate: string, range: string) {
  const [a, b] = range.split("~");
  const s = toMin(a);
  let e = toMin(b);
  if (e <= s) e += 1440; // 자정을 넘겨 끝나는 구간
  const early = s < 120;
  return {
    broadcast_date: early ? prevDate(calendarDate) : calendarDate,
    start_minute: early ? s + 1440 : s,
    end_minute: early ? e + 1440 : e,
  };
}

type Airing = {
  channel_name: string; channel_group: string; target_kind: string; broadcast_date: string; start_minute: number; end_minute: number;
  program_name: string; program_key: string; is_rerun_tag: boolean; rating: number | null; reach_viewers: number | null;
  avg_minute_viewers: number | null; reach_rate: number | null; source_file: string;
};
type Weekly = { broadcast_date: string; channel_code: string; start_minute: number; end_minute: number; program_name: string; rating: number | null; below_floor: boolean; source_file: string };
type Daypart = { channel_name: string; target_kind: string; period_from: string; period_to: string; dow: number; hour_of_day: number; rating: number | null; source_file: string };

const airings = new Map<string, Airing>();
const weekly = new Map<string, Weekly>();
const dayparts: Daypart[] = [];
let collisions = 0;
let skipped = 0;
const perFile: string[] = [];

for (const f of walk(root).sort()) {
  const base = path.basename(f);
  const rows = readCsv(f);
  const header = rows.findIndex((r) => r[0] === "프로그램" || r[0] === "방영기간" || r[0] === "방영 시간대");
  if (header < 0) { perFile.push(`건너뜀(머리글 없음): ${base}`); continue; }
  const meta = rows.slice(0, header).map((r) => r[0] ?? "").join(" ");
  const targetKind = /IPTV STB/.test(meta) ? "household" : /개인 2049/.test(meta) ? "p2049" : null;
  if (!targetKind) { perFile.push(`건너뜀(타깃 불명): ${base}`); continue; }

  if (rows[header][0] === "프로그램") {
    // 프로그램 방영 성과
    const m = /^TVINDEX_프로그램_방영_성과_(.+?)\s*(?:가구|수2049)?_\d+(?: \(\d+\))?\.csv$/.exec(base);
    if (!m) { perFile.push(`건너뜀(파일명 해석 실패): ${base}`); continue; }
    const channel = NAME_FIX[m[1].trim()] ?? m[1].trim();
    const group = OWN.has(channel) ? "own" : UHD.has(channel) ? "uhd" : "comp";
    let n = 0;
    for (const r of rows.slice(header + 1)) {
      if (r.length < 7 || !r[0]) continue;
      const d = parseDate(r[1]);
      if (!d) { skipped++; continue; }
      let sl;
      try { sl = slot(d, r[2]); } catch { skipped++; continue; }
      if (sl.end_minute > 1800) { skipped++; continue; }
      const key = [channel, targetKind, sl.broadcast_date, sl.start_minute, normalizeProgramCanonicalName(r[0]) || r[0]].join("|");
      if (airings.has(key)) collisions++;
      airings.set(key, {
        channel_name: channel, channel_group: group, target_kind: targetKind, ...sl,
        program_name: r[0], program_key: normalizeProgramCanonicalName(r[0]) || r[0], is_rerun_tag: /<재>/.test(r[0]),
        rating: num(r[3]), reach_viewers: num(r[4]), avg_minute_viewers: num(r[5]), reach_rate: num(r[6]), source_file: base,
      });
      n++;
    }
    perFile.push(`${group.padEnd(4)} ${channel.padEnd(12)} ${targetKind.padEnd(9)} ${n}행`);
  } else if (rows[header][0] === "방영기간") {
    // skyUHD 주간 편성표 → iptv_stb_ratings
    const chan = rows[1]?.[0]?.split(">")[0].trim().toUpperCase();
    if (chan !== "SKYUHD" || targetKind !== "household") { perFile.push(`건너뜀(주간 편성표는 skyUHD IPTV STB 만): ${base}`); continue; }
    let n = 0;
    for (const r of rows.slice(header + 1)) {
      if (r.length < 4 || !r[0]) continue;
      const d = parseDate(r[0]);
      const v = num(r[3]);
      if (!d || v == null) { skipped++; continue; }
      const sl = slot(d, r[1]);
      if (sl.end_minute > 1800) { skipped++; continue; }
      weekly.set([sl.broadcast_date, "SKYUHD", sl.start_minute].join("|"), {
        broadcast_date: sl.broadcast_date, channel_code: "SKYUHD", start_minute: sl.start_minute, end_minute: sl.end_minute,
        program_name: r[2], rating: v, below_floor: false, source_file: base,
      });
      n++;
    }
    perFile.push(`주간편성표 skyUHD ${n}행`);
  } else if (rows[header][0] === "방영 시간대") {
    // 편성 성과 인사이트 (요일×시간대)
    const mm = /내 채널 : ([^,]+),/.exec(meta);
    const per = /(\d{4}\/\d{1,2}\/\d{1,2}) \([^)]\) ~ (\d{4}\/\d{1,2}\/\d{1,2})/.exec(meta);
    if (!mm || !per) { perFile.push(`건너뜀(인사이트 메타 해석 실패): ${base}`); continue; }
    let n = 0;
    for (const r of rows.slice(header + 1)) {
      const h = /^(\d{2}):00 ~/.exec(r[0] ?? "");
      if (!h) continue;
      for (let dow = 0; dow < 7; dow++) {
        dayparts.push({
          channel_name: mm[1].trim(), target_kind: targetKind, period_from: parseDate(per[1])!, period_to: parseDate(per[2])!,
          dow, hour_of_day: Number(h[1]), rating: num(r[1 + dow]), source_file: base,
        });
        n++;
      }
    }
    perFile.push(`요일×시간대 ${mm[1].trim()} ${n}칸`);
  }
}

// 같은 파일이 두 폴더에 중복으로 있어도(예: skyUHD) 키가 같아 한 번만 들어간다.
console.log(perFile.join("\n"));
const aList = [...airings.values()];
const wList = [...weekly.values()];
console.log(`\n방영 성과 ${aList.length}행 (키 충돌로 덮어쓴 ${collisions}건, 건너뛴 ${skipped}행)`);
console.log(`주간 편성표 ${wList.length}행, 요일×시간대 ${dayparts.length}칸`);
const byGroup = new Map<string, number>();
for (const a of aList) byGroup.set(`${a.channel_group}/${a.target_kind}`, (byGroup.get(`${a.channel_group}/${a.target_kind}`) ?? 0) + 1);
console.log([...byGroup].map(([k, v]) => `${k}=${v}`).join("  "));
if (!APPLY) {
  console.log("점검만 했습니다. 넣으려면 --apply 를 붙이세요.");
  process.exit(0);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function load<T extends object>(table: string, list: T[], onConflict: string, batch = 2000, parallel = 4) {
  let done = 0;
  const chunks: T[][] = [];
  for (let i = 0; i < list.length; i += batch) chunks.push(list.slice(i, i + batch));
  for (let i = 0; i < chunks.length; i += parallel) {
    await Promise.all(chunks.slice(i, i + parallel).map(async (c) => {
      for (let attempt = 1; ; attempt++) {
        const { error } = await supabase.from(table).upsert(c, { onConflict });
        if (!error) break;
        if (attempt >= 4) throw new Error(`${table}: ${error.message}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
      done += c.length;
    }));
    process.stdout.write(`\r${table} ${done}/${list.length}`);
  }
  process.stdout.write("\n");
}
await load("iptv_tvindex_airings", aList, "channel_name,target_kind,broadcast_date,start_minute,program_key");
await load("iptv_stb_ratings", wList, "broadcast_date,channel_code,start_minute");
await load("iptv_tvindex_daypart_avg", dayparts, "channel_name,target_kind,period_from,period_to,dow,hour_of_day");
console.log("적재 완료");
