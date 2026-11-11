// 자사 채널 편성 분석 보고서용 계산(공통판, 2026-11-11 사용자 지시 "ONCE랑 ENA Drama도 분석해줘").
// skyuhd-programming-report.mts 와 같은 틀을 비교군(iptv_peer_groups)과 채널 KPI 타깃으로 일반화했다. 수치는 모두 여기서 계산한다(원칙 1).
// IPTV(TV INDEX 셋톱) 가 기준 자료이고, 자사 채널은 같은 방영 건 닐슨 값(iptv_nielsen_match)으로 교차 확인한다. 두 값은 섞지 않는다.
// 실행: node --env-file=.env --import tsx scripts/iptv-research/channel-programming-report.mts "ENA Drama"
//   → docs/iptv/programming_report_<채널>.json(+xlsx)
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const OWN = process.argv[2];
const CFG: Record<string, { target: string; group: string }> = {
  "ENA Drama": { target: "p2049", group: "drama" },
  ONCE: { target: "household", group: "drama" },
  ENA: { target: "p2049", group: "drama" },
  "ENA Play": { target: "p2049", group: "variety" },
  "ENA Story": { target: "household", group: "variety" },
  OLIFE: { target: "household", group: "hobby" },
};
if (!OWN || !CFG[OWN]) { console.error(`채널: ${Object.keys(CFG).join(", ")}`); process.exit(1); }
const { target: TK, group: GROUP } = CFG[OWN];
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FROM = "2024-08-01", TO = "2026-11-10", RECENT = "2025-08-01";
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];

type A = { ch: string; d: string; s: number; e: number; pn: string; pk: string; rerun: boolean; r: number; reach: number | null; amv: number | null; dur: number; dow: number; band: string; n?: number; ns?: number };
const clean = (s: string) => s.replace(/\s*<[^>]+>/g, "").trim();
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const wmean = (xs: A[], v: (a: A) => number = (a) => a.r) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + v(a) * a.dur, 0) / w : null; };
const r4 = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const nums = (xs: (number | null)[]) => xs.filter((v): v is number => v != null && Number.isFinite(v));

async function load(ch: string): Promise<A[]> {
  const out: A[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,end_minute,program_name,program_key,is_rerun_tag,rating,reach_viewers,avg_minute_viewers,duration_min,dow,slot_band")
      .eq("channel_name", ch).eq("target_kind", TK).gte("broadcast_date", FROM).lte("broadcast_date", TO)
      .order("broadcast_date").order("start_minute").order("program_key").range(f, f + 999);
    if (error) throw new Error(`${ch}: ${error.message}`);
    for (const x of data ?? []) if (x.rating != null && Number(x.duration_min) > 0)
      out.push({ ch, d: x.broadcast_date, s: x.start_minute, e: x.end_minute, pn: clean(x.program_name), pk: x.program_key, rerun: x.is_rerun_tag, r: Number(x.rating), reach: x.reach_viewers == null ? null : Number(x.reach_viewers), amv: x.avg_minute_viewers == null ? null : Number(x.avg_minute_viewers), dur: Number(x.duration_min), dow: x.dow, band: x.slot_band });
    if (!data || data.length < 1000) break;
  }
  return out;
}

const { data: members } = await sb.from("iptv_peer_groups").select("iptv_channel_name, role").eq("group_key", GROUP);
const data = new Map<string, A[]>();
// 3번째 인자로 비교 채널을 쉼표로 주면 그 채널들만 비교한다(2026-11-11: ONCE는 가구 강한 채널, ENA Drama는 2049 강한 채널 위주)
const PEERS = process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean);
const names = [...new Set([OWN, ...(PEERS ?? (members ?? []).map((m) => m.iptv_channel_name as string))])];
for (let i = 0; i < names.length; i += 6) await Promise.all(names.slice(i, i + 6).map(async (c) => { const rows = await load(c); if (rows.filter((a) => a.d >= "2026-01-01").length >= 1000) data.set(c, rows); }));
const CH = [OWN, ...[...data.keys()].filter((c) => c !== OWN)];
console.log(`${OWN}(${TK}) 비교군:`, CH.map((c) => `${c} ${data.get(c)!.length}`).join(" · "));

