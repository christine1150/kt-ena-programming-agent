// 고도화 계획 F-4(A2) — 공휴일·연휴 효과 계수 연구(읽기 전용, DB를 바꾸지 않음).
// (A) 기술 통계: 공휴일 유형 × 채널 × 8대 시간대마다 "그날 시청률 ÷ 같은 요일·시간대 평소(±4주 같은 요일, 공휴일 제외, 중앙값)"의 분포. 보고서 단락용.
//     유형: single(하루짜리 평일 공휴일) / long_first·long_mid·long_last(주말과 이어진 3일 이상 연휴의 평일 공휴일 위치) / seol_chuseok(설·추석 연휴의 평일) /
//           eve(연휴·공휴일 전날, 평일) / after(연휴·공휴일 다음 날, 평일). 주말과 겹친 공휴일은 요일이 이미 주말이라 제외.
// (B) 예측 백테스트: 평일 공휴일의 실제 방영마다 운영 엔진(MetricModel, 마감 7일 전)으로 ① 현행 기대값(그 요일 자리) ② 일요일 자리로 본 기대값 ③ 토요일 자리
//     ④ 현행 × 공휴일 계수(그 날짜 이전 공휴일에서만 추정한 실적÷기대 중앙값, 유형×채널×시간대 → 유형×시간대(채널 합) → 1 순 폴백, 8건 이상, 1쪽 수축)를 비교한다.
//     계수는 2025년 공휴일로만 추정되도록 2026년 공휴일만 평가한다(시간 순 누적 추정).
//
// 실행: node --env-file=.env --import tsx scripts/upgrade-plan/a2-holiday-factor.mts → docs/upgrade-plan/a2-holiday-factor.json (실적 포함 — 커밋하지 않음)
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadChannelRef, fetchOwnAirings } from "../../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../../src/lib/idealSchedule/configStore";
import { loadGenreMap } from "../../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../../src/lib/idealSchedule/genreRules";
import { featureOptionsFor } from "../../src/lib/idealSchedule/engine";
import { MetricModel, eligibleAirings } from "../../src/lib/idealSchedule/features";
import { hourBucket } from "../../src/lib/idealSchedule/time";
import type { OwnAiring } from "../../src/lib/idealSchedule/types";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const OUT = "docs/upgrade-plan/a2-holiday-factor.json";
const ASOF = "2026-11-09";
const FROM = "2025-01-01";
type TK = "p2049" | "household";
const OWN: { code: string; tk: TK }[] = [{ code: "ENA", tk: "p2049" }, { code: "ENA_DRAMA", tk: "p2049" }, { code: "ENA_PLAY", tk: "p2049" }, { code: "OLIFE", tk: "household" }, { code: "ONCE", tk: "household" }, { code: "ENA_STORY", tk: "household" }];
const OWN_LABEL: Record<TK, string> = { p2049: "수도권 2049", household: "전국 유료가구" };
const isoDow = (d: string) => ((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const dateOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const broadcastMin = (t: string) => { const [h, m] = t.split(":").map((v) => parseInt(v, 10)); return (h < 2 ? h + 24 : h) * 60 + (m || 0); };
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));
const DAYPART = (m: number) => { const h = Math.floor(m / 60); return h < 5 ? "02-05" : h < 8 ? "05-08" : h < 11 ? "08-11" : h < 14 ? "11-14" : h < 17 ? "14-17" : h < 20 ? "17-20" : h < 23 ? "20-23" : "23-02"; };
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
async function pages<T>(build: () => any): Promise<T[]> { const out: T[] = []; for (let i = 0; ; i += 1000) { const { data, error } = await build().range(i, i + 999); if (error) throw new Error(error.message); out.push(...(data as T[])); if (!data || data.length < 1000) break; } return out; }

