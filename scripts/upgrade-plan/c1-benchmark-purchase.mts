// 고도화 계획 F-2(C1) — 벤치마크 채널 구매 리스트 연구(읽기 전용, DB를 바꾸지 않음).
// 1) 벤치마크 채널 자동 선정: 같은 군 + 닐슨 연간 누적 순위(market_ytd_rank_snapshot 최신) 우리 ±15위 + 같은 KPI 타깃(사용자 결정 2026-11-13).
//    대안 규칙(시청률 0.5~2배, 4곳 될 때까지 넓히기)도 같이 내서 ±15위가 비는 채널을 확인한다. 허브(지상파·종편·tvN)는 구매 비교에서 뺀다(purchaseSim PARAMS.hubChannels).
// 2) 후보 추출: 벤치마크 채널의 최근 52주 닐슨 프로그램 중 자리 평소 대비 1.1배 이상·20회 이상·자사 미방영 작품. "모든 케이블 피어" 방식과 겹침을 비교한다.
// 3) 백테스트: 2026년에 자사가 새로 투입한 작품(직전 14개월 자사 방영 없음)에 대해, 투입 전 12개월 경쟁 채널 배수의 중앙값으로 자사 배수를 예측했을 때의 오차를
//    모든 케이블 피어 vs 벤치마크 피어로 비교한다. 배수 = 방영 시청률 ÷ 그 채널 같은 자리(평일/주말 × 8대 시간대) 다른 프로그램 중앙값.
//
// 실행: node --env-file=.env --import tsx scripts/upgrade-plan/c1-benchmark-purchase.mts → docs/upgrade-plan/c1-benchmark-purchase.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normalizeProgramCanonicalName } from "../../src/lib/programNameMatch";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const OUT = "docs/upgrade-plan/c1-benchmark-purchase.json";
const ASOF = "2026-11-09";
const RANK_BAND = 15;
const HUB = new Set(["KBS1", "KBS2", "MBC", "SBS", "JTBC", "TV CHOSUN", "채널A", "MBN", "tvN"]);

type TK = "p2049" | "household";
const SNAP_LABEL: Record<TK, string> = { p2049: "수도권2049", household: "유료방송가구" };
const COMP_LABEL: Record<TK, string> = { p2049: "개인2049", household: "유료방송가구" };
const OWN_LABEL: Record<TK, string> = { p2049: "수도권 2049", household: "전국 유료가구" };

// 자사: code, 순위 파일 이름, 군(복수 가능 — ENA는 지상파·종편군과 드라마군 양쪽에서 본다), KPI 타깃
const OWN: { code: string; snap: string; groups: string[]; tk: TK }[] = [
  { code: "ENA", snap: "ENA", groups: ["terrestrial", "drama"], tk: "p2049" },
  { code: "ENA_DRAMA", snap: "ENA DRAMA", groups: ["drama"], tk: "p2049" },
  { code: "ENA_PLAY", snap: "ENA PLAY", groups: ["variety"], tk: "p2049" },
  { code: "OLIFE", snap: "OLIFE", groups: ["life"], tk: "household" },
  { code: "ONCE", snap: "ONCE", groups: ["drama"], tk: "household" },
  { code: "ENA_STORY", snap: "ENA STORY", groups: ["variety"], tk: "household" },
];
// 군 소속 채널(순위 파일 이름 → 닐슨 경쟁 프로그램 자료 이름). comp null = 프로그램 자료 없음
const GROUP: Record<string, { snap: string; comp: string | null }[]> = {
  terrestrial: [["KBS1", "KBS1"], ["KBS2", "KBS2"], ["MBC", "MBC"], ["SBS", "SBS"], ["EBS", null], ["JTBC", "JTBC"], ["TV CHOSUN", "TV CHOSUN"], ["tvN", "tvN"], ["MBN", "MBN"], ["채널A", "채널A"]].map(([s, c]) => ({ snap: s!, comp: c })),
  drama: [["SBS Plus", "SBS Plus"], ["KBS드라마", null], ["MBC드라마넷", "MBC드라마넷"], ["D-ONE", "D-ONE"], ["하이라이트TV", null], ["EDGETV", "EDGETV"], ["DRAMAcube", "DRAMAcube"], ["CNTV", "CNTV"], ["MBC ON", "MBC ON"], ["tvN DRAMA", null], ["Dramax", "Dramax"], ["KBS Story", "KBS Story"], ["ENA DRAMA", null], ["ONCE", null], ["ENA", null]].map(([s, c]) => ({ snap: s!, comp: c })),
  variety: [["MBC every1", "MBC every1"], ["tvN STORY", "tvN STORY"], ["KBS JOY", "KBS JOY"], ["채널S", "채널S"], ["SBS funE", "SBS funE"], ["JTBC2", "JTBC2"], ["FUN TV", "FUN TV"], ["tvN SHOW", "tvN SHOW"], ["E채널", "E채널"], ["GTV", "GTV"], ["K STAR", "K STAR"], ["theLIFE", "theLIFE"], ["CH view", "CH view"], ["코미디TV", "코미디TV"], ["Mnet", "Mnet"], ["ENA PLAY", null], ["ENA STORY", null]].map(([s, c]) => ({ snap: s!, comp: c })),
  life: [["CMCTV", "CMCTV"], ["ONT", "ONT"], ["OLIFE", null]].map(([s, c]) => ({ snap: s!, comp: c })),
};
const OWN_SNAPS = new Set(OWN.map((o) => o.snap));

