// 고도화 계획 F-1(B1) — 편성 변경(이동·교체)의 사후 효과를 자사·경쟁·IPTV 세 출처에서 같은 규칙으로 세는 연구 스크립트(읽기 전용, DB를 바꾸지 않음).
// 목적: 홈 조치의 "기대 효과"를 실측 분포로 바꾸기 위해 (1) 기존 changeHistory.ts의 추출 규칙이 세 출처에 그대로 쓰이는지,
//       (2) 유형(이동·교체) × 채널군 × 시간대별 상승/비슷/하락 비율과 변화율 분포가 사례 하한(30건)을 채우는지 확인한다.
// 추출 규칙은 src/lib/dashboard/changeHistory.ts(detectPastChanges)를 그대로 쓴다(새 규칙을 만들지 않는다).
// 효과는 두 가지로 센다: ① 기존 ±10% 띠, ② 잡음 폭(iptv_noise_by_level, 두 회 평균 구간별 80% 분위)을 비교 방영 수의 제곱근으로 나눈 띠.
// 공휴일(public_holidays ±1일) 방영은 전후 비교에서 뺀다(기존 함수는 안 뺀다 — 차이를 같이 보고한다).
// 회귀 대조: 자사 이동 73건(2026-10-15 기준 400일, 상승 37·비슷 9·하락 27)이 재현되는지 먼저 확인한다.
//
// 실행: node --env-file=.env --import tsx scripts/upgrade-plan/b1-change-effect.mts
//   → docs/upgrade-plan/b1-change-effect.json (집계) + 콘솔 요약
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { CHANGE_BAND, detectPastChanges, type HistAiring, type PastChange } from "../../src/lib/dashboard/changeHistory";
import { normalizeProgramCanonicalName } from "../../src/lib/programNameMatch";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const OUT = "docs/upgrade-plan/b1-change-effect.json";
const ASOF = "2026-11-09";
const OWN_FROM = "2025-01-01";
const COMP_FROM = "2025-01-01";
const IPTV_FROM = "2024-08-01";

type TK = "p2049" | "household";
// 자사 채널 × KPI 타깃(CLAUDE.md 채널 그룹). skyUHD는 target_id가 비어 있고 시청률이 0 근처라 제외.
const OWN: { code: string; iptv: string; tk: TK; group: string }[] = [
  { code: "ENA", iptv: "ENA", tk: "p2049", group: "drama" },
  { code: "ENA_DRAMA", iptv: "ENA Drama", tk: "p2049", group: "drama" },
  { code: "ENA_PLAY", iptv: "ENA Play", tk: "p2049", group: "variety" },
  { code: "OLIFE", iptv: "OLIFE", tk: "household", group: "life" },
  { code: "ONCE", iptv: "ONCE", tk: "household", group: "drama" },
  { code: "ENA_STORY", iptv: "ENA Story", tk: "household", group: "variety" },
];
// 경쟁 채널(닐슨 경쟁 프로그램 자료 이름, IPTV 이름, 군, 타깃) — competitor-channel-profiles.mts의 군 정의를 따른다
const COMP: { comp: string | null; iptv: string | null; tk: TK; group: string }[] = [
  ...["KBS1", "KBS2", "MBC", "SBS", "JTBC", "TV CHOSUN", "tvN", "MBN", "채널A"].map((n) => ({ comp: n, iptv: n, tk: "p2049" as TK, group: "terrestrial" })),
  { comp: "SBS Plus", iptv: "SBS Plus", tk: "p2049", group: "drama" }, { comp: "MBC드라마넷", iptv: "MBC 드라마넷", tk: "p2049", group: "drama" },
  { comp: "DRAMAcube", iptv: "Dramacube", tk: "p2049", group: "drama" }, { comp: "Dramax", iptv: "Dramax", tk: "p2049", group: "drama" },
  { comp: "KBS Story", iptv: "KBS Story", tk: "p2049", group: "drama" }, { comp: null, iptv: "tvN DRAMA", tk: "p2049", group: "drama" }, { comp: null, iptv: "KBS drama", tk: "p2049", group: "drama" },
  { comp: "D-ONE", iptv: "D-ONE", tk: "household", group: "drama" }, { comp: "EDGETV", iptv: "EDGE TV", tk: "household", group: "drama" },
  { comp: "CNTV", iptv: "CNTV", tk: "household", group: "drama" }, { comp: "MBC ON", iptv: "MBC ON", tk: "household", group: "drama" }, { comp: null, iptv: "하이라이트 TV", tk: "household", group: "drama" },
  ...["MBC every1", "KBS JOY", "채널S", "SBS funE", "JTBC2", "FUN TV", "tvN SHOW", "E채널", "GTV", "K STAR", "theLIFE", "CH view", "코미디TV", "Mnet"].map((n) => ({ comp: n, iptv: n === "KBS JOY" ? "KBS Joy" : n === "SBS funE" ? "SBS FunE" : n === "K STAR" ? "K star" : n, tk: "p2049" as TK, group: "variety" })),
  { comp: "tvN STORY", iptv: "tvN Story", tk: "p2049", group: "variety" },
  { comp: "CMCTV", iptv: "CMC TV", tk: "household", group: "life" }, { comp: "ONT", iptv: "ONT", tk: "household", group: "life" },
  ...["UXN", "Asia UHD", "UMAX", "UHD Dream", "SBS NEX"].map((n) => ({ comp: null, iptv: n, tk: "household" as TK, group: "uhd" })),
];
const COMP_LABEL: Record<TK, string> = { p2049: "개인2049", household: "유료방송가구" };
const OWN_LABEL: Record<TK, string> = { p2049: "수도권 2049", household: "전국 유료가구" };