// 자사 닐슨(같은 방영 건)
{
  const m = new Map<string, number>(), ms = new Map<string, number>();
  for (let f = 0; ; f += 1000) {
    const { data: rows, error } = await sb.from("iptv_nielsen_match").select("broadcast_date,start_minute,program_key,nielsen_rating,nielsen_share")
      .eq("channel_name", OWN).eq("target_kind", TK).gte("broadcast_date", FROM).not("nielsen_rating", "is", null)
      .order("broadcast_date").order("start_minute").order("program_key").range(f, f + 999);
    if (error) throw error;
    for (const x of rows ?? []) { m.set(`${x.broadcast_date}|${x.start_minute}|${x.program_key}`, Number(x.nielsen_rating)); if (x.nielsen_share != null) ms.set(`${x.broadcast_date}|${x.start_minute}|${x.program_key}`, Number(x.nielsen_share)); }
    if (!rows || rows.length < 1000) break;
  }
  for (const a of data.get(OWN)!) { const k = `${a.d}|${a.s}|${a.pk}`; const v = m.get(k); if (v != null) a.n = v; const sh = ms.get(k); if (sh != null) a.ns = sh; }
  console.log("닐슨 짝", data.get(OWN)!.filter((a) => a.n != null).length);
}
const genre = new Map<string, string>();
{
  const keys = [...new Set(CH.flatMap((c) => data.get(c)!.map((a) => a.pk)))];
  for (let i = 0; i < keys.length; i += 80) { const { data: g } = await sb.from("iptv_program_genre").select("program_key,genre").in("program_key", keys.slice(i, i + 80)); for (const x of g ?? []) genre.set(x.program_key, x.genre); }
}
const gOf = (a: A) => genre.get(a.pk) ?? "미분류";
function cellMeans(rows: A[], v: (a: A) => number | undefined = (a) => a.r) {
  const m = new Map<string, A[]>();
  for (const a of rows) if (v(a) != null) (m.get(`${a.dow}|${a.band}`) ?? m.set(`${a.dow}|${a.band}`, []).get(`${a.dow}|${a.band}`)!).push(a);
  return new Map([...m].map(([k, xs]) => [k, wmean(xs, (a) => v(a)!)!]));
}
const recent = (c: string) => data.get(c)!.filter((a) => a.d >= RECENT);
const cmI = new Map(CH.map((c) => [c, cellMeans(recent(c))]));
const idxI = (a: A) => { const c = cmI.get(a.ch)!.get(`${a.dow}|${a.band}`); return c && c > 0 ? a.r / c : null; };
const ownN = recent(OWN).filter((a) => a.n != null);
const cmN = cellMeans(ownN, (a) => a.n);
const idxN = (a: A) => { const c = cmN.get(`${a.dow}|${a.band}`); return a.n != null && c && c > 0 ? a.n / c : null; };
const isoWeek = (d: string) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const slots = (as: A[], k = 2) => { const m = new Map<string, number>(); as.forEach((x) => m.set(`${DOW[x.dow]} ${x.band}`, (m.get(`${DOW[x.dow]} ${x.band}`) ?? 0) + 1)); return [...m].sort((p, q) => q[1] - p[1]).slice(0, k).map(([s, n]) => `${s}(${n})`).join(", "); };

