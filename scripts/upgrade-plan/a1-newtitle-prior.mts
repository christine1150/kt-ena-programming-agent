// 고도화 계획 F-3(A1) — 신작 사전값 백테스트(읽기 전용, DB를 바꾸지 않음).
// 질문: 자사에 처음 투입되는 작품(이력 없음, 근거 C)의 기대값을 "다른 채널(닐슨 경쟁 프로그램 자료)에서 낸 자리 평소 대비 배수"로 보강하면
//       지금 엔진(장르×자리 수축 → 자리 평소)보다 첫 4주 방영 예측이 정확해지는가? F-2에서 "1.0배 고정"이 가장 정확했으므로 그 기준도 같이 둔다.
// 방법: 2025-07-01~2026-10-12 사이 자사 채널에 처음 투입된 작품(그 전 2025-01부터 자사 방영 없음, 첫 4주 4회 이상)마다
//       마감 = 첫 방영 7일 전(주 단위로 묶어 같은 일요일). 운영과 같은 설정·장르 맵으로 MetricModel을 만들고(features.ts),
//       첫 4주 방영 각각에 대해 ① 현행 expected(이력 없는 programId → 장르 4·5단계 → 채널 6단계) ② 자리 평소만(지수 1)
//       ③ 피어 사전값 변형들(배수·수축 K·피어 수 보정·장르 지수와 혼합)을 계산해 실적과 비교한다.
//       피어 배수 = 마감 전 365일 경쟁 채널(허브 제외)에서 같은 자리(평일/주말×8대 시간대) 다른 프로그램 중앙값 대비 배수의 중앙값(피어당 8회 이상, 자리 평소 하한 적용 — C1과 같음).
// 평가: 작품 단위 MAE(방영별 |예측−실적| 평균)로 변형÷현행 비율을 작품 부트스트랩(1,000회) 95% 구간과 함께. 튜닝(첫 방영 2026-03-31 이전)에서 변형을 고르고 검증(2026-04-01 이후)에서 한 번만 본다.
//
// 실행: node --env-file=.env --import tsx scripts/upgrade-plan/a1-newtitle-prior.mts → docs/upgrade-plan/a1-newtitle-prior.json (실제 시청률 포함 — 외부 전송 금지)
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadChannelRef, fetchOwnAirings } from "../../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../../src/lib/idealSchedule/configStore";
import { loadGenreMap } from "../../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../../src/lib/idealSchedule/genreRules";
import { featureOptionsFor } from "../../src/lib/idealSchedule/engine";
import { MetricModel, eligibleAirings } from "../../src/lib/idealSchedule/features";
import { hourBucket } from "../../src/lib/idealSchedule/time";
import { normalizeProgramCanonicalName } from "../../src/lib/programNameMatch";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const OUT = "docs/upgrade-plan/a1-newtitle-prior.json";
const ASOF = "2026-11-09";
const FIRST_FROM = "2025-07-01", FIRST_TO = "2026-10-12", SPLIT = "2026-04-01";
const LEAD_DAYS = 7, WINDOW_DAYS = 28, MIN_OWN_AIRINGS = 4, MIN_PEER_AIRINGS = 8;
const HUB = new Set(["KBS1", "KBS2", "MBC", "SBS", "JTBC", "TV CHOSUN", "채널A", "MBN", "tvN"]);
type TK = "p2049" | "household";
const OWN: { code: string; tk: TK }[] = [{ code: "ENA", tk: "p2049" }, { code: "ENA_DRAMA", tk: "p2049" }, { code: "ENA_PLAY", tk: "p2049" }, { code: "OLIFE", tk: "household" }, { code: "ONCE", tk: "household" }, { code: "ENA_STORY", tk: "household" }];
const COMP_LABEL: Record<TK, string> = { p2049: "개인2049", household: "유료방송가구" };
const OWN_LABEL: Record<TK, string> = { p2049: "수도권 2049", household: "전국 유료가구" };
const BASE_FLOOR: Record<TK, number> = { p2049: 0.005, household: 0.01 };