const keyOf = (s: string) => normalizeProgramCanonicalName(s.replace(/<[^>]*>/g, "")).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const isoDow = (d: string) => ((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
const broadcastMin = (t: string) => { const [h, m] = t.split(":").map((v) => parseInt(v, 10)); return (h < 2 ? h + 24 : h) * 60 + (m || 0); };
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const dateOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const DAYPART = (m: number) => { const h = Math.floor(m / 60); return h < 5 ? "02-05" : h < 8 ? "05-08" : h < 11 ? "08-11" : h < 14 ? "11-14" : h < 17 ? "14-17" : h < 20 ? "17-20" : h < 23 ? "20-23" : "23-02"; };
const slotOf = (dow: number, startMin: number) => `${dow >= 6 ? "WE" : "WD"}|${DAYPART(startMin)}`;

async function pages<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) { const { data, error } = await build().range(i, i + 999); if (error) throw new Error(error.message); out.push(...(data as T[])); if (!data || data.length < 1000) break; }
  return out;
}
type Air = { date: string; slot: string; key: string; name: string; rating: number };
async function loadOwn(code: string, tk: TK, from: string, to: string): Promise<Air[]> {
  const { data: ch } = await sb.from("channels").select("id").eq("code", code).maybeSingle();
  const { data: tg } = await sb.from("targets").select("id").eq("label", OWN_LABEL[tk]).maybeSingle();
  const rows = await pages<any>(() => sb.from("ratings").select("broadcast_date,start_time,rating,programs(canonical_name)").eq("channel_id", ch!.id).eq("target_id", tg!.id).eq("source_type", "nielsen_daily")
    .gte("broadcast_date", from).lte("broadcast_date", to).not("program_id", "is", null).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => { const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name; if (!name || !r.start_time || NOT_PROG.test(name)) return []; return [{ date: r.broadcast_date, slot: slotOf(isoDow(r.broadcast_date), broadcastMin(r.start_time)), key: keyOf(name), name, rating: Number(r.rating) }]; });
}
async function loadComp(name: string, tk: TK, from: string, to: string): Promise<Air[]> {
  const rows = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,program_name,rating").eq("competitor_name", name).eq("target_label", COMP_LABEL[tk])
    .gte("broadcast_date", from).lte("broadcast_date", to).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => (NOT_PROG.test(r.program_name) ? [] : [{ date: r.broadcast_date, slot: slotOf(isoDow(r.broadcast_date), broadcastMin(r.start_time)), key: keyOf(r.program_name), name: r.program_name.replace(/<[^>]*>/g, "").trim(), rating: Number(r.rating) }]));
}

// 자리 평소(같은 자리 다른 프로그램 중앙값) 대비 배수 — 프로그램별 중앙값·방영 수
// 평소 값 하한(BASE_FLOOR): 2049 자료가 대부분 0인 가구 중심 채널(MBC ON·EDGETV·CNTV 등)은 자리 평소가 0 근처라 배수가 수십 배로 튄다 → 그 자리는 계산에서 뺀다
const BASE_FLOOR: Record<TK, number> = { p2049: 0.005, household: 0.01 };
function multiples(airs: Air[], minN = 1, tk: TK = "household"): Map<string, { mult: number; n: number; name: string }> {
  const bySlot = new Map<string, Air[]>();
  for (const a of airs) bySlot.set(a.slot, [...(bySlot.get(a.slot) ?? []), a]);
  const baseCache = new Map<string, number | null>();
  const byKey = new Map<string, { ratios: number[]; name: string }>();
  for (const a of airs) {
    const bk = `${a.slot}|${a.key}`;
    if (!baseCache.has(bk)) { const others = (bySlot.get(a.slot) ?? []).filter((x) => x.key !== a.key).map((x) => x.rating); const b = median(others); baseCache.set(bk, b != null && others.length >= 20 && b >= BASE_FLOOR[tk] ? b : null); }
    const base = baseCache.get(bk);
    if (base == null) continue;
    const e = byKey.get(a.key) ?? { ratios: [], name: a.name };
    e.ratios.push(a.rating / base);
    byKey.set(a.key, e);
  }
  const out = new Map<string, { mult: number; n: number; name: string }>();
  for (const [k, e] of byKey) if (e.ratios.length >= minN) out.set(k, { mult: median(e.ratios)!, n: e.ratios.length, name: e.name });
  return out;
}