// ── A. 사실 ─────────────────────────────────────────────
const yearly: Record<string, unknown>[] = [], monthly: Record<string, unknown>[] = [], topYear: Record<string, unknown>[] = [], topMonth: Record<string, unknown>[] = [];
const weeklyTop: Record<string, unknown>[] = [], dailyTop: Record<string, unknown>[] = [], genreMix: Record<string, unknown>[] = [], peerGenre: Record<string, unknown>[] = [];
for (const c of CH) {
  const rows = data.get(c)!;
  for (const [y, a, b] of [["2024(8~12월)", "2024-08-01", "2024-12-31"], ["2025", "2025-01-01", "2025-12-31"], ["2026(~11/10)", "2026-01-01", TO]] as const) {
    const xs = rows.filter((x) => x.d >= a && x.d <= b);
    if (!xs.length) continue;
    yearly.push({ 채널: c, 연도: y, 평균시청률: r4(wmean(xs), 5), 방영수: xs.length, 작품수: new Set(xs.map((x) => x.pk)).size, 재방표기_비중: r4(xs.filter((x) => x.rerun).reduce((s, x) => s + x.dur, 0) / xs.reduce((s, x) => s + x.dur, 0), 2) });
  }
  for (const m of [...new Set(rows.map((x) => x.d.slice(0, 7)))].sort()) monthly.push({ 채널: c, 월: m, 평균시청률: r4(wmean(rows.filter((x) => x.d.startsWith(m))), 5) });
  for (const [y, a, b] of [["2025", "2025-01-01", "2025-12-31"], ["2026", "2026-01-01", TO]] as const) {
    const xs = rows.filter((x) => x.d >= a && x.d <= b);
    const tot = xs.reduce((s, x) => s + x.r * x.dur, 0);
    const by = new Map<string, A[]>(); xs.forEach((x) => (by.get(x.pk) ?? by.set(x.pk, []).get(x.pk)!).push(x));
    [...by.values()].sort((p, q) => q.reduce((s, x) => s + x.r * x.dur, 0) - p.reduce((s, x) => s + x.r * x.dur, 0)).slice(0, c === OWN ? 10 : 5).forEach((as, i) => {
      topYear.push({ 채널: c, 연도: y, 순위: i + 1, 작품: as[0].pn, 장르: gOf(as[0]), 시청몫: r4(as.reduce((s, x) => s + x.r * x.dur, 0) / tot, 3), 방영수: as.length, 평균시청률: r4(wmean(as), 4), 칸대비: r4(mean(nums(as.map(idxI))), 2), 본방비중: r4(as.filter((x) => !x.rerun).length / as.length, 2), 주력칸: slots(as) });
    });
  }
  if (c === OWN) for (const m of [...new Set(rows.map((x) => x.d.slice(0, 7)))].filter((m) => m >= "2025-08").sort()) {
    const by = new Map<string, number>(); rows.filter((x) => x.d.startsWith(m)).forEach((x) => by.set(x.pn, (by.get(x.pn) ?? 0) + x.r * x.dur));
    const tot = [...by.values()].reduce((a, b) => a + b, 0); const top = [...by].sort((p, q) => q[1] - p[1]).slice(0, 3);
    topMonth.push({ 월: m, "1위": top[0]?.[0], "1위몫": r4((top[0]?.[1] ?? 0) / tot, 2), "2위": top[1]?.[0], "3위": top[2]?.[0] });
  }
  const r26 = rows.filter((x) => x.d >= "2026-01-01");
  const wk = new Map<string, A[]>(); r26.forEach((x) => (wk.get(isoWeek(x.d)) ?? wk.set(isoWeek(x.d), []).get(isoWeek(x.d))!).push(x));
  const wC = new Map<string, number>();
  for (const xs of wk.values()) { const by = new Map<string, A[]>(); xs.forEach((x) => (by.get(x.pn) ?? by.set(x.pn, []).get(x.pn)!).push(x)); const best = [...by].filter(([, v]) => v.length >= 3).sort((p, q) => wmean(q[1])! - wmean(p[1])!)[0]; if (best) wC.set(best[0], (wC.get(best[0]) ?? 0) + 1); }
  [...wC].sort((p, q) => q[1] - p[1]).slice(0, c === OWN ? 5 : 2).forEach(([t, n], i) => weeklyTop.push({ 채널: c, 순위: i + 1, 작품: t, 주수: n, 전체주수: wk.size }));
  const dy = new Map<string, A[]>(); r26.filter((x) => x.dur >= 20).forEach((x) => (dy.get(x.d) ?? dy.set(x.d, []).get(x.d)!).push(x));
  const dC = new Map<string, number>(), dS = new Map<string, Map<string, number>>();
  for (const xs of dy.values()) { const b = [...xs].sort((p, q) => q.r - p.r)[0]; dC.set(b.pn, (dC.get(b.pn) ?? 0) + 1); const m = dS.get(b.pn) ?? new Map(); m.set(b.band, (m.get(b.band) ?? 0) + 1); dS.set(b.pn, m); }
  [...dC].sort((p, q) => q[1] - p[1]).slice(0, c === OWN ? 5 : 2).forEach(([t, n], i) => dailyTop.push({ 채널: c, 순위: i + 1, 작품: t, 일수: n, 전체일수: dy.size, 시간대: [...dS.get(t)!].sort((p, q) => q[1] - p[1])[0][0] }));
  // 장르 비중(분기)·칸 대비
  const q = (d: string) => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  const quarters = [...new Set(rows.filter((x) => x.d >= "2025-01-01").map((x) => q(x.d)))].sort();
  for (const gn of [...new Set(rows.map(gOf))]) {
    const gx = rows.filter((x) => x.d >= RECENT && gOf(x) === gn);
    const tot26 = r26.reduce((s, x) => s + x.dur, 0);
    if (c === OWN) {
      const row: Record<string, unknown> = { 장르: gn };
      for (const qq of quarters) { const xs = rows.filter((x) => q(x.d) === qq); row[qq] = r4(xs.filter((x) => gOf(x) === gn).reduce((s, x) => s + x.dur, 0) / xs.reduce((s, x) => s + x.dur, 0), 3); }
      row["칸대비"] = r4(mean(nums(gx.map(idxI))), 2); row["방영수"] = gx.length;
      genreMix.push(row);
    } else {
      const sh = r26.filter((x) => gOf(x) === gn).reduce((s, x) => s + x.dur, 0) / tot26;
      if (sh >= 0.1) peerGenre.push({ 채널: c, 장르: gn, 비중2026: r4(sh, 2), 칸대비: r4(mean(nums(gx.map(idxI))), 2) });
    }
  }
}
const ownCm26 = cellMeans(data.get(OWN)!.filter((x) => x.d >= "2026-01-01"));
const dowBand = BANDS.map((b) => ({ 시간대: b, ...Object.fromEntries(DOW.map((d, i) => [d, r4(ownCm26.get(`${i}|${b}`) ?? null, 4)])) }));
const cellRank: Record<string, unknown>[] = [];
{
  const cms = new Map(CH.map((c) => [c, cellMeans(data.get(c)!.filter((x) => x.d >= "2026-01-01"))]));
  for (const b of BANDS) for (let d = 0; d < 7; d++) {
    const vals = CH.map((c) => [c, cms.get(c)!.get(`${d}|${b}`) ?? 0] as const).sort((p, q) => q[1] - p[1]);
    const own = cms.get(OWN)!.get(`${d}|${b}`) ?? 0;
    cellRank.push({ 요일: DOW[d], 시간대: b, "1위": vals[0][0], "1위값": r4(vals[0][1], 4), 자사순위: vals.findIndex(([c]) => c === OWN) + 1, 채널수: vals.length, 자사: r4(own, 4), 자사몫: r4(own / vals.reduce((s, [, v]) => s + v, 0), 3), 군합계: r4(vals.reduce((s, [, v]) => s + v, 0), 4) });
  }
}