// ---------- 공휴일 유형 ----------
const holRows = await pages<any>(() => sb.from("public_holidays").select("holiday_date,name,kind").order("holiday_date"));
const holidays = new Map<string, { name: string; kind: string }>(holRows.map((r) => [r.holiday_date, { name: r.name, kind: r.kind }]));
const isOff = (d: string) => holidays.has(d) || isoDow(d) >= 6;
type HType = "single" | "long_first" | "long_mid" | "long_last" | "seol_chuseok" | "eve" | "after";
// 날짜 → 유형(평일 공휴일·전날·다음 날만). 주말 공휴일은 null.
function typeOf(d: string): HType | null {
  const dn = dayNum(d);
  if (holidays.has(d) && isoDow(d) <= 5) {
    let s = dn, e = dn;
    while (isOff(dateOf(s - 1))) s--;
    while (isOff(dateOf(e + 1))) e++;
    const block = Array.from({ length: e - s + 1 }, (_, i) => dateOf(s + i));
    if (block.some((x) => /설날|추석/.test(holidays.get(x)?.name ?? ""))) return "seol_chuseok";
    if (e - s + 1 === 1) return "single";
    const weekdayHol = block.filter((x) => holidays.has(x) && isoDow(x) <= 5);
    if (weekdayHol.length === 1) return "single"; // 주말에 붙은 하루짜리(금·월 공휴일)는 single로 둔다 — 3일 연휴
    return d === weekdayHol[0] ? "long_first" : d === weekdayHol[weekdayHol.length - 1] ? "long_last" : "long_mid";
  }
  if (!isOff(d) && isOff(dateOf(dn + 1)) && [1, 2, 3].some((k) => holidays.has(dateOf(dn + k)) && Array.from({ length: k }, (_, i) => dateOf(dn + 1 + i)).every(isOff))) return "eve";
  if (!isOff(d) && isOff(dateOf(dn - 1)) && [1, 2, 3].some((k) => holidays.has(dateOf(dn - k)) && Array.from({ length: k }, (_, i) => dateOf(dn - 1 - i)).every(isOff))) return "after";
  return null;
}
const typed: { date: string; type: HType; name: string }[] = [];
for (let n = dayNum(FROM); n <= dayNum(ASOF); n++) { const d = dateOf(n); const t = typeOf(d); if (t) typed.push({ date: d, type: t, name: holidays.get(d)?.name ?? (t === "eve" ? "전날" : "다음 날") }); }
console.log(`유형 지정된 날짜 ${typed.length}개: ` + (["single", "long_first", "long_mid", "long_last", "seol_chuseok", "eve", "after"] as HType[]).map((t) => `${t} ${typed.filter((x) => x.type === t).length}`).join(", "));
const typeByDate = new Map(typed.map((t) => [t.date, t.type]));

// ---------- (A) 기술 통계 ----------
type Air = { date: string; dow: number; startMin: number; dp: string; rating: number; dur: number };
async function loadOwn(code: string, tk: TK): Promise<Air[]> {
  const { data: ch } = await sb.from("channels").select("id").eq("code", code).maybeSingle();
  const { data: tg } = await sb.from("targets").select("id").eq("label", OWN_LABEL[tk]).maybeSingle();
  const rows = await pages<any>(() => sb.from("ratings").select("broadcast_date,start_time,end_time,rating,programs(canonical_name)").eq("channel_id", ch!.id).eq("target_id", tg!.id).eq("source_type", "nielsen_daily").gte("broadcast_date", FROM).lte("broadcast_date", ASOF).not("program_id", "is", null).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => { const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name; if (!name || !r.start_time || NOT_PROG.test(name)) return []; const sm = broadcastMin(r.start_time); const em = r.end_time ? broadcastMin(r.end_time) : sm + 30; return [{ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: sm, dp: DAYPART(sm), rating: Number(r.rating), dur: Math.max(1, em - sm) }]; });
}
const wavg = (xs: Air[]) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + a.rating * a.dur, 0) / w : null; };
type Obs = { channel: string; date: string; type: HType; dp: string; ratio: number; actual: number; usual: number };
const obs: Obs[] = [];
const ownAll = new Map<string, Air[]>();
for (const o of OWN) {
  const airs = await loadOwn(o.code, o.tk); ownAll.set(o.code, airs);
  const byDate = new Map<string, Air[]>(); for (const a of airs) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  for (const t of typed) {
    const day = byDate.get(t.date); if (!day) continue;
    for (const dp of [...new Set(day.map((a) => a.dp))]) {
      const actual = wavg(day.filter((a) => a.dp === dp))!;
      // 평소: 같은 요일, ±4주(공휴일·유형 지정일 제외)의 같은 시간대 일 가중 평균들의 중앙값
      const usualVals: number[] = [];
      for (const k of [-4, -3, -2, -1, 1, 2, 3, 4]) { const d2 = dateOf(dayNum(t.date) + 7 * k); if (typeByDate.has(d2) || holidays.has(d2)) continue; const v = wavg((byDate.get(d2) ?? []).filter((a) => a.dp === dp)); if (v != null) usualVals.push(v); }
      const usual = median(usualVals);
      if (usual == null || usual <= 0 || usualVals.length < 3) continue;
      obs.push({ channel: o.code, date: t.date, type: t.type, dp, ratio: actual / usual, actual, usual });
    }
  }
}
const stat = (xs: Obs[]) => ({ n: xs.length, days: new Set(xs.map((x) => x.date)).size, median: r3(median(xs.map((x) => x.ratio))), p25: r3(q(xs.map((x) => x.ratio), 0.25)), p75: r3(q(xs.map((x) => x.ratio), 0.75)), up: xs.filter((x) => x.ratio >= 1.1).length, down: xs.filter((x) => x.ratio <= 0.9).length });
const groupBy = <T,>(xs: T[], f: (x: T) => string) => { const o: Record<string, T[]> = {}; for (const x of xs) (o[f(x)] ??= []).push(x); return o; };
const mapVals = <T, U>(o: Record<string, T>, f: (v: T) => U) => Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, f(v)]));
const A = { byType: mapVals(groupBy(obs, (x) => x.type), stat), byTypeChannel: mapVals(groupBy(obs, (x) => `${x.type}|${x.channel}`), stat), byTypeDaypart: mapVals(groupBy(obs, (x) => `${x.type}|${x.dp}`), stat), byTypeChannelDaypart: mapVals(groupBy(obs, (x) => `${x.type}|${x.channel}|${x.dp}`), stat), byTypeTk: mapVals(groupBy(obs, (x) => `${x.type}|${OWN.find((o) => o.code === x.channel)!.tk}`), stat) };
console.log(`\n== (A) 평소 대비 비율(유형별, 채널×시간대 관측 단위) ==`);
for (const [k, v] of Object.entries(A.byType)) console.log(k.padEnd(14), JSON.stringify(v));
console.log(`\n== (A) 유형×시간대 ==`);
for (const [k, v] of Object.entries(A.byTypeDaypart)) console.log(k.padEnd(22), `n=${String(v.n).padStart(3)} 일수 ${String(v.days).padStart(2)} 중앙값 ${v.median} [${v.p25}, ${v.p75}] ↑${v.up} ↓${v.down}`);
console.log(`\n== (A) 유형×채널 ==`);
for (const [k, v] of Object.entries(A.byTypeChannel)) console.log(k.padEnd(24), `n=${String(v.n).padStart(3)} 일수 ${String(v.days).padStart(2)} 중앙값 ${v.median} [${v.p25}, ${v.p75}]`);

