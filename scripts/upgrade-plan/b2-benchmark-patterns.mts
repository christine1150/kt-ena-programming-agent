// 고도화 계획 F-5(B2) — 비교군 우수 사례 패턴 정의·첫 추출(읽기 전용, DB를 바꾸지 않음).
// 벤치마크 채널(F-2 결과 c1-benchmark-purchase.json의 시청률 0.5~2배 규칙, 2곳 미만이면 넓힘 규칙)과 자사 채널을 같은 정의로 비교한다.
//  P1 자리 구성: 평일/주말 × 8대 시간대마다 장르별 방영 분 비중(운영 장르 맵 resolveGenre), 재방 표기 비중(표기 있는 채널만), 자리 지수(자리 시청률 ÷ 채널 평균).
//  P2 재방 리듬: <본>·<재> 표기가 모두 있는 작품에서 본방 → 첫 재방까지 시간(중앙값), 주당 재방 수, 같은 자리 연속 방영 일수(띠 길이).
//  P3 신작 투입 자리: 최근 52주에 처음 보인 작품(그 전 26주 없음, 8회 이상)의 첫 방영 자리 분포와 첫 4주 자리 평소 대비 배수.
//  P4 집중도: 방영 분 가중 시청률 합의 상위 5개 작품 비중, 작품 수.
//  장르 채움률: 최근 52주 20회 이상 작품 중 '미분류' 비중(채널별). 20% 초과면 P1 장르 패턴을 숨긴다(계획 B2 조건).
//
// 실행: node --env-file=.env --import tsx scripts/upgrade-plan/b2-benchmark-patterns.mts → docs/upgrade-plan/b2-benchmark-patterns.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadGenreMap } from "../../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../../src/lib/idealSchedule/genreRules";
import { normalizeProgramCanonicalName } from "../../src/lib/programNameMatch";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const OUT = "docs/upgrade-plan/b2-benchmark-patterns.json";
const ASOF = "2026-11-09";
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const dateOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const FROM52 = dateOf(dayNum(ASOF) - 364), FROM78 = dateOf(dayNum(ASOF) - 546);
type TK = "p2049" | "household";
const OWN: { code: string; tk: TK }[] = [{ code: "ENA", tk: "p2049" }, { code: "ENA_DRAMA", tk: "p2049" }, { code: "ENA_PLAY", tk: "p2049" }, { code: "OLIFE", tk: "household" }, { code: "ONCE", tk: "household" }, { code: "ENA_STORY", tk: "household" }];
const COMP_LABEL: Record<TK, string> = { p2049: "개인2049", household: "유료방송가구" };
const OWN_LABEL: Record<TK, string> = { p2049: "수도권 2049", household: "전국 유료가구" };
// 순위 파일 이름 → 닐슨 경쟁 프로그램 자료 이름(F-2와 같음)
const SNAP_TO_COMP: Record<string, string> = { "SBS Plus": "SBS Plus", "MBC드라마넷": "MBC드라마넷", "D-ONE": "D-ONE", EDGETV: "EDGETV", DRAMAcube: "DRAMAcube", CNTV: "CNTV", "MBC ON": "MBC ON", Dramax: "Dramax", "KBS Story": "KBS Story", "MBC every1": "MBC every1", "tvN STORY": "tvN STORY", "KBS JOY": "KBS JOY", "채널S": "채널S", "SBS funE": "SBS funE", JTBC2: "JTBC2", "FUN TV": "FUN TV", "tvN SHOW": "tvN SHOW", "E채널": "E채널", GTV: "GTV", "K STAR": "K STAR", theLIFE: "theLIFE", "CH view": "CH view", "코미디TV": "코미디TV", Mnet: "Mnet", CMCTV: "CMCTV", ONT: "ONT" };
const c1 = JSON.parse(fs.readFileSync("docs/upgrade-plan/c1-benchmark-purchase.json", "utf8"));
const benchOf = (code: string): string[] => { const b = c1.benchmark[code]; return (b.rule_ratio.length >= 2 ? b.rule_ratio : b.rule_widen4).filter((s: string) => SNAP_TO_COMP[s]); };