// ── B. 닐슨 vs IPTV(자사) ─────────────────────────────────
const nvi = [...new Set(data.get(OWN)!.filter((a) => a.d >= "2025-01-01").map((a) => a.d.slice(0, 7)))].sort().map((m) => {
  const xs = data.get(OWN)!.filter((a) => a.d.startsWith(m) && a.n != null);
  return { 월: m, 짝: xs.length, IPTV: r4(wmean(xs), 4), 닐슨: r4(wmean(xs, (a) => a.n!), 4), "닐슨÷IPTV": r4(wmean(xs, (a) => a.n!)! / wmean(xs)!, 2), 닐슨0비율: r4(xs.filter((a) => a.n === 0).length / Math.max(1, xs.length), 2) };
});
const zeroByBand = BANDS.map((b) => { const xs = ownN.filter((a) => a.band === b); return { 시간대: b, 짝: xs.length, 닐슨0비율: r4(xs.filter((a) => a.n === 0).length / Math.max(1, xs.length), 2), IPTV_1분시청: Math.round(mean(nums(xs.map((a) => a.amv))) ?? 0), IPTV_도달: Math.round(mean(nums(xs.map((a) => a.reach))) ?? 0) }; });
const titleRows: Record<string, unknown>[] = [];
{
  const by = new Map<string, A[]>(); recent(OWN).forEach((a) => (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a));
  for (const as of by.values()) {
    if (as.length < 8) continue;
    const wn = as.filter((a) => a.n != null);
    const bands = new Map<string, number>(); as.forEach((x) => bands.set(x.band, (bands.get(x.band) ?? 0) + 1));
    titleRows.push({ 작품: as[0].pn, 장르: gOf(as[0]), 방영수: as.length, 주력시간대: [...bands].sort((p, q) => q[1] - p[1])[0][0], IPTV칸대비: r4(mean(nums(as.map(idxI))), 2), 닐슨칸대비: r4(mean(nums(as.map(idxN))), 2), 닐슨0비율: wn.length ? r4(wn.filter((a) => a.n === 0).length / wn.length, 2) : null, 평균시청률: r4(wmean(as), 4), 본방비중: r4(as.filter((a) => !a.rerun).length / as.length, 2), 첫방: as[0].d, 끝방: as[as.length - 1].d });
  }
}
const rank = (xs: number[]) => { const s = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length); s.forEach(([, i], k) => (r[i] = k + 1)); return r; };
const both = titleRows.filter((t) => t.IPTV칸대비 != null && t.닐슨칸대비 != null && (t.방영수 as number) >= 20);
const spearman = (() => { const a = rank(both.map((t) => t.IPTV칸대비 as number)), b = rank(both.map((t) => t.닐슨칸대비 as number)); const n = a.length, m = (n + 1) / 2; return r4(a.reduce((s, x, i) => s + (x - m) * (b[i] - m), 0) / Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) * b.reduce((s, x) => s + (x - m) ** 2, 0)), 2); })();

// 재방 시점·연속 블록(두 자료)
function dyn(val: (a: A) => number | null, idx: (a: A) => number | null) {
  const rows = data.get(OWN)!;
  const B = ["1일 이내", "2~7일", "8~30일", "31~90일", "91일 이상"];
  const last = new Map<string, string>(); const rb: Record<string, number[]> = Object.fromEntries(B.map((b) => [b, []]));
  for (const a of rows) { if (!a.rerun) { last.set(a.pk, a.d); continue; } if (a.d < RECENT) continue; const lf = last.get(a.pk); if (!lf) continue; const d = Math.round((Date.parse(a.d) - Date.parse(lf)) / 864e5); const v = idx(a); if (v == null) continue; rb[d <= 1 ? B[0] : d <= 7 ? B[1] : d <= 30 ? B[2] : d <= 90 ? B[3] : B[4]].push(v); }
  const pos: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  const byDay = new Map<string, A[]>(); recent(OWN).filter((a) => val(a) != null).forEach((a) => (byDay.get(a.d) ?? byDay.set(a.d, []).get(a.d)!).push(a));
  for (const day of byDay.values()) { day.sort((p, q) => p.s - q.s); let cur: A[] = []; const flush = () => { if (cur.length >= 2) cur.slice(0, 4).forEach((a, k) => { const v = idx(a); if (v != null) pos[k + 1].push(v); }); cur = []; }; for (const a of day) { const p = cur[cur.length - 1]; if (p && p.pk === a.pk && a.s - p.e <= 10) cur.push(a); else { flush(); cur = [a]; } } flush(); }
  return { 재방: B.map((b) => ({ 경과일: b, 표본: rb[b].length, 값: r4(mean(rb[b]), 2) })), 블록: [2, 3, 4].map((k) => ({ 위치: k, 표본: pos[k].length, 값: r4(mean(pos[k])! / mean(pos[1])!, 2) })) };
}
const dynI = dyn((a) => a.r, idxI), dynN = dyn((a) => a.n ?? null, idxN);