const keyOf = (s: string) => normalizeProgramCanonicalName(s.replace(/<[^>]*>/g, "")).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const isoDow = (d: string) => ((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
const broadcastMin = (t: string) => { const [h, m] = t.split(":").map((v) => parseInt(v, 10)); return (h < 2 ? h + 24 : h) * 60 + (m || 0); };
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const dateOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const DAYPART = (m: number) => { const h = Math.floor(m / 60); return h < 5 ? "02-05" : h < 8 ? "05-08" : h < 11 ? "08-11" : h < 14 ? "11-14" : h < 17 ? "14-17" : h < 20 ? "17-20" : h < 23 ? "20-23" : "23-02"; };
const slotOf = (dow: number, startMin: number) => `${dow >= 6 ? "WE" : "WD"}|${DAYPART(startMin)}`;
async function pages<T>(build: () => any): Promise<T[]> { const out: T[] = []; for (let i = 0; ; i += 1000) { const { data, error } = await build().range(i, i + 999); if (error) throw new Error(error.message); out.push(...(data as T[])); if (!data || data.length < 1000) break; } return out; }

type Air = { date: string; dow: number; startMin: number; slot: string; key: string; name: string; rating: number };
async function loadOwn(code: string, tk: TK): Promise<Air[]> {
  const { data: ch } = await sb.from("channels").select("id").eq("code", code).maybeSingle();
  const { data: tg } = await sb.from("targets").select("id").eq("label", OWN_LABEL[tk]).maybeSingle();
  const rows = await pages<any>(() => sb.from("ratings").select("broadcast_date,start_time,rating,programs(canonical_name)").eq("channel_id", ch!.id).eq("target_id", tg!.id).eq("source_type", "nielsen_daily")
    .gte("broadcast_date", "2025-01-01").lte("broadcast_date", ASOF).not("program_id", "is", null).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => { const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name; if (!name || !r.start_time || NOT_PROG.test(name)) return []; const sm = broadcastMin(r.start_time); const dow = isoDow(r.broadcast_date); return [{ date: r.broadcast_date, dow, startMin: sm, slot: slotOf(dow, sm), key: keyOf(name), name, rating: Number(r.rating) }]; });
}
async function loadCompAll(tk: TK): Promise<Map<string, Air[]>> {
  const { data: names } = await sb.from("competitor_program_target_ratings").select("competitor_name").eq("target_label", COMP_LABEL[tk]).gte("broadcast_date", "2026-06-01").limit(50000);
  const chans = [...new Set((names ?? []).map((r: any) => r.competitor_name as string))].filter((n) => !HUB.has(n));
  const out = new Map<string, Air[]>();
  for (const n of chans) {
    const rows = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,program_name,rating").eq("competitor_name", n).eq("target_label", COMP_LABEL[tk]).gte("broadcast_date", "2024-07-01").lte("broadcast_date", ASOF).not("rating", "is", null).order("broadcast_date").order("start_time"));
    out.set(n, rows.flatMap((r) => (NOT_PROG.test(r.program_name) ? [] : [{ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: broadcastMin(r.start_time), slot: slotOf(isoDow(r.broadcast_date), broadcastMin(r.start_time)), key: keyOf(r.program_name), name: r.program_name, rating: Number(r.rating) }])));
  }
  return out;
}
// 한 피어 채널·기간에서 특정 키의 배수(자리 평소 = 같은 자리 다른 프로그램 중앙값, 20회·하한)
function peerMultiple(airs: Air[], key: string, tk: TK): { mult: number; n: number } | null {
  const bySlot = new Map<string, Air[]>();
  for (const a of airs) bySlot.set(a.slot, [...(bySlot.get(a.slot) ?? []), a]);
  const ratios: number[] = [];
  const baseCache = new Map<string, number | null>();
  for (const a of airs) {
    if (a.key !== key) continue;
    if (!baseCache.has(a.slot)) { const others = (bySlot.get(a.slot) ?? []).filter((x) => x.key !== key).map((x) => x.rating); const b = median(others); baseCache.set(a.slot, b != null && others.length >= 20 && b >= BASE_FLOOR[tk] ? b : null); }
    const b = baseCache.get(a.slot); if (b == null) continue;
    ratios.push(a.rating / b);
  }
  return ratios.length >= MIN_PEER_AIRINGS ? { mult: median(ratios)!, n: ratios.length } : null;
}

// 사전값 변형: 배수 m, 피어 방영 수 n, 피어 수 p, 장르 지수 g(현행 수축 지수), 수축 K
const VARIANTS: { id: string; K: number; peerFactor: boolean; blend: "replace" | "blend"; desc: string }[] = [];
for (const K of [48, 150, 400]) for (const peerFactor of [false, true]) for (const blend of ["replace", "blend"] as const) VARIANTS.push({ id: `K${K}${peerFactor ? "p" : ""}${blend === "blend" ? "b" : ""}`, K, peerFactor, blend, desc: `K=${K}${peerFactor ? "·피어수 보정" : ""}·${blend === "blend" ? "장르 지수와 혼합" : "장르 지수 대체"}` });
function priorIndex(v: typeof VARIANTS[number], m: number, n: number, p: number, g: number): number {
  const nEff = v.peerFactor ? n * Math.min(1, (p / 3) ** 2) : n;
  const shr = 1 + (m - 1) * (nEff / (nEff + v.K)); // 1 쪽으로 수축한 피어 지수
  return v.blend === "replace" ? shr : (nEff * shr + v.K * g) / (nEff + v.K);
}

type Rec = { channel: string; key: string; name: string; first: string; asOf: string; split: "tune" | "verify"; peers: number; peerN: number; mult: number | null; airings: number; genreLevel: number; mae: Record<string, number>; meanActual: number };
const recs: Rec[] = [];
const genreMap = await loadGenreMap();
for (const o of OWN) {
  const own = await loadOwn(o.code, o.tk);
  const comp = await loadCompAll(o.tk);
  const first = new Map<string, string>();
  for (const a of own) if (!first.has(a.key) || a.date < first.get(a.key)!) first.set(a.key, a.date);
  const titles = [...first].filter(([, f]) => f >= FIRST_FROM && f <= FIRST_TO).map(([k, f]) => ({ k, f, airs: own.filter((a) => a.key === k && dayNum(a.date) < dayNum(f) + WINDOW_DAYS) })).filter((t) => t.airs.length >= MIN_OWN_AIRINGS);
  const channel = await loadChannelRef(o.code);
  const config = await loadIdealScheduleConfig(channel.id);
  const modelCache = new Map<string, MetricModel>();
  let withPeer = 0;
  for (const t of titles) {
    // 마감: 첫 방영 7일 전을 그 주 일요일로 내림(같은 마감끼리 모델 재사용)
    const raw = dayNum(t.f) - LEAD_DAYS; const asOf = dateOf(raw - ((isoDow(dateOf(raw)) % 7)));
    if (!modelCache.has(asOf)) {
      const bundle = await fetchOwnAirings(channel, asOf, config);
      const opts = featureOptionsFor(config, channel.kpiLabel, asOf);
      modelCache.set(asOf, new MetricModel(eligibleAirings(bundle, opts), "r", opts, (a) => resolveGenre(genreMap, "OWN", o.code, a.programName)));
    }
    const model = modelCache.get(asOf)!;
    const genre = resolveGenre(genreMap, "OWN", o.code, t.airs[0].name);
    // 피어 배수(마감 전 365일)
    const lo = dateOf(dayNum(asOf) - 365);
    const pm = [...comp].flatMap(([ch, airs]) => { const m = peerMultiple(airs.filter((a) => a.date >= lo && a.date <= asOf), t.k, o.tk); return m ? [{ ch, ...m }] : []; });
    const mult = pm.length ? median(pm.map((x) => x.mult)) : null; const peerN = pm.reduce((s, x) => s + x.n, 0);
    if (mult != null) withPeer++;
    const errs: Record<string, number[]> = { current: [], base: [] };
    for (const v of VARIANTS) errs[v.id] = [];
    let level = 6;
    for (const a of t.airs) {
      const cur = model.expected(`__new__${t.k}`, "UNTAGGED", genre, a.dow, hourBucket(a.startMin));
      if (cur.expected == null || cur.baseline == null) continue;
      level = Math.min(level, cur.fallbackLevel);
      errs.current.push(Math.abs(cur.expected - a.rating));
      errs.base.push(Math.abs(cur.baseline - a.rating));
      for (const v of VARIANTS) { const idx = mult == null ? cur.index : priorIndex(v, mult, peerN, pm.length, cur.index); errs[v.id].push(Math.abs(idx * cur.baseline - a.rating)); }
    }
    if (!errs.current.length) continue;
    recs.push({ channel: o.code, key: t.k, name: t.airs[0].name, first: t.f, asOf, split: t.f < SPLIT ? "tune" : "verify", peers: pm.length, peerN, mult: r3(mult), airings: errs.current.length, genreLevel: level, mae: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, mean(v)!])), meanActual: mean(t.airs.map((a) => a.rating))! });
  }
  console.log(`${o.code.padEnd(10)} 신작 ${titles.length}개(평가 ${recs.filter((r) => r.channel === o.code).length}, 피어 실적 있음 ${withPeer}), 마감 모델 ${modelCache.size}개`);
}

