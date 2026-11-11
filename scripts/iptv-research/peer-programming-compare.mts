// 경쟁 채널군 편성 비교(2026-11-11 사용자 지시 "ENA Play는 내가 준 경쟁 채널군 채널들 편성도 비교해서 인사이트 세세하게, 구매 추천도").
// 채널별 편성 구조(장르 비중·재방송 비중·작품 집중도·블록 길이), 최근 13주 요일×시간대 대표 편성, 구매 후보를 계산한다.
// 수치는 모두 여기서 계산한다(원칙 1). 시청률은 IPTV(TV INDEX) 평균 시청률이 기본이고 괄호용 지수는 같은 채널 요일×시간대 평균=1.
// 실행: node --env-file=.env --import tsx scripts/iptv-research/peer-programming-compare.mts "ENA Play" p2049 → docs/iptv/peer_compare_<채널>.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const OWN = process.argv[2] ?? "ENA Play", TK = process.argv[3] ?? "p2049";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FROM = "2025-08-01", TO = "2026-11-10", LINEUP_FROM = "2026-08-12";
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];
const LIVE = /뉴스|생방송|생생정보|라이브|중계|월드컵|올림픽|하이라이트|아시안게임|시사|토론|날씨|특보|아침마당|모닝와이드|가요무대|뮤직뱅크|인기가요|음악중심/;
type A = { ch: string; d: string; s: number; e: number; pn: string; pk: string; rerun: boolean; r: number; dur: number; dow: number; band: string };
const clean = (s: string) => s.replace(/\s*<[^>]+>/g, "").trim();
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const wmean = (xs: A[]) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + a.r * a.dur, 0) / w : null; };
const r = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const group = <T,>(xs: T[], k: (x: T) => string) => { const m = new Map<string, T[]>(); xs.forEach((x) => (m.get(k(x)) ?? m.set(k(x), []).get(k(x))!).push(x)); return m; };

async function load(ch: string): Promise<A[]> {
  const out: A[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,end_minute,program_name,program_key,is_rerun_tag,rating,duration_min,dow,slot_band")
      .eq("channel_name", ch).eq("target_kind", TK).gte("broadcast_date", FROM).lte("broadcast_date", TO)
      .order("broadcast_date").order("start_minute").order("program_key").range(f, f + 999);
    if (error) throw new Error(`${ch}: ${error.message}`);
    for (const x of data ?? []) if (x.rating != null && Number(x.duration_min) > 0)
      out.push({ ch, d: x.broadcast_date, s: x.start_minute, e: x.end_minute, pn: clean(x.program_name), pk: x.program_key, rerun: x.is_rerun_tag, r: Number(x.rating), dur: Number(x.duration_min), dow: x.dow, band: x.slot_band });
    if (!data || data.length < 1000) break;
  }
  return out;
}

const { data: members } = await sb.from("iptv_peer_groups").select("iptv_channel_name").eq("group_key", "variety");
const names = [...new Set([OWN, ...(members ?? []).map((m) => m.iptv_channel_name as string).filter((c) => c !== "ENA Story" || OWN === "ENA Story")])];
const data = new Map<string, A[]>();
await Promise.all(names.map(async (c) => { const rows = await load(c); if (rows.filter((a) => a.d >= "2026-01-01").length >= 1000) data.set(c, rows); else console.log("자료 부족 제외:", c, rows.length); }));
const CH = [OWN, ...[...data.keys()].filter((c) => c !== OWN)];
console.log("채널:", CH.join(", "));
const genre = new Map<string, string>();
{ const keys = [...new Set(CH.flatMap((c) => data.get(c)!.map((a) => a.pk)))]; for (let i = 0; i < keys.length; i += 80) { const { data: g } = await sb.from("iptv_program_genre").select("program_key,genre").in("program_key", keys.slice(i, i + 80)); for (const x of g ?? []) genre.set(x.program_key, x.genre); } }
const gOf = (a: A) => genre.get(a.pk) ?? "미분류";
const cm = new Map(CH.map((c) => [c, new Map([...group(data.get(c)!, (a) => `${a.dow}|${a.band}`)].map(([k, v]) => [k, wmean(v)!]))]));
const idx = (a: A) => { const m = cm.get(a.ch)!.get(`${a.dow}|${a.band}`); return m && m > 0 ? a.r / m : null; };
const ix = (xs: A[]) => r(mean(xs.map(idx).filter((v): v is number => v != null)), 2);

// 1. 채널 편성 구조(2026)
const profile = CH.map((c) => {
  const xs = data.get(c)!.filter((a) => a.d >= "2026-01-01"); const min = xs.reduce((s, a) => s + a.dur, 0); const vol = xs.reduce((s, a) => s + a.r * a.dur, 0);
  const byP = [...group(xs, (a) => a.pk).values()].sort((p, q) => q.reduce((s, a) => s + a.r * a.dur, 0) - p.reduce((s, a) => s + a.r * a.dur, 0));
  const top3 = byP.slice(0, 3).reduce((s, as) => s + as.reduce((t, a) => t + a.r * a.dur, 0), 0) / vol;
  const blocks: number[] = []; for (const day of group(xs, (a) => a.d).values()) { day.sort((p, q) => p.s - q.s); let n = 1; for (let i = 1; i <= day.length; i++) { if (i < day.length && day[i].pk === day[i - 1].pk && day[i].s - day[i - 1].e <= 10) n++; else { blocks.push(n); n = 1; } } }
  const gm = [...group(xs, gOf)].map(([g, v]) => [g, v.reduce((s, a) => s + a.dur, 0) / min] as const).sort((p, q) => q[1] - p[1]).filter(([, v]) => v >= 0.05);
  return { 채널: c, 평균시청률: r(wmean(xs)), 작품수: byP.length, 상위3편_시청비중: r(top3, 2), 재방송비중: r(xs.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / min, 2), 평균블록: r(mean(blocks), 2), 장르: gm.map(([g, v]) => `${g} ${Math.round(v * 100)}%`).join("·"),
    상위작품: byP.slice(0, 5).map((as) => `${as[0].pn} ${r(wmean(as))}(${ix(as)})`).join(" / ") };
});