// ── C. 편성 지도(최근 15개월) ─────────────────────────────
const mapRows: Record<string, unknown>[] = [];
{
  const own = recent(OWN);
  const comp = CH.filter((c) => c !== OWN).flatMap((c) => recent(c));
  for (const b of BANDS) for (let d = 0; d < 7; d++) {
    const cell = own.filter((a) => a.dow === d && a.band === b);
    const byT = new Map<string, A[]>(); cell.forEach((a) => (byT.get(a.pn) ?? byT.set(a.pn, []).get(a.pn)!).push(a));
    const bestT = [...byT].filter(([, v]) => v.length >= 4).map(([t, v]) => [t, mean(nums(v.map(idxI)))!, v.length, mean(nums(v.map(idxN)))] as const).sort((p, q) => q[1] - p[1])[0];
    const bandRows = own.filter((a) => a.band === b && (d < 5 ? a.dow < 5 : a.dow >= 5));
    const byG = new Map<string, number[]>(); bandRows.forEach((a) => { const v = idxI(a); if (v != null) (byG.get(gOf(a)) ?? byG.set(gOf(a), []).get(gOf(a))!).push(v); });
    const bestG = [...byG].filter(([g, v]) => v.length >= 15 && g !== "미분류").map(([g, v]) => [g, mean(v)!] as const).sort((p, q) => q[1] - p[1])[0];
    const cc = comp.filter((a) => a.dow === d && a.band === b);
    const byC = new Map<string, A[]>(); cc.forEach((a) => (byC.get(`${a.ch}|${a.pn}`) ?? byC.set(`${a.ch}|${a.pn}`, []).get(`${a.ch}|${a.pn}`)!).push(a));
    const bestC = [...byC].filter(([, v]) => v.length >= 4).map(([k, v]) => [k, wmean(v)!] as const).sort((p, q) => q[1] - p[1])[0];
    mapRows.push({ 요일: DOW[d], 시간대: b, 자사칸: r4(cmI.get(OWN)!.get(`${d}|${b}`) ?? null, 4), 잘된작품: bestT ? `${bestT[0]} ${bestT[1].toFixed(2)}${bestT[3] != null ? "/N" + bestT[3].toFixed(2) : ""}(${bestT[2]})` : "", 잘된장르: bestG ? `${bestG[0]} ${bestG[1].toFixed(2)}` : "", 경쟁1위: bestC ? `${bestC[0].replace("|", " ")} ${bestC[1].toFixed(3)}` : "" });
  }
}
// 장르×시간대(자사)
const genreBand: Record<string, unknown>[] = [];
{ const xs = recent(OWN); for (const g of [...new Set(xs.map(gOf))]) for (const b of BANDS) { const v = xs.filter((a) => gOf(a) === g && a.band === b); if (v.length < 15) continue; genreBand.push({ 장르: g, 시간대: b, 방영수: v.length, IPTV칸대비: r4(mean(nums(v.map(idxI))), 2), 닐슨칸대비: r4(mean(nums(v.map(idxN))), 2) }); } }

// ── D. 경쟁사 노하우·같은 작품 비교 ────────────────────────
const peerHits: Record<string, unknown>[] = [];
for (const c of CH.filter((c) => c !== OWN)) {
  const xs = recent(c); const tot = xs.reduce((s, x) => s + x.r * x.dur, 0);
  const by = new Map<string, A[]>(); xs.forEach((x) => (by.get(x.pk) ?? by.set(x.pk, []).get(x.pk)!).push(x));
  // 블록 길이
  const blk = new Map<A, number>(); const byDay = new Map<string, A[]>(); xs.forEach((a) => (byDay.get(a.d) ?? byDay.set(a.d, []).get(a.d)!).push(a));
  for (const day of byDay.values()) { day.sort((p, q) => p.s - q.s); let cur: A[] = []; const flush = () => { cur.forEach((a) => blk.set(a, cur.length)); cur = []; }; for (const a of day) { const p = cur[cur.length - 1]; if (p && p.pk === a.pk && a.s - p.e <= 10) cur.push(a); else { flush(); cur = [a]; } } flush(); }
  [...by.values()].sort((p, q) => q.reduce((s, x) => s + x.r * x.dur, 0) - p.reduce((s, x) => s + x.r * x.dur, 0)).slice(0, 3).forEach((as, i) => peerHits.push({ 채널: c, 순위: i + 1, 작품: as[0].pn, 장르: gOf(as[0]), 시청몫: r4(as.reduce((s, x) => s + x.r * x.dur, 0) / tot, 3), 방영수: as.length, 칸대비: r4(mean(nums(as.map(idxI))), 2), 평균블록: r4(mean(as.map((a) => blk.get(a) ?? 1)), 1), 사용칸수: new Set(as.map((a) => `${a.dow}|${a.band}`)).size, 주력칸: slots(as, 3) }));
}
// 같은 작품을 자사·경쟁이 함께 튼 경우(최근 15개월, 양쪽 각 10회 이상)
const shared: Record<string, unknown>[] = [];
{
  const ownBy = new Map<string, A[]>(); recent(OWN).forEach((a) => (ownBy.get(a.pk) ?? ownBy.set(a.pk, []).get(a.pk)!).push(a));
  for (const c of CH.filter((c) => c !== OWN)) {
    const by = new Map<string, A[]>(); recent(c).forEach((a) => (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a));
    for (const [pk, as] of by) { const os = ownBy.get(pk); if (!os || os.length < 10 || as.length < 10) continue; shared.push({ 작품: os[0].pn, 자사방영: os.length, 자사칸대비: r4(mean(nums(os.map(idxI))), 2), 자사주력: slots(os, 1), 경쟁채널: c, 경쟁방영: as.length, 경쟁칸대비: r4(mean(nums(as.map(idxI))), 2), 경쟁주력: slots(as, 1) }); }
  }
  shared.sort((p, q) => (q.경쟁방영 as number) - (p.경쟁방영 as number));
}
// 숨은 후보: 경쟁 채널에서 칸 대비 높고 시청 규모도 큰데 자사가 안 튼 작품(최근 15개월, 20회 이상)
const buyCands: Record<string, unknown>[] = [];
{
  const ownKeys = new Set(data.get(OWN)!.map((a) => a.pk));
  for (const c of CH.filter((c) => c !== OWN)) {
    const by = new Map<string, A[]>(); recent(c).forEach((a) => (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a));
    for (const [pk, as] of by) { if (as.length < 20 || ownKeys.has(pk)) continue; const ix = mean(nums(as.map(idxI))); if (ix == null || ix < 1.3) continue; buyCands.push({ 채널: c, 작품: as[0].pn, 장르: gOf(as[0]), 방영수: as.length, 칸대비: r4(ix, 2), 평균시청률: r4(wmean(as), 4), 주력칸: slots(as, 2) }); }
  }
  buyCands.sort((p, q) => (q.칸대비 as number) - (p.칸대비 as number));
}