const keyOf = (s: string) => normalizeProgramCanonicalName(s).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const isoDow = (d: string) => ((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7) + 1; // 1=월…7=일
const broadcastMin = (t: string) => { const [h, m] = t.split(":").map((v) => parseInt(v, 10)); return (h < 2 ? h + 24 : h) * 60 + (m || 0); };
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const dateOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const r3 = (v: number | null) => (v == null ? null : Number(v.toFixed(3)));
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const DAYPART = (h: number) => (h < 5 ? "02-05" : h < 8 ? "05-08" : h < 11 ? "08-11" : h < 14 ? "11-14" : h < 17 ? "14-17" : h < 20 ? "17-20" : h < 23 ? "20-23" : "23-02");

async function pages<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await build().range(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---------- 자료 읽기 ----------
async function loadOwn(code: string, tk: TK, from: string, to: string): Promise<HistAiring[]> {
  const { data: ch } = await sb.from("channels").select("id").eq("code", code).maybeSingle();
  const { data: tg } = await sb.from("targets").select("id").eq("label", OWN_LABEL[tk]).maybeSingle();
  if (!ch || !tg) throw new Error(`채널/타깃 없음 ${code} ${tk}`);
  const rows = await pages<any>(() => sb.from("ratings").select("broadcast_date,start_time,rating,programs(canonical_name)")
    .eq("channel_id", ch.id).eq("target_id", tg.id).eq("source_type", "nielsen_daily").gte("broadcast_date", from).lte("broadcast_date", to)
    .not("program_id", "is", null).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => {
    const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name;
    if (!name || !r.start_time || NOT_PROG.test(name)) return [];
    return [{ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: broadcastMin(r.start_time), key: keyOf(name), rating: Number(r.rating) }];
  });
}
async function loadComp(name: string, tk: TK, from: string, to: string): Promise<HistAiring[]> {
  const rows = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,program_name,rating")
    .eq("competitor_name", name).eq("target_label", COMP_LABEL[tk]).gte("broadcast_date", from).lte("broadcast_date", to).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => (NOT_PROG.test(r.program_name) ? [] : [{ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: broadcastMin(r.start_time), key: keyOf(r.program_name.replace(/<[^>]*>/g, "")), rating: Number(r.rating) }]));
}
async function loadIptv(name: string, tk: TK, from: string, to: string): Promise<HistAiring[]> {
  const rows = await pages<any>(() => sb.from("iptv_tvindex_airings").select("broadcast_date,start_minute,program_key,rating")
    .eq("channel_name", name).eq("target_kind", tk).gte("broadcast_date", from).lte("broadcast_date", to).not("rating", "is", null).order("broadcast_date").order("start_minute"));
  return rows.flatMap((r) => (NOT_PROG.test(r.program_key) ? [] : [{ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: Number(r.start_minute), key: r.program_key, rating: Number(r.rating) }]));
}

// ---------- 효과 측정 ----------
type Noise = { tk: TK; lo: number; hi: number | null; step: number }[];
const noiseStep = (noise: Noise, tk: TK, level: number) => noise.find((n) => n.tk === tk && level >= n.lo && (n.hi == null || level < n.hi))?.step ?? null;

interface Measured extends PastChange {
  daypart: string;
  // 공휴일 ±1일 방영을 뺀 전 28일·후 28일 중앙값 비교(기존 detail은 최대 6회·공휴일 포함)
  w4: { before: number; after: number; beforeN: number; afterN: number; change: number } | null;
  band10: "up" | "flat" | "down";
  // 잡음 띠: 두 회 평균 구간의 80% 분위 ÷ sqrt(min(beforeN, afterN))
  noiseBand: "up" | "flat" | "down" | null;
  noiseStep: number | null;
  // 교체: 이전 프로그램이 교체 뒤 28일 안에 이 채널 다른 자리에서 계속 방영됐나(true = 편성상의 교체, false = 작품 종료·소진 뒤 교체)
  prevContinues: boolean | null;
  // 이동(자리 기준): 새 자리가 좋아졌나(새 자리의 직전 28일 중앙값 → 옮겨온 프로그램 28일 중앙값), 비운 자리는 어떻게 됐나(프로그램 28일 → 그 뒤 28일 그 자리 전체)
  toSlotChange: number | null;
  fromSlotChange: number | null;
}
const classify = (change: number, band: number): "up" | "flat" | "down" => (change >= band ? "up" : change <= -band ? "down" : "flat");

function measure(all: HistAiring[], changes: PastChange[], holidays: Set<string>, tk: TK, noise: Noise): Measured[] {
  const bySlot = new Map<string, HistAiring[]>();
  for (const a of all) { const k = `${a.dow}|${Math.floor(a.startMin / 60)}`; bySlot.set(k, [...(bySlot.get(k) ?? []), a]); }
  const nearHoliday = (d: string) => holidays.has(d) || holidays.has(dateOf(dayNum(d) - 1)) || holidays.has(dateOf(dayNum(d) + 1));
  return changes.map((c) => {
    const d = c.detail!;
    const hour = parseInt(d.to.split("|")[1], 10);
    const t = dayNum(c.date);
    const pick = (slot: string, key: string | null, lo: number, hi: number) =>
      (bySlot.get(slot) ?? []).filter((a) => dayNum(a.date) >= lo && dayNum(a.date) < hi && (!key || a.key === key) && !nearHoliday(a.date)).map((a) => a.rating);
    // 이동: 전 = 옛 자리의 그 프로그램, 후 = 새 자리의 그 프로그램. 교체: 전 = 그 자리의 이전 프로그램, 후 = 그 자리의 새 프로그램
    const before = c.kind === "move" ? pick(d.from, d.key, t - 28, t) : pick(d.from, d.prevKey!, t - 28, t);
    const after = pick(d.to, d.key, t, t + 28);
    const bm = median(before); const am = median(after);
    const w4 = bm != null && am != null && bm > 0 && before.length >= 2 && after.length >= 2 ? { before: bm, after: am, beforeN: before.length, afterN: after.length, change: am / bm - 1 } : null;
    const level = (d.before + d.after) / 2;
    const step = noiseStep(noise, tk, level);
    const n = Math.min(d.beforeN, d.afterN);
    const nb = step == null ? null : step / Math.sqrt(n);
    // 잡음 띠는 "대칭 변화 폭"(|a−b|÷평균) 기준이므로 같은 척도로 비교
    const sym = Math.abs(d.after - d.before) / ((d.after + d.before) / 2 || 1);
    let prevContinues: boolean | null = null, toSlotChange: number | null = null, fromSlotChange: number | null = null;
    if (c.kind === "replace") prevContinues = all.some((a) => a.key === d.prevKey && dayNum(a.date) >= t && dayNum(a.date) < t + 28);
    else {
      const ratio = (x: number[], y: number[]) => { const mx = median(x); const my = median(y); return mx != null && my != null && mx > 0 && x.length >= 2 && y.length >= 2 ? my / mx - 1 : null; };
      toSlotChange = ratio(pick(d.to, null, t - 28, t), after);
      fromSlotChange = ratio(before, pick(d.from, null, t, t + 28));
    }
    return { ...c, daypart: DAYPART(hour), w4, band10: classify(c.change, CHANGE_BAND), noiseBand: nb == null ? null : sym <= nb ? "flat" : c.change > 0 ? "up" : "down", noiseStep: nb, prevContinues, toSlotChange, fromSlotChange };
  });
}

// ---------- 집계 ----------
function summarize(list: Measured[]) {
  const ch = list.map((m) => m.change);
  const cnt = (f: (m: Measured) => string | null) => { const o: Record<string, number> = {}; for (const m of list) { const k = f(m); if (k) o[k] = (o[k] ?? 0) + 1; } return o; };
  const w4 = list.filter((m) => m.w4).map((m) => m.w4!.change);
  return {
    n: list.length,
    band10: cnt((m) => m.band10), band10_up_pct: list.length ? r3(list.filter((m) => m.band10 === "up").length / list.length) : null,
    noise: cnt((m) => m.noiseBand), noise_up_pct: list.filter((m) => m.noiseBand).length ? r3(list.filter((m) => m.noiseBand === "up").length / list.filter((m) => m.noiseBand).length) : null,
    change_median: r3(median(ch)), change_p25: r3(q(ch, 0.25)), change_p75: r3(q(ch, 0.75)),
    w4_n: w4.length, w4_band10: cnt((m) => (m.w4 ? classify(m.w4.change, CHANGE_BAND) : null)), w4_change_median: r3(median(w4)),
    // 교체: 앞 프로그램이 계속 방영된(편성상의 교체) 건만
    swap: (() => { const s = list.filter((m) => m.prevContinues === true); return { n: s.length, band10: cnt((m) => (m.prevContinues ? m.band10 : null)), change_median: r3(median(s.map((m) => m.change))) }; })(),
    ended: (() => { const s = list.filter((m) => m.prevContinues === false); return { n: s.length, change_median: r3(median(s.map((m) => m.change))) }; })(),
    // 이동(자리 기준)
    toSlot: (() => { const s = list.filter((m) => m.toSlotChange != null).map((m) => m.toSlotChange!); return { n: s.length, up: s.filter((v) => v >= CHANGE_BAND).length, down: s.filter((v) => v <= -CHANGE_BAND).length, change_median: r3(median(s)) }; })(),
    fromSlot: (() => { const s = list.filter((m) => m.fromSlotChange != null).map((m) => m.fromSlotChange!); return { n: s.length, up: s.filter((v) => v >= CHANGE_BAND).length, down: s.filter((v) => v <= -CHANGE_BAND).length, change_median: r3(median(s)) }; })(),
  };
}
const groupBy = <T,>(xs: T[], f: (x: T) => string) => { const o: Record<string, T[]> = {}; for (const x of xs) (o[f(x)] ??= []).push(x); return o; };
const mapVals = <T, U>(o: Record<string, T>, f: (v: T) => U) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

// ---------- 실행 ----------
const t0 = Date.now();
const holRows = await pages<any>(() => sb.from("public_holidays").select("holiday_date").order("holiday_date"));
const holidays = new Set<string>(holRows.map((r) => r.holiday_date));
const noiseRows = await pages<any>(() => sb.from("iptv_noise_by_level").select("target_kind,level_lo,level_hi,noise_step,version").order("version", { ascending: false }).order("level_lo"));
const latestVer = noiseRows[0]?.version;
const noise: Noise = noiseRows.filter((r) => r.version === latestVer).map((r) => ({ tk: r.target_kind, lo: Number(r.level_lo), hi: r.level_hi == null ? null : Number(r.level_hi), step: Number(r.noise_step) }));
console.log(`공휴일 ${holidays.size}일, 잡음 폭 ${noise.length}구간(${latestVer})`);

type Rec = { source: "own" | "comp" | "iptv"; channel: string; group: string; tk: TK; airings: number; changes: Measured[] };
const recs: Rec[] = [];
async function run(source: Rec["source"], channel: string, group: string, tk: TK, load: () => Promise<HistAiring[]>, asOf = ASOF) {
  try {
    const all = await load();
    const changes = detectPastChanges(all, asOf);
    recs.push({ source, channel, group, tk, airings: all.length, changes: measure(all, changes, holidays, tk, noise) });
    console.log(`${source.padEnd(4)} ${channel.padEnd(14)} ${tk.padEnd(9)} 방영 ${String(all.length).padStart(6)}  이동 ${changes.filter((c) => c.kind === "move").length}  교체 ${changes.filter((c) => c.kind === "replace").length}`);
  } catch (e) { console.log(`${source} ${channel} 실패: ${(e as Error).message}`); }
}

// 0) 회귀 대조 — 자사 이동 73건(2026-10-15 기준 400일) 재현
const regr: Record<string, unknown> = {};
{
  const asOf = "2026-10-15"; const from = dateOf(dayNum(asOf) - 400);
  const all: Measured[] = [];
  for (const o of OWN) {
    const rows = await loadOwn(o.code, o.tk, from, asOf);
    all.push(...measure(rows, detectPastChanges(rows, asOf), holidays, o.tk, noise));
  }
  const moves = all.filter((m) => m.kind === "move");
  regr.asOf = asOf; regr.moves = summarize(moves); regr.replaces = summarize(all.filter((m) => m.kind === "replace"));
  regr.expected = { n: 73, up: 37, flat: 9, down: 27, note: "2026-10-15 docs/편성이동_사후결과_내역.docx — 당시 기준(is_first_run 미구분, 공휴일 포함, ±10% 띠)" };
  console.log(`회귀 대조(자사 이동, ${asOf} 기준 400일): n=${moves.length} ${JSON.stringify((regr.moves as any).band10)} (기대 73: 37/9/27)`);
}

// 1) 전체 기간
for (const o of OWN) await run("own", o.code, o.group, o.tk, () => loadOwn(o.code, o.tk, OWN_FROM, ASOF));
for (const c of COMP) if (c.comp) await run("comp", c.comp, c.group, c.tk, () => loadComp(c.comp!, c.tk, COMP_FROM, ASOF));
for (const o of OWN) await run("iptv", o.iptv, o.group, o.tk, () => loadIptv(o.iptv, o.tk, IPTV_FROM, ASOF));
for (const c of COMP) if (c.iptv) await run("iptv", c.iptv, c.group, c.tk, () => loadIptv(c.iptv!, c.tk, IPTV_FROM, ASOF));

const flat = recs.flatMap((r) => r.changes.map((m) => ({ ...m, source: r.source, channel: r.channel, group: r.group, tk: r.tk })));
const out = {
  generatedAt: new Date().toISOString(), asOf: ASOF, periods: { own: OWN_FROM, comp: COMP_FROM, iptv: IPTV_FROM }, noiseVersion: latestVer,
  regression: regr,
  channels: recs.map((r) => ({ source: r.source, channel: r.channel, group: r.group, tk: r.tk, airings: r.airings, move: summarize(r.changes.filter((m) => m.kind === "move")), replace: summarize(r.changes.filter((m) => m.kind === "replace")) })),
  bySourceKind: mapVals(groupBy(flat, (m) => `${m.source}|${m.kind}`), summarize),
  bySourceGroupKind: mapVals(groupBy(flat, (m) => `${m.source}|${m.group}|${m.kind}`), summarize),
  byGroupKindDaypart_nielsen: mapVals(groupBy(flat.filter((m) => m.source !== "iptv"), (m) => `${m.group}|${m.kind}|${m.daypart}`), summarize),
  byGroupKindDaypart_all: mapVals(groupBy(flat, (m) => `${m.group}|${m.kind}|${m.daypart}`), summarize),
  byTkKindLevel_nielsen: mapVals(groupBy(flat.filter((m) => m.source !== "iptv"), (m) => { const lv = (m.detail!.before + m.detail!.after) / 2; return `${m.tk}|${m.kind}|${lv < 0.05 ? "<0.05" : lv < 0.15 ? "0.05-0.15" : lv < 0.4 ? "0.15-0.4" : lv < 1 ? "0.4-1" : ">=1"}`; }), summarize),
  // 자사 사례 전체(내역 검토용)
  ownEvents: flat.filter((m) => m.source === "own").map((m) => ({ channel: m.channel, kind: m.kind, date: m.date, key: m.detail!.key, prevKey: m.detail!.prevKey, from: m.detail!.from, to: m.detail!.to, before: r3(m.detail!.before), after: r3(m.detail!.after), change: r3(m.change), band10: m.band10, noiseBand: m.noiseBand, w4: m.w4 && { ...m.w4, before: r3(m.w4.before), after: r3(m.w4.after), change: r3(m.w4.change) } })),
};
fs.mkdirSync("docs/upgrade-plan", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\n== 출처×유형 ==`);
for (const [k, v] of Object.entries(out.bySourceKind)) console.log(k.padEnd(14), `n=${v.n}`, "±10%", JSON.stringify(v.band10), "잡음띠", JSON.stringify(v.noise), `중앙값 ${v.change_median} [${v.change_p25}, ${v.change_p75}]`, `4주(공휴일 제외) n=${v.w4_n} ${JSON.stringify(v.w4_band10)} 중앙값 ${v.w4_change_median}`, `| 편성상 교체 ${JSON.stringify(v.swap)} 종료 후 교체 ${JSON.stringify(v.ended)} | 새 자리 ${JSON.stringify(v.toSlot)} 비운 자리 ${JSON.stringify(v.fromSlot)}`);
console.log(`\n== 출처×군×유형(자리 기준·편성상 교체) ==`);
for (const [k, v] of Object.entries(out.bySourceGroupKind)) console.log(k.padEnd(26), k.endsWith("move") ? `새 자리 ${JSON.stringify(v.toSlot)} 비운 자리 ${JSON.stringify(v.fromSlot)}` : `편성상 교체 ${JSON.stringify(v.swap)} 종료 후 ${JSON.stringify(v.ended)}`);
console.log(`\n== 출처×군×유형 ==`);
for (const [k, v] of Object.entries(out.bySourceGroupKind)) console.log(k.padEnd(26), `n=${String(v.n).padStart(4)}`, "±10%", JSON.stringify(v.band10), `상승 ${v.band10_up_pct}`, `중앙값 ${v.change_median}`);
console.log(`\n== 군×유형×시간대(닐슨만) ==`);
for (const [k, v] of Object.entries(out.byGroupKindDaypart_nielsen).sort()) console.log(k.padEnd(26), `n=${String(v.n).padStart(4)}`, "±10%", JSON.stringify(v.band10), `중앙값 ${v.change_median}`);
console.log(`\n== 타깃×유형×시청률 구간(닐슨만) ==`);
for (const [k, v] of Object.entries(out.byTkKindLevel_nielsen).sort()) console.log(k.padEnd(28), `n=${String(v.n).padStart(4)}`, "±10%", JSON.stringify(v.band10), "잡음띠", JSON.stringify(v.noise), `중앙값 ${v.change_median}`);
console.log(`\n저장: ${OUT} (${Math.round((Date.now() - t0) / 1000)}초)`);
