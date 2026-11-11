// skyUHD 편성 인사이트의 닐슨 교차 확인(2026-11-11). skyUHD 닐슨은 수기 파일(ratings, source_type=skyuhd, target_id 비움)이라
// iptv_nielsen_match 에 없다 — 여기서 같은 방영 건(방송일 + 시작 ±3분)으로 IPTV 가구 방영과 직접 짝짓는다.
// 닐슨은 방영 건의 63~79%가 0이라 중앙값 대신 평균으로, 작품 평균·재방 시점 묶음·블록 위치 같은 집계 수준에서만 비교한다.
// 실행: node --env-file=.env --import tsx scripts/iptv-research/skyuhd-nielsen-xcheck.mts  → docs/iptv/skyuhd_nielsen_xcheck.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FROM = "2026-01-01", TO = "2026-11-10";
const { data: ch } = await sb.from("channels").select("id").eq("code", "SKYUHD").single();

type I = { d: string; s: number; e: number; pk: string; pn: string; rerun: boolean; r: number; dow: number; band: string; n?: number };
const ip: I[] = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,end_minute,program_key,program_name,is_rerun_tag,rating,dow,slot_band")
    .eq("channel_name", "skyUHD").eq("target_kind", "household").gte("broadcast_date", "2025-07-01").lte("broadcast_date", TO)
    .order("broadcast_date").order("start_minute").order("program_key").range(f, f + 999);
  if (error) throw error;
  for (const x of data ?? []) ip.push({ d: x.broadcast_date, s: x.start_minute, e: x.end_minute, pk: x.program_key, pn: x.program_name, rerun: x.is_rerun_tag, r: Number(x.rating ?? 0), dow: x.dow, band: x.slot_band });
  if (!data || data.length < 1000) break;
}
const nl: { d: string; s: number; r: number }[] = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from("ratings").select("broadcast_date,start_time,rating").eq("channel_id", ch!.id).eq("source_type", "skyuhd")
    .gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("id").range(f, f + 999);
  if (error) throw error;
  for (const x of data ?? []) {
    if (x.rating == null || !x.start_time) continue;
    const [h, m] = String(x.start_time).split(":").map(Number);
    nl.push({ d: x.broadcast_date, s: (h < 2 ? h + 24 : h) * 60 + m, r: Number(x.rating) });
  }
  if (!data || data.length < 1000) break;
}
const byDate = new Map<string, typeof nl>();
for (const x of nl) (byDate.get(x.d) ?? byDate.set(x.d, []).get(x.d)!).push(x);
let matched = 0;
for (const a of ip) {
  if (a.d < FROM) continue;
  const c = (byDate.get(a.d) ?? []).filter((x) => Math.abs(x.s - a.s) <= 3).sort((p, q) => Math.abs(p.s - a.s) - Math.abs(q.s - a.s))[0];
  if (c) { a.n = c.r; matched++; }
}
const m26 = ip.filter((a) => a.d >= FROM && a.n != null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null);
const r3 = (v: number | null) => (v == null ? null : Number(v.toFixed(3)));
console.log(`IPTV 2026 ${ip.filter((a) => a.d >= FROM).length}건 · 닐슨 ${nl.length}건 · 짝 ${matched}건 · 닐슨 0 비율 ${(m26.filter((a) => a.n === 0).length / m26.length).toFixed(2)}`);

// 칸 평균(요일×시간대) — 두 자료 각각, 짝 지어진 표본 안에서
const cellMean = (val: (a: I) => number) => {
  const m = new Map<string, number[]>();
  for (const a of m26) (m.get(`${a.dow}|${a.band}`) ?? m.set(`${a.dow}|${a.band}`, []).get(`${a.dow}|${a.band}`)!).push(val(a));
  return new Map([...m].map(([k, v]) => [k, mean(v)!]));
};
const cN = cellMean((a) => a.n!), cI = cellMean((a) => a.r);
const normN = (a: I) => { const c = cN.get(`${a.dow}|${a.band}`)!; return c > 0 ? a.n! / c : null; };
const normI = (a: I) => { const c = cI.get(`${a.dow}|${a.band}`)!; return c > 0 ? a.r / c : null; };