// ── F. 작품별 강한 시간대·확대 후보·오리지널 활용(2026-11-11 사용자 지시 "어떤 프로그램이 언제 강한지") ──
const BAND_LABEL = (b: string) => b;
const progWhen: Record<string, unknown>[] = [];
{
  const by = new Map<string, A[]>(); recent(OWN).forEach((a) => (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a));
  const totMin = recent(OWN).reduce((s, a) => s + a.dur, 0);
  for (const as of by.values()) {
    if (as.length < 30) continue;
    const bands = BANDS.map((b) => { const v = as.filter((a) => a.band === b); return { b, n: v.length, i: mean(nums(v.map(idxI))), nn: mean(nums(v.map(idxN))) }; }).filter((x) => x.n >= 5 && x.i != null);
    if (!bands.length) continue;
    const best = [...bands].sort((p, q) => q.i! - p.i!)[0], worst = [...bands].sort((p, q) => p.i! - q.i!)[0];
    const wd = mean(nums(as.filter((a) => a.dow < 5).map(idxI))), we = mean(nums(as.filter((a) => a.dow >= 5).map(idxI)));
    const ws = as.filter((a) => !a.rerun), rs = as.filter((a) => a.rerun);
    progWhen.push({ 작품: as[0].pn, 장르: gOf(as[0]), 방영횟수: as.length, 편성비중: r4(as.reduce((s, a) => s + a.dur, 0) / totMin, 3), IPTV: r4(mean(nums(as.map(idxI))), 2), 닐슨: r4(mean(nums(as.map(idxN))), 2),
      최고시간대: `${BAND_LABEL(best.b)} ${best.i!.toFixed(2)}${best.nn != null ? "/" + best.nn.toFixed(2) : ""}(${best.n})`, 최저시간대: `${worst.b} ${worst.i!.toFixed(2)}(${worst.n})`,
      평일: r4(wd, 2), 주말: r4(we, 2), 본방송: ws.length ? r4(mean(nums(ws.map(idxI))), 2) : null, 재방송: rs.length ? r4(mean(nums(rs.map(idxI))), 2) : null, 마지막방영: as[as.length - 1].d });
  }
  progWhen.sort((p, q) => (q.IPTV as number) - (p.IPTV as number));
}
// 다른 자사 채널에서 강한 오리지널(같은 타깃): 이 채널에서 덜 나간 작품
const OWN_FAMILY = ["ENA", "ENA Drama", "ENA Play", "ENA Story", "ONCE", "OLIFE", "skyUHD"].filter((c) => c !== OWN);
const origAcross: Record<string, unknown>[] = [];
{
  const ownBy = new Map<string, A[]>(); data.get(OWN)!.forEach((a) => (ownBy.get(a.pk) ?? ownBy.set(a.pk, []).get(a.pk)!).push(a));
  for (const c of OWN_FAMILY) {
    const rows = data.get(c) ?? (await load(c));
    if (!rows.length) continue;
    const cm = cellMeans(rows.filter((a) => a.d >= RECENT));
    const missing = [...new Set(rows.map((a) => a.pk))].filter((k) => !genre.has(k));
    for (let i = 0; i < missing.length; i += 80) { const { data: g } = await sb.from("iptv_program_genre").select("program_key,genre").in("program_key", missing.slice(i, i + 80)); for (const x of g ?? []) genre.set(x.program_key, x.genre); }
    const by = new Map<string, A[]>(); rows.filter((a) => a.d >= RECENT && /오리지널/.test(gOf(a))).forEach((a) => (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a));
    for (const [pk, as] of by) {
      if (as.length < 20) continue;
      const ix = mean(nums(as.map((a) => { const m = cm.get(`${a.dow}|${a.band}`); return m && m > 0 ? a.r / m : null; })));
      if (ix == null || ix < 1.15) continue;
      const mine = (ownBy.get(pk) ?? []).filter((a) => a.d >= RECENT);
      origAcross.push({ 채널: c, 작품: as[0].pn, 장르: genre.get(pk) ?? "미분류", 방영횟수: as.length, 시간대평균대비: r4(ix, 2), 주력: slots(as, 2), 자사채널방영: mine.length, 자사채널지수: mine.length ? r4(mean(nums(mine.map(idxI))), 2) : null });
    }
  }
  origAcross.sort((p, q) => (q.시간대평균대비 as number) - (p.시간대평균대비 as number));
}