// ---------- (B) 엔진 백테스트(평일 공휴일만, 2026년 평가) ----------
const genreMap = await loadGenreMap();
type BRec = { channel: string; date: string; type: HType; dp: string; actual: number; cur: number; sun: number; sat: number; factor: number; factorSrc: string; curF: number };
const brec: BRec[] = [];
const K_SHRINK = 8;
const priorObs: { channel: string; date: string; type: HType; dp: string; ratio: number }[] = []; // 실적÷현행 기대(시간 순 누적)
const holidayDays = typed.filter((t) => !["eve", "after"].includes(t.type)).sort((a, b) => (a.date < b.date ? -1 : 1));
for (const o of OWN) {
  const channel = await loadChannelRef(o.code); const config = await loadIdealScheduleConfig(channel.id);
  for (const t of holidayDays) {
    let actualB; let modelB;
    try { actualB = await fetchOwnAirings(channel, t.date, config); modelB = await fetchOwnAirings(channel, dateOf(dayNum(t.date) - 7), config); } catch { continue; }
    const dayAirs = actualB.airings.filter((a) => a.date === t.date && a.kpi.r != null);
    if (!dayAirs.length) continue;
    const opts = featureOptionsFor(config, channel.kpiLabel, dateOf(dayNum(t.date) - 7));
    const model = new MetricModel(eligibleAirings(modelB, opts), "r", opts, (a: OwnAiring) => resolveGenre(genreMap, "OWN", o.code, a.programName));
    const dow = isoDow(t.date);
    for (const a of dayAirs) {
      const genre = resolveGenre(genreMap, "OWN", o.code, a.programName); const h = hourBucket(a.startMin);
      const cur = model.expected(a.programId, a.airingType, genre, dow, h); const sun = model.expected(a.programId, a.airingType, genre, 7, h); const sat = model.expected(a.programId, a.airingType, genre, 6, h);
      if (cur.expected == null || sun.expected == null || sat.expected == null || cur.expected <= 0) continue;
      const dp = DAYPART(a.startMin);
      // 계수: 이 날짜보다 앞선 공휴일의 실적÷기대 — 유형×채널×시간대(8건↑) → 유형×시간대(8건↑) → 1
      const pick = (f: (p: typeof priorObs[number]) => boolean, src: string) => { const xs = priorObs.filter((p) => p.date < t.date && f(p)).map((p) => p.ratio); const m = median(xs); return xs.length >= 8 && m != null ? { f: 1 + (m - 1) * (xs.length / (xs.length + K_SHRINK)), src } : null; };
      const fac = pick((p) => p.type === t.type && p.channel === o.code && p.dp === dp, "유형×채널×시간대") ?? pick((p) => p.type === t.type && p.dp === dp, "유형×시간대") ?? { f: 1, src: "없음" };
      brec.push({ channel: o.code, date: t.date, type: t.type, dp, actual: a.kpi.r as number, cur: cur.expected, sun: sun.expected, sat: sat.expected, factor: fac.f, factorSrc: fac.src, curF: cur.expected * fac.f });
      priorObs.push({ channel: o.code, date: t.date, type: t.type, dp, ratio: (a.kpi.r as number) / cur.expected });
    }
  }
  console.log(`${o.code.padEnd(10)} 공휴일 방영 ${brec.filter((r) => r.channel === o.code).length}건`);
}
const evalRows = brec.filter((r) => r.date >= "2026-01-01");
const mae = (rows: BRec[], f: (r: BRec) => number) => rows.reduce((s, r) => s + Math.abs(f(r) - r.actual), 0);
function ratioCI(rows: BRec[], f: (r: BRec) => number, reps = 1000) {
  if (!rows.length) return null;
  // 날짜×채널 단위 블록 부트스트랩
  const blocks = Object.values(groupBy(rows, (r) => `${r.channel}|${r.date}`));
  let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const bs: number[] = [];
  for (let i = 0; i < reps; i++) { const s = Array.from({ length: blocks.length }, () => blocks[Math.floor(rnd() * blocks.length)]).flat(); bs.push(mae(s, f) / mae(s, (r) => r.cur)); }
  bs.sort((a, b) => a - b);
  return { n: rows.length, blocks: blocks.length, ratio: r3(mae(rows, f) / mae(rows, (r) => r.cur)), lo: r3(bs[Math.floor(reps * 0.025)]), hi: r3(bs[Math.floor(reps * 0.975)]), bias_cur: r3(rows.reduce((s, r) => s + (r.cur - r.actual), 0) / rows.length), bias_var: r3(rows.reduce((s, r) => s + (f(r) - r.actual), 0) / rows.length) };
}
const B: Record<string, unknown> = {};
const variants: [string, (r: BRec) => number][] = [["sun", (r) => r.sun], ["sat", (r) => r.sat], ["factor", (r) => r.curF], ["factor_sun_mix", (r) => (r.curF + r.sun) / 2]];
console.log(`\n== (B) 2026년 평일 공휴일 방영 — 변형÷현행 MAE(블록 부트스트랩 95%) ==`);
B.all = Object.fromEntries(variants.map(([k, f]) => [k, ratioCI(evalRows, f)]));
for (const [k, v] of Object.entries(B.all as Record<string, unknown>)) console.log(`전체 ${k.padEnd(15)} ${JSON.stringify(v)}`);
B.byType = {}; for (const [ty, rows] of Object.entries(groupBy(evalRows, (r) => r.type))) { (B.byType as any)[ty] = Object.fromEntries(variants.map(([k, f]) => [k, ratioCI(rows, f)])); console.log(`[${ty}] n=${rows.length} ` + variants.map(([k]) => `${k} ${JSON.stringify((B.byType as any)[ty][k]?.ratio)}[${(B.byType as any)[ty][k]?.lo},${(B.byType as any)[ty][k]?.hi}]`).join("  ")); }
B.byChannel = {}; for (const [ch, rows] of Object.entries(groupBy(evalRows, (r) => r.channel))) { (B.byChannel as any)[ch] = Object.fromEntries(variants.map(([k, f]) => [k, ratioCI(rows, f)])); console.log(`[${ch}] n=${rows.length} ` + variants.map(([k]) => `${k} ${JSON.stringify((B.byChannel as any)[ch][k]?.ratio)}[${(B.byChannel as any)[ch][k]?.lo},${(B.byChannel as any)[ch][k]?.hi}]`).join("  ")); }
B.byDaypart = {}; for (const [dp, rows] of Object.entries(groupBy(evalRows, (r) => r.dp)).sort()) { (B.byDaypart as any)[dp] = Object.fromEntries(variants.map(([k, f]) => [k, ratioCI(rows, f)])); console.log(`[${dp}] n=${rows.length} ` + variants.map(([k]) => `${k} ${JSON.stringify((B.byDaypart as any)[dp][k]?.ratio)}`).join("  ")); }
B.factorSources = groupBy(evalRows, (r) => r.factorSrc) && Object.fromEntries(Object.entries(groupBy(evalRows, (r) => r.factorSrc)).map(([k, v]) => [k, v.length]));
console.log(`계수 출처: ${JSON.stringify(B.factorSources)}`);

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), asOf: ASOF, typedDates: typed, descriptive: A, backtest: B, backtestRows: brec.map((r) => ({ ...r, actual: r3(r.actual), cur: r3(r.cur), sun: r3(r.sun), sat: r3(r.sat), factor: r3(r.factor), curF: r3(r.curF) })) }, null, 1));
console.log(`저장: ${OUT}`);
