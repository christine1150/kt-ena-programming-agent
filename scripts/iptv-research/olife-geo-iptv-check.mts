// OLIFE 걸세·세테기 나라별 시청률 — 닐슨(기존 엑셀)과 IPTV 를 같은 방송 건(날짜+시작 ±3분)으로 맞춰 나라별 슬롯지수가 같은 방향인지 점검.
// 닐슨이 공식, IPTV 는 교차 점검용(값을 섞지 않고 두 지수를 나란히 둔다). 실행: node --env-file=.env --import tsx scripts/iptv-research/olife-geo-iptv-check.mts
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("docs/olife-geo/OLIFE_나라별_회차별_시청률.xlsx");
const ws = wb.getWorksheet("방송 원자료")!;
type B = { d: string; sm: number; dow: string; band: string; prog: string; ep: string; country: string; nr: number; iptv?: number };
const rows: B[] = [];
ws.eachRow((r, i) => {
  if (i === 1) return;
  const v = (r.values as unknown[]).slice(1) as (string | number | null)[];
  if (!v[0] || v[9] == null || !v[8]) return;
  const [h, m] = String(v[1]).split(":").map(Number);
  rows.push({ d: String(v[0]), sm: (h < 2 ? h + 24 : h) * 60 + m, dow: String(v[2]), band: String(v[3]), prog: String(v[4]), ep: String(v[5]), country: String(v[8]), nr: Number(v[9]) });
});

// IPTV OLIFE 가구 방영(세계테마기행·걸어서 세계속으로)
const ip: { d: string; sm: number; r: number }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("iptv_tvindex_airings").select("broadcast_date, start_minute, rating, program_key").eq("channel_name", "OLIFE").eq("target_kind", "household").gte("broadcast_date", "2025-01-01").in("program_key", ["세계테마기행", "걸어서세계속으로"]).range(from, from + 999);
  if (error) throw error;
  for (const x of data ?? []) if (x.rating != null) ip.push({ d: x.broadcast_date as string, sm: x.start_minute as number, r: Number(x.rating) });
  if (!data || data.length < 1000) break;
}
const byDate = new Map<string, { sm: number; r: number }[]>();
for (const x of ip) byDate.set(x.d, [...(byDate.get(x.d) ?? []), x]);
let matched = 0;
for (const b of rows) {
  const c = (byDate.get(b.d) ?? []).filter((x) => Math.abs(x.sm - b.sm) <= 3).sort((a, z) => Math.abs(a.sm - b.sm) - Math.abs(z.sm - b.sm))[0];
  if (c) { b.iptv = c.r; matched++; }
}
const m = rows.filter((b) => b.iptv != null);
console.log("방송 건", rows.length, "IPTV 짝", matched);

// 슬롯지수 = 시청률 ÷ 같은 프로그램·요일·시간대 평균(짝 지어진 표본 안에서, 닐슨·IPTV 각각)
const key = (b: B) => `${b.prog}|${b.dow}|${b.band}`;
const meanN = new Map<string, number[]>(), meanI = new Map<string, number[]>();
for (const b of m) { (meanN.get(key(b)) ?? meanN.set(key(b), []).get(key(b))!).push(b.nr); (meanI.get(key(b)) ?? meanI.set(key(b), []).get(key(b))!).push(b.iptv!); }
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const byCountry = new Map<string, { ni: number[]; ii: number[]; eps: Set<string> }>();
for (const b of m) {
  const kn = avg(meanN.get(key(b))!), ki = avg(meanI.get(key(b))!);
  if (meanN.get(key(b))!.length < 3 || kn <= 0 || ki <= 0) continue;
  const o = byCountry.get(b.country) ?? { ni: [], ii: [], eps: new Set() };
  o.ni.push(b.nr / kn); o.ii.push(b.iptv! / ki); o.eps.add(b.prog + b.ep);
  byCountry.set(b.country, o);
}
const tab = [...byCountry.entries()].filter(([, o]) => o.ni.length >= 10 && o.eps.size >= 3).map(([c, o]) => ({ 나라: c, 방송건수: o.ni.length, 회차수: o.eps.size, 닐슨_슬롯지수: Number(avg(o.ni).toFixed(3)), IPTV_슬롯지수: Number(avg(o.ii).toFixed(3)) }));
// 순위 상관(스피어만)
const rank = (a: number[]) => { const s = [...a].map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); s.forEach(([, i], k) => (r[i] = k + 1)); return r; };
const rn = rank(tab.map((t) => t.닐슨_슬롯지수)), ri = rank(tab.map((t) => t.IPTV_슬롯지수));
const n = tab.length, mean = (n + 1) / 2;
const cov = rn.reduce((a, x, i) => a + (x - mean) * (ri[i] - mean), 0);
const rho = cov / Math.sqrt(rn.reduce((a, x) => a + (x - mean) ** 2, 0) * ri.reduce((a, x) => a + (x - mean) ** 2, 0));
console.log("나라 수", n, "스피어만 상관", rho.toFixed(2));
const sorted = [...tab].sort((a, b) => b.닐슨_슬롯지수 - a.닐슨_슬롯지수);
console.log("닐슨 상위:", sorted.slice(0, 8).map((t) => `${t.나라} N${t.닐슨_슬롯지수}/I${t.IPTV_슬롯지수}(${t.방송건수})`).join(", "));
console.log("닐슨 하위:", sorted.slice(-8).map((t) => `${t.나라} N${t.닐슨_슬롯지수}/I${t.IPTV_슬롯지수}(${t.방송건수})`).join(", "));
const sortedI = [...tab].sort((a, b) => b.IPTV_슬롯지수 - a.IPTV_슬롯지수);
console.log("IPTV 상위:", sortedI.slice(0, 8).map((t) => `${t.나라} I${t.IPTV_슬롯지수}/N${t.닐슨_슬롯지수}`).join(", "));
const diff = [...tab].sort((a, b) => Math.abs(b.닐슨_슬롯지수 - b.IPTV_슬롯지수) - Math.abs(a.닐슨_슬롯지수 - a.IPTV_슬롯지수)).slice(0, 6);
console.log("가장 엇갈린:", diff.map((t) => `${t.나라} N${t.닐슨_슬롯지수}/I${t.IPTV_슬롯지수}`).join(", "));
const out = new ExcelJS.Workbook();
const o = out.addWorksheet("나라별 닐슨-IPTV 슬롯지수");
o.addRow(Object.keys(tab[0])).font = { bold: true };
for (const t of sorted) o.addRow(Object.values(t));
await out.xlsx.writeFile("docs/iptv/olife_geo_iptv_check.xlsx");