const keyOf = (s: string) => normalizeProgramCanonicalName(s.replace(/<[^>]*>/g, "")).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const isoDow = (d: string) => ((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
const broadcastMin = (t: string) => { const [h, m] = t.split(":").map((v) => parseInt(v, 10)); return (h < 2 ? h + 24 : h) * 60 + (m || 0); };
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const DAYPART = (m: number) => { const h = Math.floor(m / 60); return h < 5 ? "02-05" : h < 8 ? "05-08" : h < 11 ? "08-11" : h < 14 ? "11-14" : h < 17 ? "14-17" : h < 20 ? "17-20" : h < 23 ? "20-23" : "23-02"; };
const DP = ["02-05", "05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02"];
async function pages<T>(build: () => any): Promise<T[]> { const out: T[] = []; for (let i = 0; ; i += 1000) { const { data, error } = await build().range(i, i + 999); if (error) throw new Error(error.message); out.push(...(data as T[])); if (!data || data.length < 1000) break; } return out; }

type Air = { date: string; dow: number; startMin: number; dur: number; slot: string; dp: string; key: string; name: string; rating: number; tag: "본" | "재" | null; genre: string };
const genreMap = await loadGenreMap();
async function loadOwn(code: string, tk: TK): Promise<Air[]> {
  const { data: ch } = await sb.from("channels").select("id").eq("code", code).maybeSingle();
  const { data: tg } = await sb.from("targets").select("id").eq("label", OWN_LABEL[tk]).maybeSingle();
  const rows = await pages<any>(() => sb.from("ratings").select("broadcast_date,start_time,end_time,rating,is_first_run,programs(canonical_name)").eq("channel_id", ch!.id).eq("target_id", tg!.id).eq("source_type", "nielsen_daily").gte("broadcast_date", FROM78).lte("broadcast_date", ASOF).not("program_id", "is", null).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => { const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name; if (!name || !r.start_time || NOT_PROG.test(name)) return []; const sm = broadcastMin(r.start_time); const em = r.end_time ? broadcastMin(r.end_time) : sm + 30; const dow = isoDow(r.broadcast_date); return [{ date: r.broadcast_date, dow, startMin: sm, dur: Math.max(1, em - sm), slot: `${dow >= 6 ? "WE" : "WD"}|${DAYPART(sm)}`, dp: DAYPART(sm), key: keyOf(name), name, rating: Number(r.rating), tag: r.is_first_run === true ? "본" : r.is_first_run === false ? "재" : null, genre: resolveGenre(genreMap, "OWN", code, name) }]; });
}
async function loadComp(name: string, tk: TK): Promise<Air[]> {
  const rows = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,end_time,program_name,rating").eq("competitor_name", name).eq("target_label", COMP_LABEL[tk]).gte("broadcast_date", FROM78).lte("broadcast_date", ASOF).not("rating", "is", null).order("broadcast_date").order("start_time"));
  return rows.flatMap((r) => { if (NOT_PROG.test(r.program_name)) return []; const sm = broadcastMin(r.start_time); const em = r.end_time ? broadcastMin(r.end_time) : sm + 30; const dow = isoDow(r.broadcast_date); const clean = r.program_name.replace(/<[^>]*>/g, "").trim(); return [{ date: r.broadcast_date, dow, startMin: sm, dur: Math.max(1, em - sm), slot: `${dow >= 6 ? "WE" : "WD"}|${DAYPART(sm)}`, dp: DAYPART(sm), key: keyOf(r.program_name), name: clean, rating: Number(r.rating), tag: /<본>/.test(r.program_name) ? "본" : /<재>/.test(r.program_name) ? "재" : null, genre: resolveGenre(genreMap, "COMPETITOR", name, clean) }]; });
}

// ---------- 패턴 계산(채널 하나) ----------
function patterns(all: Air[], baseFloor: number) {
  const a52 = all.filter((a) => a.date >= FROM52);
  const chanAvg = (() => { const w = a52.reduce((s, a) => s + a.dur, 0); return w ? a52.reduce((s, a) => s + a.rating * a.dur, 0) / w : null; })();
  // 장르 채움률
  const cnt = new Map<string, { n: number; genre: string }>(); for (const a of a52) { const e = cnt.get(a.key) ?? { n: 0, genre: a.genre }; e.n++; cnt.set(a.key, e); }
  const big = [...cnt.values()].filter((e) => e.n >= 20); const unclassified = big.filter((e) => e.genre === "미분류").length;
  const genreOk = big.length > 0 && unclassified / big.length <= 0.2;
  // 표기 규칙은 채널마다 다르다(점검 2026-11-13): <재>만 붙이는 채널(SBS Plus·MBC드라마넷·KBS JOY·Dramax·MBC ON·EDGETV·코미디TV·JTBC2·SBS funE)에서는 표기 없음 = 본방으로,
  // <본>만 붙이는 채널(Mnet·tvN SHOW)에서는 표기 없음 = 재방으로 본다. 둘 다 없는 채널(E채널·DRAMAcube·CNTV·CMCTV·theLIFE)은 재방 리듬을 내지 않는다.
  const nJae = a52.filter((a) => a.tag === "재").length, nBon = a52.filter((a) => a.tag === "본").length;
  const tagged = (nJae + nBon) / Math.max(1, a52.length) >= 0.3;
  const tagMode: "jae" | "bon" | null = !tagged ? null : nJae >= nBon ? "jae" : "bon";
  const runOf = (a: Air): "본" | "재" => (a.tag ?? (tagMode === "jae" ? "본" : "재"));
  // P1 자리 구성
  const P1: Record<string, { minutes: number; index: number | null; topGenre: string | null; genreShare: Record<string, number> | null; rerunShare: number | null; topTitles: string[] }> = {};
  for (const dt of ["WD", "WE"]) for (const dp of DP) {
    const xs = a52.filter((a) => a.slot === `${dt}|${dp}`); if (!xs.length) continue;
    const w = xs.reduce((s, a) => s + a.dur, 0);
    const gs: Record<string, number> = {}; for (const a of xs) gs[a.genre] = (gs[a.genre] ?? 0) + a.dur / w;
    const top = Object.entries(gs).sort((p, q) => q[1] - p[1])[0];
    const ts: Record<string, number> = {}; for (const a of xs) ts[a.name] = (ts[a.name] ?? 0) + a.dur;
    P1[`${dt}|${dp}`] = { minutes: w, index: chanAvg ? r3(xs.reduce((s, a) => s + a.rating * a.dur, 0) / w / chanAvg) : null, topGenre: genreOk ? top[0] : null, genreShare: genreOk ? Object.fromEntries(Object.entries(gs).map(([k, v]) => [k, r3(v)!])) : null, rerunShare: tagged ? r3(xs.filter((a) => runOf(a) === "재").reduce((s, a) => s + a.dur, 0) / w) : null, topTitles: Object.entries(ts).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k]) => k) };
  }
  // P2 재방 리듬(표기 있는 채널만)
  let P2: { titles: number; hoursToFirstRerun: number | null; rerunsPerWeek: number | null; stripDays: number | null } | null = null;
  if (tagged) {
    const byKey = new Map<string, Air[]>(); for (const a of a52) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a]);
    const h2: number[] = [], rpw: number[] = [], strips: number[] = [];
    for (const xs of byKey.values()) {
      const bon = xs.filter((a) => runOf(a) === "본").sort((p, q) => (p.date < q.date ? -1 : 1)); const jae = xs.filter((a) => runOf(a) === "재");
      if (bon.length < 2 || jae.length < 2) continue;
      for (const b of bon) { const t0 = dayNum(b.date) * 1440 + b.startMin; const nxt = jae.map((j) => dayNum(j.date) * 1440 + j.startMin - t0).filter((d) => d > 0 && d <= 14 * 1440); if (nxt.length) h2.push(Math.min(...nxt) / 60); }
      const weeks = (dayNum(xs[xs.length - 1].date) - dayNum(xs[0].date)) / 7 + 1; rpw.push(jae.length / weeks);
      // 띠 길이: 같은 자리(요일 무관, 같은 시간대 시작 시 ±30분) 연속 평일 방영
      const days = [...new Set(jae.filter((a) => a.dow <= 5).map((a) => `${a.date}|${Math.round(a.startMin / 30)}`))].map((s) => ({ d: dayNum(s.split("|")[0]), h: Number(s.split("|")[1]) }));
      const byH = new Map<number, number[]>(); for (const x of days) byH.set(x.h, [...(byH.get(x.h) ?? []), x.d]);
      let best = 0; for (const ds of byH.values()) { const s = [...new Set(ds)].sort((p, q) => p - q); let run = 1; for (let i = 1; i < s.length; i++) { const gap = s[i] - s[i - 1]; run = gap === 1 || (gap === 3 && isoDow(dateOf(s[i])) === 1) ? run + 1 : 1; best = Math.max(best, run); } }
      if (best) strips.push(best);
    }
    P2 = { titles: rpw.length, hoursToFirstRerun: r3(median(h2)), rerunsPerWeek: r3(median(rpw)), stripDays: r3(median(strips)) };
  }
  // P3 신작 투입 자리
  const prior = new Set(all.filter((a) => a.date < FROM52).map((a) => a.key));
  const firstSeen = new Map<string, Air[]>(); for (const a of a52) if (!prior.has(a.key)) firstSeen.set(a.key, [...(firstSeen.get(a.key) ?? []), a]);
  // 자리 평소 하한(C1과 같음): 2049 자료가 대부분 0인 자리는 배수를 내지 않는다
  const slotBase = new Map<string, number>(); for (const s of [...new Set(a52.map((a) => a.slot))]) { const xs = a52.filter((a) => a.slot === s).map((a) => a.rating); const m = median(xs); if (m != null && xs.length >= 20 && m >= baseFloor) slotBase.set(s, m); }
  const P3: { slot: string; n: number; multiple4w: number | null }[] = [];
  const slotCount: Record<string, { n: number; mults: number[] }> = {};
  for (const xs of firstSeen.values()) { if (xs.length < 8) continue; const f = xs[0]; const first4 = xs.filter((a) => dayNum(a.date) < dayNum(f.date) + 28); const m = median(first4.flatMap((a) => (slotBase.get(a.slot) ? [a.rating / slotBase.get(a.slot)!] : []))); (slotCount[f.slot] ??= { n: 0, mults: [] }).n++; if (m != null) slotCount[f.slot].mults.push(m); }
  for (const [slot, v] of Object.entries(slotCount).sort((p, q) => q[1].n - p[1].n)) P3.push({ slot, n: v.n, multiple4w: r3(median(v.mults)) });
  // P4 집중도
  const vol = new Map<string, { v: number; name: string }>(); let total = 0; for (const a of a52) { const e = vol.get(a.key) ?? { v: 0, name: a.name }; e.v += a.rating * a.dur; vol.set(a.key, e); total += a.rating * a.dur; }
  const top = [...vol.values()].sort((p, q) => q.v - p.v);
  const P4 = { titles: vol.size, top5Share: r3(top.slice(0, 5).reduce((s, e) => s + e.v, 0) / (total || 1)), top5: top.slice(0, 5).map((e) => ({ name: e.name, share: r3(e.v / (total || 1)) })) };
  return { airings52: a52.length, chanAvg: r3(chanAvg), genreFill: { titles20: big.length, unclassified, ok: genreOk }, tagged, P1, P2, P3: P3.slice(0, 8), newTitles: firstSeen.size, P4 };
}