// ---------- 1) 벤치마크 채널 선정 ----------
const latestSnap = (await sb.from("market_ytd_rank_snapshot").select("date_to").order("date_to", { ascending: false }).limit(1)).data![0].date_to as string;
const snapRows = await pages<any>(() => sb.from("market_ytd_rank_snapshot").select("target_label,channel_name,rank,rating,date_to").eq("date_to", latestSnap));
const snapDate = snapRows[0]?.date_to;
const rankOf = (snap: string, tk: TK) => snapRows.find((r) => r.target_label === SNAP_LABEL[tk] && r.channel_name === snap) as { rank: number; rating: number } | undefined;

type Bench = { snap: string; comp: string | null; group: string; rank: number; rating: number; hub: boolean; byRank: boolean; byRatio: boolean };
const benchmark: Record<string, { ownRank: number; ownRating: number; rule_rank15: string[]; rule_ratio: string[]; rule_widen4: string[]; all: Bench[] }> = {};
for (const o of OWN) {
  const me = rankOf(o.snap, o.tk)!;
  const all: Bench[] = [];
  for (const g of o.groups) for (const c of GROUP[g]) {
    if (OWN_SNAPS.has(c.snap)) continue;
    const r = rankOf(c.snap, o.tk); if (!r) continue;
    all.push({ snap: c.snap, comp: c.comp, group: g, rank: r.rank, rating: r.rating, hub: HUB.has(c.snap), byRank: Math.abs(r.rank - me.rank) <= RANK_BAND, byRatio: r.rating >= me.rating * 0.5 && r.rating <= me.rating * 2 });
  }
  all.sort((a, b) => a.rank - b.rank);
  const usable = all.filter((c) => !c.hub && c.comp);
  const widen = (() => { for (let band = RANK_BAND; band <= 120; band += 5) { const s = usable.filter((c) => Math.abs(c.rank - me.rank) <= band); if (s.length >= 4) return { band, list: s.map((c) => c.snap) }; } return { band: null, list: usable.map((c) => c.snap) }; })();
  benchmark[o.code] = { ownRank: me.rank, ownRating: me.rating, rule_rank15: usable.filter((c) => c.byRank).map((c) => c.snap), rule_ratio: usable.filter((c) => c.byRatio).map((c) => c.snap), rule_widen4: widen.list, all };
  console.log(`${o.code.padEnd(10)} ${o.tk.padEnd(9)} 순위 ${me.rank}(${me.rating})  ±15위: [${benchmark[o.code].rule_rank15.join(", ")}]  0.5~2배: [${benchmark[o.code].rule_ratio.join(", ")}]  4곳까지 넓힘(±${widen.band}): [${widen.list.join(", ")}]`);
}

// ---------- 2) 후보 추출 (최근 52주) ----------
const FROM52 = dateOf(dayNum(ASOF) - 364);
const compCache = new Map<string, Air[]>();
const getComp = async (name: string, tk: TK, from: string, to: string) => { const k = `${name}|${tk}|${from}|${to}`; if (!compCache.has(k)) compCache.set(k, await loadComp(name, tk, from, to)); return compCache.get(k)!; };
const ownCache = new Map<string, Air[]>();

