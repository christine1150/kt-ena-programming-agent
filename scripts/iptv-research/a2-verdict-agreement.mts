// IPTV 활용 계획 2단계 A2 — 콘텐츠 적합도 판정을 닐슨 값과 IPTV 값으로 각각 내 비교한다(읽기 전용, DB 를 바꾸지 않음).
// 같은 방영 건(iptv_nielsen_pairs: 시작 ±3분 짝)만 쓰므로 표본은 같고 "어느 잣대로 쟀나"만 다르다.
// 도달·시청시간 비율은 두 자료의 정의가 달라 둘 다 비우고(null) 시청률만으로 판정한다.
// 산출: 채널별 정식 판정 일치율, 방향(강화·유지 / 관찰 / 교체·이동) 일치율, 4주 간격 판정 뒤집힘 비율(닐슨·IPTV 각각).
//
// 사용법: npx tsx --env-file=.env --env-file=.env.local scripts/iptv-research/a2-verdict-agreement.mts [--json <출력경로>]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeContentFit } from "../../src/lib/contentFit/engine";
import type { ContentFitAiring, ContentFitTag } from "../../src/lib/contentFit/types";

// 채널 KPI 타깃(CLAUDE.md 채널 그룹): A군 수도권 2049, B군 유료방송가구
const CHANNELS: { name: string; target: "household" | "p2049" }[] = [
  { name: "ENA", target: "p2049" },
  { name: "ENA Drama", target: "p2049" },
  { name: "ENA Play", target: "p2049" },
  { name: "OLIFE", target: "household" },
  { name: "ONCE", target: "household" },
  { name: "ENA Story", target: "household" },
  // 참고: A군을 가구로도 본다(2049 닐슨 잡음이 판정에 주는 영향 대조)
  { name: "ENA", target: "household" },
  { name: "ENA Drama", target: "household" },
  { name: "ENA Play", target: "household" },
];
const FROM = "2025-01-01";
const TO = "2026-10-31";
const FIRST_ASOF = "2025-04-01";
const STEP_DAYS = 28;

const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Pair = { broadcast_date: string; start_minute: number; program_key: string; is_rerun_tag: boolean; iptv_rating: number | null; nielsen_rating: number | null };
async function fetchPairs(channel: string, target: string): Promise<Pair[]> {
  const rows: Pair[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("iptv_nielsen_pairs")
      .select("broadcast_date,start_minute,program_key,is_rerun_tag,iptv_rating,nielsen_rating")
      .eq("channel_name", channel).eq("target_kind", target).eq("nielsen_source", "own")
      .gte("broadcast_date", FROM).lte("broadcast_date", TO)
      .order("broadcast_date").order("start_minute").order("program_key")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as Pair[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
const hhmm = (m: number) => {
  const mm = m % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}:00`;
};
const toAirings = (rows: Pair[], pick: (p: Pair) => number | null): ContentFitAiring[] =>
  rows.flatMap((p) => {
    const r = pick(p);
    return r === null ? [] : [{ programId: p.program_key, date: p.broadcast_date, startTime: hhmm(p.start_minute), rating: r, reach: null, timeSpentShare: null, firstRun: !p.is_rerun_tag }];
  });
const dir = (t: ContentFitTag | null) => (t === "STRENGTHEN" || t === "KEEP" ? "up" : t === "REPLACE" || t === "MOVE" ? "down" : t === "WATCH" ? "mid" : null);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

const report: Record<string, unknown>[] = [];
for (const ch of CHANNELS) {
  const rows = (await fetchPairs(ch.name, ch.target)).filter((p) => p.iptv_rating !== null && p.nielsen_rating !== null);
  const nA = toAirings(rows, (p) => p.nielsen_rating);
  const iA = toAirings(rows, (p) => p.iptv_rating);
  let both = 0, same = 0, sameDir = 0, opposite = 0;
  const prev = { n: new Map<string, string>(), i: new Map<string, string>() };
  const flips = { n: 0, nBase: 0, i: 0, iBase: 0 };
  const confusion = new Map<string, number>();
  for (let asOf = FIRST_ASOF; asOf <= TO; asOf = addDays(asOf, STEP_DAYS)) {
    const rn = computeContentFit(nA, asOf);
    const ri = computeContentFit(iA, asOf);
    const im = new Map(ri.items.map((x) => [x.programId, x]));
    const curN = new Map<string, string>();
    const curI = new Map<string, string>();
    for (const a of rn.items) {
      if (a.tier === "FORMAL" && a.tag) curN.set(a.programId, a.tag);
      const b = im.get(a.programId);
      if (!b || a.tier !== "FORMAL" || b.tier !== "FORMAL" || !a.tag || !b.tag) continue;
      both++;
      if (a.tag === b.tag) same++;
      if (dir(a.tag) === dir(b.tag)) sameDir++;
      if ((dir(a.tag) === "up" && dir(b.tag) === "down") || (dir(a.tag) === "down" && dir(b.tag) === "up")) opposite++;
      confusion.set(`${a.tag}→${b.tag}`, (confusion.get(`${a.tag}→${b.tag}`) ?? 0) + 1);
    }
    for (const b of ri.items) if (b.tier === "FORMAL" && b.tag) curI.set(b.programId, b.tag);
    // 4주 뒤에도 정식 판정인 같은 프로그램의 방향이 바뀌었나(뒤집힘)
    for (const [k, t] of curN) if (prev.n.has(k)) { flips.nBase++; if (dir(prev.n.get(k) as ContentFitTag) !== dir(t as ContentFitTag)) flips.n++; }
    for (const [k, t] of curI) if (prev.i.has(k)) { flips.iBase++; if (dir(prev.i.get(k) as ContentFitTag) !== dir(t as ContentFitTag)) flips.i++; }
    prev.n = curN;
    prev.i = curI;
  }
  const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const r = {
    channel: ch.name, target: ch.target, pairs: rows.length, formalBoth: both,
    tagAgreePct: pct(same, both), dirAgreePct: pct(sameDir, both), oppositePct: pct(opposite, both),
    flipNielsenPct: pct(flips.n, flips.nBase), flipIptvPct: pct(flips.i, flips.iBase), flipBase: [flips.nBase, flips.iBase],
    topConfusion: [...confusion].filter(([k]) => k.split("→")[0] !== k.split("→")[1]).sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
  report.push(r);
  console.log(JSON.stringify(r));
}
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