const out: Record<string, { own: ReturnType<typeof patterns>; bench: Record<string, ReturnType<typeof patterns>>; gaps: unknown[] }> = {};
for (const o of OWN) {
  const floor = o.tk === "p2049" ? 0.005 : 0.01;
  const own = patterns(await loadOwn(o.code, o.tk), floor);
  const bench: Record<string, ReturnType<typeof patterns>> = {};
  for (const s of benchOf(o.code)) bench[s] = patterns(await loadComp(SNAP_TO_COMP[s], o.tk), floor);
  // 격차 후보: 우리 자리 지수가 벤치마크 중앙값보다 0.2 이상 낮고, 벤치마크 상위 장르가 우리와 다른 자리
  const gaps: unknown[] = [];
  for (const slot of Object.keys(own.P1)) {
    const bi = Object.values(bench).map((b) => b.P1[slot]?.index).filter((v): v is number => v != null);
    const bm = median(bi); if (bm == null || own.P1[slot].index == null) continue;
    if (own.P1[slot].index! < bm - 0.2) gaps.push({ slot, ownIndex: own.P1[slot].index, benchMedianIndex: r3(bm), ownTop: own.P1[slot].topGenre ?? own.P1[slot].topTitles[0], benchTop: Object.entries(bench).map(([n, b]) => `${n}: ${b.P1[slot]?.topGenre ?? b.P1[slot]?.topTitles[0] ?? "-"}(${b.P1[slot]?.index ?? "-"})`) });
  }
  out[o.code] = { own, bench, gaps };
  console.log(`\n=== ${o.code} (벤치마크 ${Object.keys(bench).join(", ")}) ===`);
  console.log(`장르 채움: 자사 미분류 ${own.genreFill.unclassified}/${own.genreFill.titles20} ` + Object.entries(bench).map(([n, b]) => `${n} ${b.genreFill.unclassified}/${b.genreFill.titles20}${b.tagged ? "(본재 표기)" : ""}`).join(", "));
  console.log(`집중도(상위 5개): 자사 ${own.P4.top5Share} / ${own.P4.titles}작품 ` + Object.entries(bench).map(([n, b]) => `${n} ${b.P4.top5Share}/${b.P4.titles}`).join(", "));
  if (own.P2) console.log(`재방 리듬 자사: 본→첫 재방 ${own.P2.hoursToFirstRerun}시간, 주당 재방 ${own.P2.rerunsPerWeek}, 띠 ${own.P2.stripDays}일`);
  for (const [n, b] of Object.entries(bench)) if (b.P2) console.log(`재방 리듬 ${n}: 본→첫 재방 ${b.P2.hoursToFirstRerun}시간, 주당 재방 ${b.P2.rerunsPerWeek}, 띠 ${b.P2.stripDays}일 (작품 ${b.P2.titles})`);
  console.log(`신작 투입 자리 자사(${own.newTitles}편): ` + own.P3.map((p) => `${p.slot} ${p.n}편 ${p.multiple4w ?? "-"}배`).join(" · "));
  for (const [n, b] of Object.entries(bench)) console.log(`신작 투입 자리 ${n}(${b.newTitles}편): ` + b.P3.slice(0, 4).map((p) => `${p.slot} ${p.n}편 ${p.multiple4w ?? "-"}배`).join(" · "));
  console.log(`격차 자리 ${gaps.length}개: ` + gaps.slice(0, 6).map((g: any) => `${g.slot} 우리 ${g.ownIndex}(${g.ownTop}) vs 벤치 ${g.benchMedianIndex}`).join(" · "));
}
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), asOf: ASOF, from52: FROM52, channels: out }, null, 1));
console.log(`\n저장: ${OUT}`);