type Cand = { key: string; name: string; peers: { ch: string; mult: number; n: number; bench: boolean }[]; multAll: number; multBench: number | null; nAll: number; nBench: number; peersAll: number; peersBench: number; otherOwn: string[] };
const candidates: Record<string, { all: number; benchOnly: number; both: number; otherOwnCount: number; top: Cand[] }> = {};
// 자사 전 채널 방영 키 — 다른 자사 채널이 트는 작품도 이 채널에서 틀려면 대부분 추가 구매가 필요하다(지상파 예능 판권은 채널 단위, 사용자 정정 2026-11-13).
// 그래서 후보에서 빼지 않고 "다른 자사 채널 방영 중(추가 구매 필요, 자사 실적 근거 있음)" 표시만 붙인다.
for (const o of OWN) ownCache.set(o.code, await loadOwn(o.code, o.tk, "2025-01-01", ASOF));
const ownKeyChannels = new Map<string, Set<string>>();
for (const [code, airs] of ownCache) for (const a of airs) ownKeyChannels.set(a.key, (ownKeyChannels.get(a.key) ?? new Set()).add(code));
for (const o of OWN) {
  const own = ownCache.get(o.code)!;
  const ownKeys = new Set(own.map((a) => a.key));
  const b = benchmark[o.code];
  const benchSet = new Set(b.rule_ratio.length >= 2 ? b.rule_ratio : b.rule_widen4); // 후보 추출에는 비율 규칙(2곳 미만이면 넓힘 규칙)
  const peersAll = b.all.filter((c) => !c.hub && c.comp);
  const byKey = new Map<string, Cand>();
  for (const c of peersAll) {
    const m = multiples(await getComp(c.comp!, o.tk, FROM52, ASOF), 20, o.tk); // 피어 한 곳당 20회 이상만 센다(Mnet 12~20회 같은 작은 표본이 중앙값을 끌지 않게)
    for (const [k, v] of m) {
      if (ownKeys.has(k)) continue;
      const e = byKey.get(k) ?? { key: k, name: v.name, peers: [], multAll: 0, multBench: null, nAll: 0, nBench: 0, peersAll: 0, peersBench: 0, otherOwn: [...(ownKeyChannels.get(k) ?? [])] };
      e.peers.push({ ch: c.snap, mult: v.mult, n: v.n, bench: benchSet.has(c.snap) });
      byKey.set(k, e);
    }
  }
  const list: Cand[] = [];
  for (const e of byKey.values()) {
    e.nAll = e.peers.reduce((s, p) => s + p.n, 0); e.peersAll = e.peers.length;
    e.multAll = median(e.peers.map((p) => p.mult))!;
    const bp = e.peers.filter((p) => p.bench);
    e.nBench = bp.reduce((s, p) => s + p.n, 0); e.peersBench = bp.length; e.multBench = bp.length ? median(bp.map((p) => p.mult)) : null;
    list.push(e);
  }
  const qualAll = list.filter((e) => e.multAll >= 1.1 && e.nAll >= 20);
  const qualBench = list.filter((e) => e.multBench != null && e.multBench >= 1.1 && e.nBench >= 20);
  const both = qualAll.filter((e) => qualBench.includes(e));
  candidates[o.code] = { all: qualAll.length, benchOnly: qualBench.length, both: both.length, otherOwnCount: qualBench.filter((e) => e.otherOwn.length).length, top: qualBench.sort((x, y) => (y.multBench! * (y.nBench / (y.nBench + 48))) - (x.multBench! * (x.nBench / (x.nBench + 48)))).slice(0, 15).map((e) => ({ ...e, multAll: r3(e.multAll)!, multBench: r3(e.multBench), peers: e.peers.map((p) => ({ ...p, mult: r3(p.mult)! })) })) };
  console.log(`${o.code.padEnd(10)} 벤치마크 [${[...benchSet].join(", ")}] 후보: 모든 케이블 피어 ${qualAll.length}개, 벤치마크 피어 ${qualBench.length}개, 겹침 ${both.length}개, 그중 다른 자사 채널 방영 중 ${candidates[o.code].otherOwnCount}개`);
  for (const e of candidates[o.code].top.slice(0, 10)) console.log(`   ${e.name.padEnd(24)} 벤치마크 ${e.multBench}배(${e.peersBench}곳 ${e.nBench}회) 전체 ${e.multAll}배(${e.peersAll}곳 ${e.nAll}회)${e.otherOwn.length ? ` [자사 ${e.otherOwn.join("·")} 방영 중·추가 구매 필요]` : ""} ← ${e.peers.filter((p) => p.bench).map((p) => `${p.ch} ${p.mult}×${p.n}`).join(", ")}`);
}

