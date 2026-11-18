// skyUHD 방송일의 프로그램 행(rating=null)을 닐슨 분당 시청률(program_minute_ratings, SkyUHD)로 채우고,
// 같은 방영을 IPTV 셋톱(TV INDEX "프로그램 방영 성과" CSV, 수도권 개인2049)과 시각으로 짝지어 비교한다.
// 값은 방영 구간 [시작,종료)의 분당 값을 초 단위 겹침으로 시간 가중 평균한 것이다(새 지표를 만들지 않고 DB 분당 값을 그대로 평균).
// skyUHD 수기 파일의 프로그램 행은 전국 유료방송가구 시청률이라(9~10월 일일 집계와 대조해 확인) 전국 가구 열을 쓴다.
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/skyuhd-minute-fill.mts 2026-11-18 "<TV INDEX CSV>" [--apply]
import fs from "node:fs";
import { supabase } from "../src/lib/supabase";

const [date, csvPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error('사용법: ... skyuhd-minute-fill.mts YYYY-MM-DD "<CSV>" [--apply]');

const sec = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return (h < 2 ? h + 24 : h) * 3600 + m * 60 + (s || 0); // 방송일 기준 초(02시 전은 +24시간)
};
const hhmm = (s: number) => `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

const { data: ch } = await supabase.from("channels").select("id").eq("code", "SKYUHD").single();
const minutes: { minute_of_day: number; household_national: number | null; p2049_capital: number | null }[] = [];
for (let i = 0; ; i += 1000) {
  const { data, error } = await supabase.from("program_minute_ratings").select("minute_of_day,household_national,p2049_capital").eq("channel_name", "SkyUHD").eq("broadcast_date", date).order("minute_of_day").range(i, i + 999);
  if (error) throw new Error(error.message);
  minutes.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}
if (!minutes.length) throw new Error(`${date} SkyUHD 분당 자료가 없습니다.`);
const byMin = new Map(minutes.map((m) => [m.minute_of_day as number, m]));
function avg(fromSec: number, toSec: number, field: "household_national" | "p2049_capital"): number | null {
  let s = 0, w = 0;
  for (let m = Math.floor(fromSec / 60); m * 60 < toSec; m++) {
    const v = byMin.get(m)?.[field];
    if (v === null || v === undefined) continue;
    const ov = Math.min(toSec, (m + 1) * 60) - Math.max(fromSec, m * 60);
    if (ov > 0) { s += v * ov; w += ov; }
  }
  return w > 0 ? s / w : null;
}

const { data: rows } = await supabase.from("ratings").select("id,start_time,end_time,rating,programs(canonical_name),episode_subtitle").eq("channel_id", ch!.id).eq("broadcast_date", date).not("program_id", "is", null).order("start_time");
const sched = (rows ?? []).filter((r) => r.start_time && r.end_time).map((r) => ({ ...r, s: sec(r.start_time as string), e: sec(r.end_time as string) })).sort((a, b) => a.s - b.s);

// IPTV CSV: "2026/11/18 (수)" "02:01 ~ 02:44" → 방송일 기준 초
type Iptv = { name: string; s: number; e: number; rating: number };
const iptv: Iptv[] = [];
if (csvPath) {
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const nextStr = next.toISOString().slice(0, 10).replace(/-/g, "/");
  const dayStr = date.replace(/-/g, "/");
  for (const line of fs.readFileSync(csvPath, "utf8").split(/\r?\n/)) {
    const c = line.match(/"([^"]*)"/g)?.map((x) => x.slice(1, -1));
    if (!c || c.length < 4) continue;
    const dm = c[1].match(/^(\d{4}\/\d{1,2}\/\d{1,2})/);
    const tm = c[2].match(/(\d{2}:\d{2}) ~ (\d{2}:\d{2})/);
    if (!dm || !tm) continue;
    const d = dm[1].replace(/\/(\d)(?=\/|$)/g, "/0$1");
    if (d !== dayStr && d !== nextStr) continue;
    const s = sec(tm[1] + ":00");
    // 달력 다음 날(00~01시대)은 이미 +24시간으로 계산되고, 같은 날 02시 이후는 그대로다. 달력 다음 날 02시 이후 값은 방송일 밖이다.
    if (d === nextStr && s < 24 * 3600) continue;
    if (d === dayStr && s >= 24 * 3600) continue;
    let e = sec(tm[2] + ":00"); if (e <= s) e += 24 * 3600;
    iptv.push({ name: c[0], s, e, rating: parseFloat(c[3]) });
  }
}
console.log(`방송일 ${date}: 편성 행 ${sched.length}, 분당 ${minutes.length}분, IPTV 방영 ${iptv.length}건`);
console.log("시작  종료  프로그램                       닐슨(전국가구) 닐슨(수도권2049) IPTV(수도권2049) 비율");
const updates: { id: string; rating: number }[] = [];
for (const r of sched) {
  const hh = avg(r.s, r.e, "household_national");
  const p = avg(r.s, r.e, "p2049_capital");
  const m = iptv.find((x) => Math.abs(x.s - r.s) <= 150) ?? null;
  const name = ((r.programs as any)?.canonical_name ?? "") + (r.episode_subtitle ? ` ${r.episode_subtitle}` : "");
  console.log(`${hhmm(r.s)} ${hhmm(r.e)} ${name.padEnd(24)} ${hh?.toFixed(5) ?? "-"}  ${p?.toFixed(5) ?? "-"}  ${m ? m.rating.toFixed(5) : "-"}  ${m && p ? (p / m.rating).toFixed(2) : ""}${r.rating !== null ? `  (기존 ${r.rating})` : ""}`);
  if (r.rating === null && hh !== null) updates.push({ id: r.id as string, rating: Math.round(hh * 100000) / 100000 });
}
console.log(`채울 행 ${updates.length}개`);
if (APPLY) {
  for (const u of updates) {
    const { error } = await supabase.from("ratings").update({ rating: u.rating }).eq("id", u.id).is("rating", null);
    if (error) throw new Error(error.message);
  }
  console.log("적재 완료");
}
