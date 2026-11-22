// skyUHD 닐슨 분당 시청률 엑셀(여러 날 한 시트: 번호·일자·시간대·시청률, 전체 플랫폼·National·유료방송가구)을
// ① program_minute_ratings(SkyUHD, 전국 가구 칸)에 넣고 ② 그 날짜의 비어 있는 프로그램 행(ratings.rating=null)을
// 방영 구간 분당 평균으로 채운다(브리핑·분석이 읽는 닐슨 일일 프로그램 가구 시청률 자리).
// 채우는 방식은 fill-skyuhd-program-ratings.mts 와 같다(IPTV 셋톱 실제 방영 구간이 있으면 그 구간, 없으면 닐슨 행 구간. 이미 값이 있는 행은 건드리지 않음).
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/ingest-skyuhd-minute-multiday.mts "<엑셀 경로>" [--apply]
import fs from "node:fs";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const xlsxPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!xlsxPath) {
  console.error('사용법: npx tsx ... scripts/ingest-skyuhd-minute-multiday.mts "<엑셀 경로>" [--apply]');
  process.exit(1);
}
const text = (v: unknown) => String(v ?? "").trim();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const head = rows.findIndex((r) => text(r[0]) === "번호");
if (head < 3) throw new Error("머리글(번호 행)을 찾지 못했습니다.");
// 머리글 위 3줄: 채널 / 지역 / 타겟 (값은 마지막 열)
const lastCol = (r: unknown[]) => text(r[r.length - 1]);
const [chan, region, target] = [rows[head - 3], rows[head - 2], rows[head - 1]].map(lastCol);
const platform = text(rows.find((r) => text(r[0]) === "플랫폼")?.[0]) && text(rows[rows.findIndex((r) => text(r[0]) === "플랫폼") + 1]?.[0]);
if (!/^SkyUHD$/i.test(chan)) throw new Error(`채널이 SkyUHD 가 아닙니다: ${chan}`);
if (region !== "National" || target !== "유료방송가구") throw new Error(`National × 유료방송가구가 아닙니다: ${region} × ${target}`);
if (platform !== "전체") throw new Error(`플랫폼이 '전체'가 아닙니다: ${platform}`);

// 엑셀 날짜 직렬값 → YYYY-MM-DD (정수 연산)
const iso = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10);

type Min = { broadcast_date: string; channel_name: string; minute_of_day: number; household_national: number; source_file: string };
const out: Min[] = [];
const file = fs.realpathSync(xlsxPath).split(/[\\/]/).pop() ?? "";
for (const r of rows.slice(head + 1)) {
  const m = text(r[2]).match(/^(\d{1,2}):(\d{2}):\d{2}\s*-/);
  if (!m || typeof r[1] !== "number" || typeof r[3] !== "number") continue;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  if (minute < 120 || minute >= 1560) continue;
  out.push({ broadcast_date: iso(r[1]), channel_name: "SkyUHD", minute_of_day: minute, household_national: r[3] as number, source_file: file });
}
const dates = [...new Set(out.map((r) => r.broadcast_date))].sort();
console.log(`채널 SkyUHD · 전국 유료방송가구 · 날짜 ${dates.join(", ")} · ${out.length}행`);
for (const d of dates) {
  const v = out.filter((r) => r.broadcast_date === d);
  if (v.length !== 1440) throw new Error(`${d} 분당 행이 1440개가 아닙니다: ${v.length}`);
}

// ① 분당 적재
if (APPLY) {
  for (let i = 0; i < out.length; i += 1000) {
    const { error } = await sb.from("program_minute_ratings").upsert(out.slice(i, i + 1000), { onConflict: "broadcast_date,channel_name,minute_of_day" });
    if (error) throw new Error(`분당 적재 실패: ${error.message}`);
  }
  console.log(`분당 적재 완료: ${out.length}행`);
}

// ② 비어 있는 프로그램 행 채우기
const { data: ch } = await sb.from("channels").select("id").eq("code", "SKYUHD").single();
const toMin = (t: string) => {
  const [h, mi, se] = t.split(":").map(Number);
  const v = h * 60 + mi + (se || 0) / 60;
  return v < 120 ? v + 1440 : v;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
type Row = { id: string; start_time: string; end_time: string; rating: number | null; programs: { canonical_name: string } | null };
let updated = 0;
let candidates = 0;
for (const date of dates) {
  const minute = new Array<number>(1440).fill(0);
  for (const r of out) if (r.broadcast_date === date) minute[r.minute_of_day - 120] = r.household_national;
  const mean = (s: number, e: number) => {
    let sum = 0, len = 0;
    for (let m = Math.floor(s); m < Math.ceil(e); m++) {
      const w = Math.min(m + 1, e) - Math.max(m, s);
      if (w <= 0) continue;
      sum += (minute[m - 120] ?? 0) * w;
      len += w;
    }
    return len > 0 ? sum / len : null;
  };
  const { data: db } = await sb.from("ratings").select("id, start_time, end_time, rating, programs(canonical_name)").eq("channel_id", ch!.id).eq("broadcast_date", date).is("target_id", null).not("start_time", "is", null).order("start_time");
  const all = (db ?? []) as unknown as Row[];
  const targets = all.filter((r) => r.rating === null);
  console.log(`\n[${date}] 프로그램 행 ${all.length}개 중 비어 있는 행 ${targets.length}개`);
  if (!targets.length) continue;
  const { data: ip } = await sb.from("iptv_stb_ratings").select("start_minute, end_minute").eq("channel_code", "SKYUHD").eq("broadcast_date", date);
  const groups = new Map<string, Row[]>();
  for (const r of targets) groups.set(r.start_time, [...(groups.get(r.start_time) ?? []), r]);
  for (const [start, list] of groups) {
    const r = list[0];
    const s = toMin(r.start_time);
    let e = toMin(r.end_time);
    if (e <= s) e += 1440;
    let best: { start_minute: number; end_minute: number } | null = null;
    let bestOv = 0;
    for (const x of ip ?? []) {
      const ov = Math.min(e, x.end_minute) - Math.max(s, x.start_minute);
      if (ov > bestOv && ov >= 0.5 * Math.min(e - s, x.end_minute - x.start_minute)) { bestOv = ov; best = x; }
    }
    const from = best ? best.start_minute : s;
    const to = best ? best.end_minute : e;
    const v = mean(from, to);
    if (v === null) continue;
    const rating = Math.round(v * 1e5) / 1e5;
    candidates++;
    console.log(`  ${start.slice(0, 5)}~${r.end_time.slice(0, 5)} ${r.programs?.canonical_name} → ${best ? `IPTV ${hhmm(from)}~${hhmm(to)}` : "닐슨 구간"} ${rating}${list.length > 1 ? ` (중복 ${list.length}행)` : ""}`);
    if (!APPLY) continue;
    for (const row of list) {
      const { error } = await sb.from("ratings").update({ rating }).eq("id", row.id).is("rating", null);
      if (error) throw error;
      updated++;
    }
  }
}
console.log(APPLY ? `\n적용 완료: 프로그램 ${candidates}개 방영, ${updated}행 갱신` : "\n점검만 했습니다(DB 변경 없음). 반영하려면 --apply 를 붙이세요.");
