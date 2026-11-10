// skyUHD 오리지널 드라마·예능의 칸(요일×8대 시간대)별·작품별 평소 대비(같은 달·요일·시간대 skyUHD 평균 대비) 재계산 — 장르는 iptv_program_genre(2026-11-11 당사 오리지널 목록 기준).
// 사용법: npx tsx --env-file=.env --env-file=.env.local scripts/iptv-research/skyuhd-original-slots.mts
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;
const FROM = "2025-07-01", TO = "2026-11-09";
let rows: any[] = [];
for (let a = 0; ; a += 1000) {
  const { data, error } = await db.from("iptv_airing_metrics").select("program_key,rating,duration_min,broadcast_date,dow,slot_band").eq("channel_name", "skyUHD").eq("target_kind", "household").gte("broadcast_date", FROM).lte("broadcast_date", TO).gt("duration_min", 0).not("rating", "is", null).range(a, a + 999);
  if (error) throw error;
  rows = rows.concat(data ?? []);
  if ((data ?? []).length < 1000) break;
}
const gen = new Map<string, string>();
for (let a = 0; ; a += 1000) { const { data } = await db.from("iptv_program_genre").select("program_key,genre").range(a, a + 999); for (const g of data ?? []) gen.set(g.program_key, g.genre); if ((data ?? []).length < 1000) break; }
const wavg = (xs: { v: number; w: number }[]) => xs.reduce((s, x) => s + x.v * x.w, 0) / xs.reduce((s, x) => s + x.w, 0);
const base = new Map<string, { v: number; w: number }[]>();
for (const r of rows) { const k = `${r.broadcast_date.slice(0, 7)}|${r.dow}|${r.slot_band}`; (base.get(k) ?? base.set(k, []).get(k)!).push({ v: Number(r.rating), w: r.duration_min }); }
const bm = new Map([...base].map(([k, v]) => [k, wavg(v)]));
type A = { g: string; pk: string; ratio: number; w: number; dow: number; band: string };
const air: A[] = [];
for (const r of rows) { const b = bm.get(`${r.broadcast_date.slice(0, 7)}|${r.dow}|${r.slot_band}`); if (!b) continue; air.push({ g: gen.get(r.program_key) ?? "미분류", pk: r.program_key, ratio: Number(r.rating) / b, w: r.duration_min, dow: r.dow, band: r.slot_band }); }
const DOW = ["월", "화", "수", "목", "금", "토", "일"], BANDS = ["02-05", "05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02"];
for (const G of ["오리지널 드라마", "오리지널 예능"]) {
  const sub = air.filter((a) => a.g === G);
  console.log(`\n== ${G}: 방영 ${sub.length}건, 작품 ${new Set(sub.map((a) => a.pk)).size}개, 전체 평소 대비 ${wavg(sub.map((a) => ({ v: a.ratio, w: a.w }))).toFixed(2)}`);
  const byPk = new Map<string, A[]>(); for (const a of sub) (byPk.get(a.pk) ?? byPk.set(a.pk, []).get(a.pk)!).push(a);
  console.log("[작품별 평소 대비 — 방영 20건 이상]");
  for (const [pk, xs] of [...byPk].filter(([, x]) => x.length >= 20).sort((a, b) => wavg(b[1].map((x) => ({ v: x.ratio, w: x.w }))) - wavg(a[1].map((x) => ({ v: x.ratio, w: x.w }))))) console.log(`  ${pk} ${xs.length}건 ${wavg(xs.map((x) => ({ v: x.ratio, w: x.w }))).toFixed(2)}`);
  console.log("[시간대별(요일 묶음) 평소 대비 · 방영 건수]  평일/토/일");
  for (const b of BANDS) {
    const f = (ds: number[]) => { const x = sub.filter((a) => a.band === b && ds.includes(a.dow)); return x.length >= 8 ? `${wavg(x.map((y) => ({ v: y.ratio, w: y.w }))).toFixed(2)}(${x.length})` : `–(${x.length})`; };
    console.log(`  ${b}: 평일 ${f([0, 1, 2, 3, 4])}  토 ${f([5])}  일 ${f([6])}`);
  }
}
// 칸별 해 본 장르 중 최고(15건 이상)
console.log("\n[칸별: 오리지널 장르 평소 대비 1.10 이상, 15건 이상]");
for (const G of ["오리지널 드라마", "오리지널 예능"]) for (let d = 0; d < 7; d++) for (const b of BANDS) { const x = air.filter((a) => a.g === G && a.dow === d && a.band === b); if (x.length >= 15) { const r = wavg(x.map((y) => ({ v: y.ratio, w: y.w }))); if (r >= 1.1) console.log(`  ${G} ${DOW[d]} ${b} ${r.toFixed(2)} (${x.length}건)`); } }