// ── E. 드라마군 전체 위치(닐슨 누적 순위 파일, 시장 전체 216개 채널 기준) ─────────
// 드라마군 전체 = 우리 IPTV 자료가 있는 드라마군 15개 + 자료가 없는 드라마 채널(Channel J·채널차이나). IPTV 이름 ↔ 닐슨 파일 이름 대응.
// ENA는 지상파·종편·tvN 동시간대 경쟁군으로 위치를 본다(2026-11-11 사용자 지시 "tvN 및 지상파 포함")
const SLOT_FULL: [string, string | null][] = [["MBC", "MBC"], ["SBS", "SBS"], ["tvN", "tvN"], ["KBS2", "KBS2"], ["JTBC", "JTBC"], ["KBS1", "KBS1"], ["ENA", "ENA"], ["채널A", "채널A"], ["TV CHOSUN", "TV CHOSUN"], ["MBN", "MBN"]];
// ENA Play·ENA Story는 예능·오락군(닐슨 비교군 정의, 종합 채널 tvN 제외)으로 위치를 본다
const VARIETY_FULL: [string, string | null][] = [["MBC every1", "MBC every1"], ["tvN STORY", "tvN Story"], ["KBS JOY", "KBS Joy"], ["채널S", "채널S"], ["SBS funE", "SBS FunE"], ["JTBC2", "JTBC2"], ["tvN SHOW", "tvN SHOW"], ["E채널", "E채널"], ["K STAR", "K star"], ["CMCTV", "CMC TV"], ["ENA PLAY", "ENA Play"], ["ENA STORY", "ENA Story"], ["theLIFE", null], ["CH view", null], ["코미디TV", null], ["Mnet", null], ["GTV", null], ["FUN TV", null]];
const DRAMA_FULL: [string, string | null][] = OWN === "ENA" ? SLOT_FULL : OWN === "ENA Play" || OWN === "ENA Story" ? VARIETY_FULL : [["ENA", "ENA"], ["SBS Plus", "SBS Plus"], ["KBS드라마", "KBS drama"], ["MBC드라마넷", "MBC 드라마넷"], ["D-ONE", "D-ONE"], ["하이라이트TV", "하이라이트 TV"], ["EDGETV", "EDGE TV"], ["DRAMAcube", "Dramacube"], ["CNTV", "CNTV"], ["MBC ON", "MBC ON"], ["tvN DRAMA", "tvN DRAMA"], ["Dramax", "Dramax"], ["ENA DRAMA", "ENA Drama"], ["ONCE", "ONCE"], ["KBS Story", "KBS Story"], ["Channel J", null], ["채널차이나", null]];
const dramaPosition: Record<string, unknown>[] = [];
for (const label of ["유료방송가구", "수도권2049"]) {
  const { data: snap } = await sb.from("market_ytd_rank_snapshot").select("channel_name,rank,rating,date_to").eq("target_label", label).in("channel_name", DRAMA_FULL.map(([n]) => n)).order("date_to", { ascending: false });
  const latest = snap?.[0]?.date_to;
  const rows = (snap ?? []).filter((r) => r.date_to === latest).sort((p, q) => Number(q.rating) - Number(p.rating));
  const iptvSet = rows.filter((r) => DRAMA_FULL.find(([n]) => n === r.channel_name)?.[1]);
  rows.forEach((r, i) => {
    const iptvName = DRAMA_FULL.find(([n]) => n === r.channel_name)?.[1] ?? null;
    dramaPosition.push({ 타깃: label, 기준일: latest, 채널: r.channel_name, 시장순위: r.rank, 누적시청률: Number(r.rating), 드라마군순위: `${i + 1}/${rows.length}`, 자료군순위: iptvName ? `${iptvSet.findIndex((x) => x.channel_name === r.channel_name) + 1}/${iptvSet.length}` : "자료 없음" });
  });
}