// ---------- 3) 백테스트: 2026년 자사 신규 투입작 ----------
type BT = { channel: string; key: string; name: string; firstOwn: string; ownMult: number; ownN: number; predAll: number | null; predBench: number | null; predBenchWiden: number | null; peersAll: number; peersBench: number };
const bt: BT[] = [];
for (const o of OWN) {
  const own = ownCache.get(o.code)!;
  const first = new Map<string, string>();
  for (const a of own) if (!first.has(a.key) || a.date < first.get(a.key)!) first.set(a.key, a.date);
  // 2025-07 이후 처음 투입된 작품(그 전 6개월 이상 자사 방영 없음)의 자사 배수(투입 후 전체) vs 투입 전 12개월 경쟁 배수
  const ownMult = multiples(own.filter((a) => a.date >= "2025-07-01"), 20, o.tk);
  const b = benchmark[o.code];
  const benchRatio = new Set(b.rule_ratio); const benchWiden = new Set(b.rule_widen4);
  const peersAll = b.all.filter((c) => !c.hub && c.comp);
  const compAll = new Map<string, Air[]>();
  for (const c of peersAll) compAll.set(c.snap, await getComp(c.comp!, o.tk, "2025-01-01", ASOF));
  for (const [k, v] of ownMult) {
    const f = first.get(k)!; if (f < "2025-07-01") continue;
    const lo = dateOf(dayNum(f) - 365), hi = dateOf(dayNum(f) - 1);
    const ps = peersAll.flatMap((c) => { const m = multiples(compAll.get(c.snap)!.filter((a) => a.date >= lo && a.date <= hi && a.key === k || (a.date >= lo && a.date <= hi)), 8, o.tk).get(k); return m ? [{ ch: c.snap, mult: m.mult }] : []; });
    if (!ps.length) continue;
    const pick = (set: Set<string>) => { const s = ps.filter((p) => set.has(p.ch)).map((p) => p.mult); return s.length ? median(s) : null; };
    bt.push({ channel: o.code, key: k, name: v.name, firstOwn: f, ownMult: v.mult, ownN: v.n, predAll: median(ps.map((p) => p.mult)), predBench: pick(benchRatio), predBenchWiden: pick(benchWiden), peersAll: ps.length, peersBench: ps.filter((p) => benchRatio.has(p.ch)).length });
  }
}
const err = (rows: BT[], f: (r: BT) => number | null) => { const xs = rows.flatMap((r) => { const p = f(r); return p == null ? [] : [Math.abs(Math.log(p) - Math.log(r.ownMult))]; }); return { n: xs.length, mae_log: r3(median(xs)), hit11: rows.filter((r) => f(r) != null).length ? r3(rows.filter((r) => f(r) != null && (f(r)! >= 1.1) === (r.ownMult >= 1.1)).length / rows.filter((r) => f(r) != null).length) : null }; };
const btSummary: Record<string, unknown> = {};
for (const o of OWN) {
  const rows = bt.filter((r) => r.channel === o.code);
  const paired = rows.filter((r) => r.predBench != null);
  btSummary[o.code] = { n: rows.length, all: err(rows, (r) => r.predAll), benchRatio: err(rows, (r) => r.predBench), benchWiden: err(rows, (r) => r.predBenchWiden), paired: { n: paired.length, all: err(paired, (r) => r.predAll), bench: err(paired, (r) => r.predBench) }, naive1: err(rows, () => 1) };
  console.log(`백테스트 ${o.code.padEnd(10)} 신규작 ${rows.length}개  전체 피어 ${JSON.stringify(btSummary[o.code] && (btSummary[o.code] as any).all)}  벤치마크(비율) ${JSON.stringify((btSummary[o.code] as any).benchRatio)}  짝 비교 ${JSON.stringify((btSummary[o.code] as any).paired)}  1.0 고정 ${JSON.stringify((btSummary[o.code] as any).naive1)}`);
}
const allRows = bt; const allPaired = bt.filter((r) => r.predBench != null);
btSummary.ALL = { n: allRows.length, all: err(allRows, (r) => r.predAll), benchRatio: err(allRows, (r) => r.predBench), benchWiden: err(allRows, (r) => r.predBenchWiden), paired: { n: allPaired.length, all: err(allPaired, (r) => r.predAll), bench: err(allPaired, (r) => r.predBench) }, naive1: err(allRows, () => 1) };
console.log(`백테스트 전체 ${JSON.stringify(btSummary.ALL)}`);

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), asOf: ASOF, snapDate, rankBand: RANK_BAND, benchmark, candidates, backtest: { summary: btSummary, rows: bt.map((r) => ({ ...r, ownMult: r3(r.ownMult), predAll: r3(r.predAll), predBench: r3(r.predBench), predBenchWiden: r3(r.predBenchWiden) })) } }, null, 1));
console.log(`저장: ${OUT}`);