// ① 작품별 평균 대비(채널 평균 대비) — 방영 30회 이상
const chN = mean(m26.map((a) => a.n!))!, chI = mean(m26.map((a) => a.r))!;
const byP = new Map<string, I[]>();
for (const a of m26) (byP.get(a.pk) ?? byP.set(a.pk, []).get(a.pk)!).push(a);
const programs = [...byP.values()].filter((as) => as.length >= 30).map((as) => ({
  작품: as[0].pn.replace(/\s*<[^>]+>/g, ""), 방영수: as.length,
  IPTV_평균대비: r3(mean(as.map((a) => a.r))! / chI), 닐슨_평균대비: r3(mean(as.map((a) => a.n!))! / chN),
  닐슨_0비율: r3(as.filter((a) => a.n === 0).length / as.length),
  // 시간대 효과를 뺀 값: 방영마다 같은 요일×시간대 평균으로 나눈 뒤 평균(칸 평균이 0인 방영은 닐슨에서 제외)
  IPTV_칸대비: r3(mean(as.map(normI).filter((v): v is number => v != null))),
  닐슨_칸대비: r3(mean(as.map(normN).filter((v): v is number => v != null))),
  주력_시간대: (() => { const m = new Map<string, number>(); as.forEach((a) => m.set(a.band, (m.get(a.band) ?? 0) + 1)); return [...m].sort((p, q) => q[1] - p[1]).slice(0, 2).map(([k, v]) => `${k}(${v})`).join(" "); })(),
})).sort((a, b) => (b.IPTV_평균대비 ?? 0) - (a.IPTV_평균대비 ?? 0));
const rank = (xs: number[]) => { const s = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length); s.forEach(([, i], k) => (r[i] = k + 1)); return r; };
const ri = rank(programs.map((p) => p.IPTV_평균대비!)), rn = rank(programs.map((p) => p.닐슨_평균대비!));
const nP = programs.length, mr = (nP + 1) / 2;
const rho = ri.reduce((s, x, i) => s + (x - mr) * (rn[i] - mr), 0) / Math.sqrt(ri.reduce((s, x) => s + (x - mr) ** 2, 0) * rn.reduce((s, x) => s + (x - mr) ** 2, 0));

// ② 재방 시점(마지막 본방 후 경과일) — 칸 평균 대비의 평균
const BUCKETS = ["1일 이내", "2~7일", "8~30일", "31~90일", "91일 이상"];
const lastFirst = new Map<string, string>();
const rb: Record<string, { n: number[]; i: number[] }> = Object.fromEntries(BUCKETS.map((b) => [b, { n: [], i: [] }]));
for (const a of [...ip].sort((p, q) => (p.d === q.d ? p.s - q.s : p.d < q.d ? -1 : 1))) {
  if (!a.rerun) { lastFirst.set(a.pk, a.d); continue; }
  if (a.d < FROM || a.n == null) continue;
  const lf = lastFirst.get(a.pk);
  if (!lf) continue;
  const days = Math.round((Date.parse(a.d) - Date.parse(lf)) / 86400000);
  const b = days <= 1 ? BUCKETS[0] : days <= 7 ? BUCKETS[1] : days <= 30 ? BUCKETS[2] : days <= 90 ? BUCKETS[3] : BUCKETS[4];
  const vn = normN(a), vi = normI(a);
  if (vn != null && vi != null) { rb[b].n.push(vn); rb[b].i.push(vi); }
}
const rerun = BUCKETS.map((b) => ({ 경과일: b, 표본: rb[b].n.length, IPTV: r3(mean(rb[b].i)), 닐슨: r3(mean(rb[b].n)) }));

// ③ 연속 블록 위치(같은 날 같은 작품 10분 안쪽 연속) — 칸 평균 대비의 평균, 블록 첫 회차 대비
const pos: Record<number, { n: number[]; i: number[]; n1: number[]; i1: number[] }> = { 1: { n: [], i: [], n1: [], i1: [] }, 2: { n: [], i: [], n1: [], i1: [] }, 3: { n: [], i: [], n1: [], i1: [] }, 4: { n: [], i: [], n1: [], i1: [] } };
const days = new Map<string, I[]>();
for (const a of m26) (days.get(a.d) ?? days.set(a.d, []).get(a.d)!).push(a);
for (const day of days.values()) {
  day.sort((p, q) => p.s - q.s);
  let cur: I[] = [];
  const flush = () => {
    if (cur.length >= 2) cur.slice(0, 4).forEach((a, k) => { const vn = normN(a), vi = normI(a); if (vn != null && vi != null) { pos[k + 1].n.push(vn); pos[k + 1].i.push(vi); } });
    cur = [];
  };
  for (const a of day) { const p = cur[cur.length - 1]; if (p && p.pk === a.pk && a.s - p.e <= 10) cur.push(a); else { flush(); cur = [a]; } }
  flush();
}
const block = [1, 2, 3, 4].map((k) => ({
  위치: `${k}번째`, 표본: pos[k].n.length,
  IPTV: r3(mean(pos[k].i)! / mean(pos[1].i)!), 닐슨: r3(mean(pos[k].n)! / mean(pos[1].n)!),
}));

const out = { period: { from: FROM, to: TO }, matched, zeroShare: r3(m26.filter((a) => a.n === 0).length / m26.length), programSpearman: r3(rho), programs, rerun, block };
fs.writeFileSync("docs/iptv/skyuhd_nielsen_xcheck.json", JSON.stringify(out, null, 1));
console.log(`작품 ${nP}개 순위상관 ${rho.toFixed(2)}`);
console.table(programs.slice(0, 15));
console.table(rerun);
console.table(block);