// ---------- 집계 ----------
const ids = ["base", ...VARIANTS.map((v) => v.id)];
function ratioStats(rows: Rec[], id: string, reps = 1000) {
  if (!rows.length) return null;
  const sum = (rs: Rec[], k: string) => rs.reduce((s, r) => s + r.mae[k], 0);
  const point = sum(rows, id) / sum(rows, "current");
  const bs: number[] = [];
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < reps; i++) { const s = Array.from({ length: rows.length }, () => rows[Math.floor(rnd() * rows.length)]); bs.push(sum(s, id) / sum(s, "current")); }
  bs.sort((a, b) => a - b);
  return { n: rows.length, ratio: r3(point), lo: r3(bs[Math.floor(reps * 0.025)]), hi: r3(bs[Math.floor(reps * 0.975)]), titlesBetter: rows.filter((r) => r.mae[id] < r.mae.current).length };
}
const withPeer = recs.filter((r) => r.mult != null);
const summary: Record<string, unknown> = {};
const table = (label: string, rows: Rec[]) => { const o: Record<string, unknown> = {}; for (const id of ids) o[id] = ratioStats(rows, id); summary[label] = { n: rows.length, relErrCurrent: r3(rows.length ? rows.reduce((s, r) => s + r.mae.current, 0) / rows.reduce((s, r) => s + r.meanActual, 0) : null), ...o }; return o; };
console.log(`\n== 변형÷현행 MAE 비율(작품 단위 합, 부트스트랩 95%) — 피어 실적 있는 신작만 ==`);
for (const split of ["tune", "verify"] as const) {
  const rows = withPeer.filter((r) => r.split === split);
  const o = table(`peer_${split}`, rows);
  console.log(`[${split}] n=${rows.length}`);
  for (const id of ids) { const s = o[id] as any; if (s) console.log(`  ${id.padEnd(8)} ${String(s.ratio).padEnd(6)} [${s.lo}, ${s.hi}]  작품 중 나은 수 ${s.titlesBetter}/${s.n}  ${VARIANTS.find((v) => v.id === id)?.desc ?? "자리 평소만(지수 1)"}`); }
}
console.log(`\n== 전체 신작(피어 없으면 변형=현행) ==`);
for (const split of ["tune", "verify"] as const) { const rows = recs.filter((r) => r.split === split); const o = table(`all_${split}`, rows); console.log(`[${split}] n=${rows.length} base ${JSON.stringify(o.base)}`); }
console.log(`\n== 채널별(피어 있는 신작, 전체 기간) ==`);
for (const o of OWN) { const rows = withPeer.filter((r) => r.channel === o.code); const t = table(`channel_${o.code}`, rows); console.log(`${o.code.padEnd(10)} n=${rows.length} base ${JSON.stringify(t.base)} K150pb ${JSON.stringify(t.K150pb)} K400pb ${JSON.stringify(t.K400pb)}`); }
// 튜닝에서 고른 변형을 검증에서 한 번만 본다
const tune = withPeer.filter((r) => r.split === "tune"); const verify = withPeer.filter((r) => r.split === "verify");
const best = ids.map((id) => ({ id, s: ratioStats(tune, id) })).filter((x) => x.s).sort((a, b) => a.s!.ratio! - b.s!.ratio!)[0];
const bestVerify = best ? ratioStats(verify, best.id) : null;
console.log(`\n튜닝 1위: ${best?.id} ${JSON.stringify(best?.s)} → 검증: ${JSON.stringify(bestVerify)}`);
summary.selected = { id: best?.id, tune: best?.s, verify: bestVerify };
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), asOf: ASOF, firstFrom: FIRST_FROM, firstTo: FIRST_TO, split: SPLIT, variants: VARIANTS, summary, titles: recs.map((r) => ({ ...r, mae: Object.fromEntries(Object.entries(r.mae).map(([k, v]) => [k, r3(v)])), meanActual: r3(r.meanActual) })) }, null, 1));
console.log(`저장: ${OUT}`);