// 2. 최근 13주 요일×시간대 대표 편성(방영 분 최다 작품)과 시청률
const lineup: Record<string, unknown>[] = [];
for (const c of CH) { const xs = data.get(c)!.filter((a) => a.d >= LINEUP_FROM);
  for (const b of BANDS) for (let d = 0; d < 7; d++) { const cell = xs.filter((a) => a.dow === d && a.band === b); if (!cell.length) continue;
    const top = [...group(cell, (a) => a.pn)].sort((p, q) => q[1].reduce((s, a) => s + a.dur, 0) - p[1].reduce((s, a) => s + a.dur, 0))[0];
    lineup.push({ 채널: c, 요일: DOW[d], 시간대: b, 칸시청률: r(wmean(cell)), 대표작품: top[0], 대표비중: r(top[1].reduce((s, a) => s + a.dur, 0) / cell.reduce((s, a) => s + a.dur, 0), 2), 대표시청률: r(wmean(top[1])), 본방비중: r(top[1].filter((a) => !a.rerun).length / top[1].length, 2) }); } }
// 칸별 순위(최근 13주)
const cellRank: Record<string, unknown>[] = [];
for (const b of BANDS) for (let d = 0; d < 7; d++) { const rows = lineup.filter((l) => l.요일 === DOW[d] && l.시간대 === b).sort((p, q) => (q.칸시청률 as number) - (p.칸시청률 as number));
  const own = rows.findIndex((l) => l.채널 === OWN); cellRank.push({ 요일: DOW[d], 시간대: b, 자사순위: own + 1, 채널수: rows.length, 자사: rows[own]?.칸시청률, 자사작품: rows[own]?.대표작품, "1위": `${rows[0].채널} ${rows[0].대표작품} ${rows[0].칸시청률}`, "2위": rows[1] ? `${rows[1].채널} ${rows[1].대표작품} ${rows[1].칸시청률}` : "" }); }

// 3. 같은 작품 다채널 방영(최근 15개월): 작품별 채널 수·채널별 시청률
const shared: Record<string, unknown>[] = [];
{ const all = CH.flatMap((c) => data.get(c)!.filter((a) => a.d >= "2026-01-01"));
  for (const [pn, xs] of group(all, (a) => a.pn)) { const byC = [...group(xs, (a) => a.ch)].filter(([, v]) => v.length >= 10); if (byC.length < 2) continue;
    shared.push({ 작품: pn, 채널수: byC.length, 합계방영: byC.reduce((s, [, v]) => s + v.length, 0), 채널별: byC.sort((p, q) => wmean(q[1])! - wmean(p[1])!).map(([c, v]) => `${c} ${r(wmean(v))}(${ix(v)},${v.length})`).join(" / "), 자사포함: byC.some(([c]) => c === OWN) }); }
  shared.sort((p, q) => (q.합계방영 as number) - (p.합계방영 as number)); }

// 4. 구매 후보: 경쟁 채널 예능·드라마 중 자사 미방영, 2026년 20회 이상, 생방송·일일드라마 제외(일일드라마는 회차 80회 이상·평일 매일 편성 장르 드라마로 판정)
const ownKeys = new Set(data.get(OWN)!.map((a) => a.pk)); const ownNames = new Set(data.get(OWN)!.map((a) => a.pn));
const buy: Record<string, unknown>[] = [];
{ const all = CH.filter((c) => c !== OWN).flatMap((c) => data.get(c)!.filter((a) => a.d >= "2025-11-01"));
  for (const [pn, xs] of group(all, (a) => a.pn)) { if (ownNames.has(pn) || ownKeys.has(xs[0].pk) || LIVE.test(pn)) continue; const g = gOf(xs[0]); if (!/예능|드라마/.test(g) || /오리지널/.test(g)) continue;
    const byC = [...group(xs, (a) => a.ch)].filter(([, v]) => v.length >= 15); if (!byC.length) continue;
    const best = byC.map(([c, v]) => ({ c, v, rt: wmean(v)!, i: ix(v)! })).sort((p, q) => q.rt * q.i - p.rt * p.i)[0];
    if (best.i < 1.1) continue;
    const peak = [...group(best.v, (a) => `${DOW[a.dow]} ${a.band}`)].sort((p, q) => q[1].length - p[1].length)[0][0];
    buy.push({ 작품: pn, 장르: g, 채널수: byC.length, 최고채널: best.c, 시청률: r(best.rt), 지수: best.i, 방영: best.v.length, 주력: peak, 다른채널: byC.filter(([c]) => c !== best.c).map(([c, v]) => `${c} ${r(wmean(v))}(${ix(v)})`).join(" / "), 마지막: best.v[best.v.length - 1].d }); }
  buy.sort((p, q) => (q.시청률 as number) * (q.지수 as number) - (p.시청률 as number) * (p.지수 as number)); }

const out = { own: OWN, target: TK, channels: CH, profile, cellRank, lineup, shared: shared.slice(0, 40), buy: buy.slice(0, 60) };
fs.writeFileSync(`docs/iptv/peer_compare_${OWN.replace(/\s+/g, "_")}.json`, JSON.stringify(out, null, 1));
console.log("저장");