// ── G. 절대 수치(2026-11-11 사용자 지시 "시청률·점유율 절대 수치가 기본, 평균=1 지수는 괄호 참고") ──
// i = IPTV 평균 시청률, n = 같은 방영 건 닐슨 평균 시청률, s = 닐슨 평균 점유율(%). 모두 방영 분 가중 평균.
const W = (xs: A[]) => { const wn = xs.filter((a) => a.n != null), ws = xs.filter((a) => a.ns != null); return { i: r4(wmean(xs), 4), n: wn.length ? r4(wmean(wn, (a) => a.n!), 4) : null, s: ws.length ? r4(wmean(ws, (a) => a.ns!), 2) : null, 방영: xs.length }; };
const absolute: Record<string, unknown> = {};
{
  const own = recent(OWN);
  const by = new Map<string, A[]>(); own.forEach((a) => (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a));
  const prog: Record<string, unknown>[] = [];
  for (const as of by.values()) {
    if (as.length < 30) continue;
    const bands = BANDS.map((b) => { const v = as.filter((a) => a.band === b); return { b, v, i: mean(nums(v.map(idxI))) }; }).filter((x) => x.v.length >= 5 && x.i != null);
    if (!bands.length) continue;
    const best = [...bands].sort((p, q) => q.i! - p.i!)[0], worst = [...bands].sort((p, q) => p.i! - q.i!)[0];
    prog.push({ 작품: as[0].pn, 전체: W(as), 지수: r4(mean(nums(as.map(idxI))), 2), 닐슨지수: r4(mean(nums(as.map(idxN))), 2), 최고: { 시간대: best.b, ...W(best.v), 지수: r4(best.i, 2) }, 최저: { 시간대: worst.b, ...W(worst.v), 지수: r4(worst.i, 2) }, 평일: W(as.filter((a) => a.dow < 5)), 주말: W(as.filter((a) => a.dow >= 5)),
      시간대별: Object.fromEntries(BANDS.map((b) => { const v = as.filter((a) => a.band === b); return [b, v.length >= 4 ? { ...W(v), 지수: r4(mean(nums(v.map(idxI))), 2) } : null]; })) });
  }
  absolute.prog = prog;
  absolute.genre = [...new Set(own.map(gOf))].map((g) => ({ 장르: g, ...W(own.filter((a) => gOf(a) === g)) }));
  absolute.genreBand = [...new Set(own.map(gOf))].flatMap((g) => BANDS.map((b) => { const v = own.filter((a) => gOf(a) === g && a.band === b); return v.length >= 15 ? { 장르: g, 시간대: b, ...W(v) } : null; }).filter(Boolean));
  // 재방송 경과일·블록 위치별 평균 시청률
  const rows = data.get(OWN)!; const B = ["1일 이내", "2~7일", "8~30일", "31~90일", "91일 이상"];
  const last = new Map<string, string>(); const rb: Record<string, A[]> = Object.fromEntries(B.map((b) => [b, []]));
  for (const a of rows) { if (!a.rerun) { last.set(a.pk, a.d); continue; } if (a.d < RECENT) continue; const lf = last.get(a.pk); if (!lf) continue; const d = Math.round((Date.parse(a.d) - Date.parse(lf)) / 864e5); rb[d <= 1 ? B[0] : d <= 7 ? B[1] : d <= 30 ? B[2] : d <= 90 ? B[3] : B[4]].push(a); }
  const pos: Record<number, A[]> = { 1: [], 2: [], 3: [], 4: [] };
  const byDay = new Map<string, A[]>(); own.forEach((a) => (byDay.get(a.d) ?? byDay.set(a.d, []).get(a.d)!).push(a));
  for (const day of byDay.values()) { day.sort((p, q) => p.s - q.s); let cur: A[] = []; const flush = () => { if (cur.length >= 2) cur.slice(0, 4).forEach((a, k) => pos[k + 1].push(a)); cur = []; }; for (const a of day) { const p = cur[cur.length - 1]; if (p && p.pk === a.pk && a.s - p.e <= 10) cur.push(a); else { flush(); cur = [a]; } } flush(); }
  absolute.dyn = { 본방송: W(own.filter((a) => !a.rerun)), 재방: B.map((b) => ({ 경과일: b, ...W(rb[b]) })), 블록: [1, 2, 3, 4].map((k) => ({ 위치: k, ...W(pos[k]) })) };
  // 편성 지도: 칸별 잘된 작품(지수 기준 선택)의 절대 수치
  absolute.map = BANDS.flatMap((b) => DOW.map((dn, d) => {
    const cell = own.filter((a) => a.dow === d && a.band === b);
    const byT = new Map<string, A[]>(); cell.forEach((a) => (byT.get(a.pn) ?? byT.set(a.pn, []).get(a.pn)!).push(a));
    const best = [...byT].filter(([, v]) => v.length >= 4).map(([t, v]) => [t, v, mean(nums(v.map(idxI)))!] as const).sort((p, q) => q[2] - p[2])[0];
    return { 요일: dn, 시간대: b, 칸: W(cell), 작품: best ? { 이름: best[0], ...W(best[1] as A[]), 지수: r4(best[2], 2) } : null };
  }));
  // 연도별 자사 닐슨 평균 시청률·점유율
  absolute.yearN = [["2025", "2025-01-01", "2025-12-31"], ["2026(~11/10)", "2026-01-01", TO]].map(([y, a, b]) => ({ 연도: y, ...W(rows.filter((x) => x.d >= a && x.d <= b)) }));
  // 경쟁 간판·같은 작품의 평균 시청률
  absolute.peerHits = peerHits.map((p) => { const as = recent(p.채널 as string).filter((a) => a.pn === p.작품); return { 채널: p.채널, 작품: p.작품, 평균시청률: r4(wmean(as), 4), 지수: p.칸대비 }; });
  absolute.shared = shared.map((x) => { const os = own.filter((a) => a.pn === x.작품), cs = recent(x.경쟁채널 as string).filter((a) => a.pn === x.작품); return { 작품: x.작품, 자사: r4(wmean(os), 4), 자사지수: x.자사칸대비, 경쟁채널: x.경쟁채널, 경쟁: r4(wmean(cs), 4), 경쟁지수: x.경쟁칸대비 }; });
  absolute.buy = buyCands.slice(0, 40);
}

const out = { absolute, own: OWN, target: TK, channels: CH, dramaPosition, progWhen, origAcross: origAcross.slice(0, 40), yearly, monthly, topYear, topMonth, weeklyTop, dailyTop, genreMix, peerGenre, dowBand, cellRank, nvi, zeroByBand, titleRows, spearman, spearmanN: both.length, dynI, dynN, mapRows, genreBand, peerHits, shared, buyCands: buyCands.slice(0, 40) };
const slug = OWN.replace(/\s+/g, "_");
fs.writeFileSync(`docs/iptv/programming_report_${slug}.json`, JSON.stringify(out, null, 1));
const wb = new ExcelJS.Workbook();
for (const [k, v] of Object.entries(out)) { if (!Array.isArray(v) || !v.length || typeof v[0] !== "object") continue; const ws = wb.addWorksheet(k.slice(0, 31)); const cols = Object.keys(v[0] as object); ws.addRow(cols).font = { bold: true }; for (const r of v as Record<string, unknown>[]) ws.addRow(cols.map((c) => r[c] as ExcelJS.CellValue)); }
await wb.xlsx.writeFile(`docs/iptv/programming_report_${slug}.xlsx`);
console.log("저장", slug);
