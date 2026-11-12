// 채널별 종합 엑셀 1단계 — DB 집계 → docs/iptv/excel/channel_workbook_data.json (2026-11-12 사용자 지시, 계획: docs/iptv/excel/CHANNEL_WORKBOOK_PLAN.md)
// 수치는 모두 여기서 계산한다(원칙 1). 닐슨(공식)과 IPTV(보조)는 열을 나누고 섞지 않는다.
//  - 닐슨 경쟁: competitor_program_target_ratings(개인2049·유료방송가구·채널별 세 번째 타깃) / 자사: ratings(nielsen_daily)+programs
//  - IPTV: iptv_airing_metrics(방영 단위) — 본방·재방(<재>) 판정과 방영 횟수·분의 기준
//  - 네이버: program_naver_schedule(최신 회차 번호 = 종영작은 총 회차). 조회는 channel-workbook-naver.mts가 채운다.
// 실행: npx tsx --env-file=.env scripts/iptv-research/channel-workbook-data.mts
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { mergeBoundarySplits, mergeSplitRatingRows, weightedValue, mergedShare } from "../../src/lib/broadcastTime/boundarySplit";
import { normalizeProgramKey } from "../../src/lib/purchaseSim/normalize";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FROM = "2026-01-01", TO = "2026-11-10", SNAP_TO = "2026-11-10";
type TK = "p2049" | "household";
type Air = { d: string; s: number; dur: number; r: number | null; sh: number | null; name: string; key: string; rerun: boolean | null; reach?: number | null };

// ── 채널 정의 ───────────────────────────────────────
type Def = { name: string; sec: string; focus: TK; snap: string; comp: string | null; iptv: string; own?: string; group: string };
const own = (name: string, code: string, group: string, focus: TK, snap: string, iptv = name): Def => ({ name, sec: "자사", focus, snap, comp: null, iptv, own: code, group });
const OWN: Def[] = [
  own("ENA", "ENA", "terrestrial", "p2049", "ENA"), own("ENA Play", "ENA_PLAY", "variety", "p2049", "ENA PLAY"), own("ENA Drama", "ENA_DRAMA", "drama", "p2049", "ENA DRAMA"),
  own("ENA Story", "ENA_STORY", "variety", "household", "ENA STORY"), own("OLIFE", "OLIFE", "life", "household", "OLIFE"), own("ONCE", "ONCE", "drama", "household", "ONCE"), own("skyUHD", "SKYUHD", "uhd", "household", "SkyUHD"),
];
const SEC: Record<string, string> = { drama: "국내드라마", variety: "예능", life: "교양/취미레저", uhd: "UHD", terrestrial: "지상파·종편" };
const HHF = new Set(["D-ONE", "하이라이트TV", "EDGE TV", "CNTV", "MBC ON"]);
const c = (name: string, snap: string, comp: string | null, iptv: string, group: string): Def => ({ name, sec: SEC[group], focus: group === "life" || group === "uhd" || HHF.has(name) ? "household" : "p2049", snap, comp, iptv, group });
const COMP: Def[] = [
  ...[["KBS1", "KBS1", "KBS1", "KBS1"], ["KBS2", "KBS2", "KBS2", "KBS2"], ["MBC", "MBC", "MBC", "MBC"], ["SBS", "SBS", "SBS", "SBS"], ["EBS", "EBS", null, "EBS"], ["JTBC", "JTBC", "JTBC", "JTBC"],
    ["TV CHOSUN", "TV CHOSUN", "TV CHOSUN", "TV CHOSUN"], ["tvN", "tvN", "tvN", "tvN"], ["MBN", "MBN", "MBN", "MBN"], ["채널A", "채널A", "채널A", "채널A"]].map(([a, b, d, e]) => c(a!, b!, d, e!, "terrestrial")),
  ...[["SBS Plus", "SBS Plus", "SBS Plus", "SBS Plus"], ["KBS드라마", "KBS드라마", null, "KBS drama"], ["MBC드라마넷", "MBC드라마넷", "MBC드라마넷", "MBC 드라마넷"], ["D-ONE", "D-ONE", "D-ONE", "D-ONE"],
    ["하이라이트TV", "하이라이트TV", null, "하이라이트 TV"], ["EDGE TV", "EDGETV", "EDGETV", "EDGE TV"], ["DRAMAcube", "DRAMAcube", "DRAMAcube", "Dramacube"], ["CNTV", "CNTV", "CNTV", "CNTV"],
    ["MBC ON", "MBC ON", "MBC ON", "MBC ON"], ["tvN DRAMA", "tvN DRAMA", null, "tvN DRAMA"], ["Dramax", "Dramax", "Dramax", "Dramax"], ["KBS Story", "KBS Story", "KBS Story", "KBS Story"]].map(([a, b, d, e]) => c(a!, b!, d, e!, "drama")),
  ...[["MBC every1", "MBC every1", "MBC every1", "MBC every1"], ["tvN STORY", "tvN STORY", "tvN STORY", "tvN Story"], ["KBS JOY", "KBS JOY", "KBS JOY", "KBS Joy"], ["채널S", "채널S", "채널S", "채널S"],
    ["SBS funE", "SBS funE", "SBS funE", "SBS FunE"], ["JTBC2", "JTBC2", "JTBC2", "JTBC2"], ["FUN TV", "FUN TV", "FUN TV", "FUN TV"], ["tvN SHOW", "tvN SHOW", "tvN SHOW", "tvN SHOW"],
    ["E채널", "E채널", "E채널", "E채널"], ["GTV", "GTV", "GTV", "GTV"], ["K STAR", "K STAR", "K STAR", "K star"], ["theLIFE", "theLIFE", "theLIFE", "theLIFE"],
    ["CH view", "CH view", "CH view", "CH view"], ["코미디TV", "코미디TV", "코미디TV", "코미디TV"], ["Mnet", "Mnet", "Mnet", "Mnet"]].map(([a, b, d, e]) => c(a!, b!, d, e!, "variety")),
  c("CMC TV", "CMCTV", "CMCTV", "CMC TV", "life"), c("ONT", "ONT", "ONT", "ONT", "life"),
  ...[["UXN", "UXN", "UXN"], ["Asia UHD", "Asia UHD", "Asia UHD"], ["UMAX", "UMAX", "UMAX"], ["UHD Dream", "UHD Dream TV", "UHD Dream"], ["SBS NEX", "SBS NEX", "SBS NEX"]].map(([a, b, e]) => c(a!, b!, null, e!, "uhd")),
];

// ── 도우미 ──────────────────────────────────────────
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const r4 = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const dowOf = (d: string) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
const DN = ["월", "화", "수", "목", "금", "토", "일"];
const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const wmean = (xs: Air[]) => { const v = xs.filter((a) => a.r != null); const w = v.reduce((s, a) => s + a.dur, 0); return w ? v.reduce((s, a) => s + a.r! * a.dur, 0) / w : null; };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function dayText(days: number[]): string {
  const ds = [...new Set(days)].sort((a, b) => a - b);
  if (ds.length === 7) return "매일";
  const parts: string[] = []; let i = 0;
  while (i < ds.length) { let j = i; while (j + 1 < ds.length && ds[j + 1] === ds[j] + 1) j++; if (j - i >= 2) parts.push(`${DN[ds[i]]}~${DN[ds[j]]}`); else for (let k = i; k <= j; k++) parts.push(DN[ds[k]]); i = j + 1; }
  return parts.join("·");
}
// 본방 시간: 시작 시각을 step분으로 묶어 많은 순 최대 top개. 요일은 그 묶음 최다 요일의 30% 이상인 요일만.
function slots(rows: { d: string; s: number; dur: number }[], step: number, top: number): string[] {
  const g = new Map<number, { n: number; min: number; dows: Map<number, number> }>();
  for (const a of rows) { const k = Math.floor(a.s / step) * step; const x = g.get(k) ?? { n: 0, min: 0, dows: new Map() }; x.n++; x.min += a.dur; x.dows.set(dowOf(a.d), (x.dows.get(dowOf(a.d)) ?? 0) + 1); g.set(k, x); }
  const arr = [...g].sort((p, q) => q[1].min - p[1].min);
  const out: string[] = [];
  for (const [k, x] of arr) {
    if (out.length >= top) break;
    if (out.length > 0 && x.min < arr[0][1].min * 0.3) break;
    const mx = Math.max(...x.dows.values());
    out.push(`${dayText([...x.dows].filter(([, n]) => n >= Math.max(1, mx * 0.3)).map(([d]) => d))} ${hhmm(k)}${step > 10 ? "~" : ""}`);
  }
  return out;
}
const runTag = (raw: string): boolean | null => (/<\s*본\s*>/.test(raw) ? false : /<\s*재\s*>/.test(raw) ? true : null);   // 반환 = rerun 여부
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
async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await f(items[i++]); })); }
// 채널명 접두어 제거(KBS1일일드라마(기쁜우리좋은날) → 일일드라마-기쁜우리좋은날 대신 작품명만 남기기 어렵다 — 접두어만 뗀다)
function dispName(channel: string, raw: string): string {
  let t = clean(raw).replace(/[?!？！]/g, "").replace(/\s+/g, " ").trim();
  const c0 = channel.replace(/\s+/g, "");
  const re = new RegExp("^" + [...c0].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*") + "\\s*", "i");
  const m = t.match(re);
  if (m && t.length > m[0].length) t = t.slice(m[0].length).trim();
  return t;
}

// ── 적재 ────────────────────────────────────────────
const { data: chRows } = await sb.from("channels").select("id,code");
const { data: tgRows } = await sb.from("targets").select("id,label");
const cid = (code: string) => chRows!.find((x) => x.code === code)!.id as string;
const tid = (label: string) => tgRows!.find((x) => x.label === label)!.id as string;

async function loadIptv(name: string, tk: TK): Promise<Air[]> {
  const xs = await pages<any>(() => sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,program_key,program_name,is_rerun_tag,rating,reach_rate,duration_min")
    .eq("channel_name", name).eq("target_kind", tk).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_minute").order("program_key"));
  return xs.filter((x) => Number(x.duration_min) > 0 && !NOT_PROG.test(clean(String(x.program_name)))).map((x) => ({
    d: x.broadcast_date, s: Number(x.start_minute), dur: Number(x.duration_min), r: x.rating == null ? null : Number(x.rating), sh: null, name: String(x.program_name), key: normalizeProgramKey(String(x.program_key || x.program_name)),
    rerun: !!x.is_rerun_tag, reach: x.reach_rate == null ? null : Number(x.reach_rate),
  }));
}
function toAir(d: string, st: string, et: string, r: number | null, sh: number | null, name: string, rerun: boolean | null): Air | null {
  let sm = mins(st), em = mins(et);
  if (sm < 120) sm += 1440;
  if (em < 120 || em < sm) em += 1440;
  const dur = em - sm;
  if (!(dur > 0 && dur < 600) || NOT_PROG.test(clean(name))) return null;
  return { d, s: sm, dur, r, sh, name, key: normalizeProgramKey(name), rerun };
}
// 닐슨 경쟁: 라벨별 행 → 26:00 경계 합침 → 방영 행
async function loadComp(name: string): Promise<Map<string, Air[]>> {
  const xs = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,end_time,program_name,target_label,rating,share")
    .eq("competitor_name", name).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("program_name").order("target_label"));
  const by = new Map<string, any[]>();
  for (const x of xs) (by.get(x.target_label) ?? by.set(x.target_label, []).get(x.target_label)!).push(x);
  const out = new Map<string, Air[]>();
  for (const [label, rows] of by) {
    const merged = mergeBoundarySplits(rows, (r) => ({ key: normalizeProgramKey(r.program_name), date: r.broadcast_date, startTime: r.start_time, endTime: r.end_time }),
      (t, h, p) => ({ ...t, end_time: h.end_time, rating: weightedValue(t.rating == null ? null : Number(t.rating), p.tailSec, h.rating == null ? null : Number(h.rating), p.headSec), share: mergedShare(t.rating == null ? null : Number(t.rating), t.share == null ? null : Number(t.share), p.tailSec, h.rating == null ? null : Number(h.rating), h.share == null ? null : Number(h.share), p.headSec) }));
    out.set(label, merged.filter((x) => x.start_time && x.end_time).map((x) => toAir(x.broadcast_date, x.start_time, x.end_time, x.rating == null ? null : Number(x.rating), x.share == null ? null : Number(x.share), x.program_name, runTag(x.program_name))).filter((a): a is Air => !!a));
  }
  return out;
}
// 닐슨 자사: ratings(nielsen_daily)+programs
async function loadOwn(code: string): Promise<Map<string, Air[]>> {
  const progs = await pages<any>(() => sb.from("programs").select("id,canonical_name").eq("channel_id", cid(code)).order("id"));
  const pm = new Map(progs.map((p) => [p.id as string, p.canonical_name as string]));
  const out = new Map<string, Air[]>();
  // skyUHD는 닐슨 공식 파일이 없어 수기 업로드 파일(source_type=skyuhd, 가구 시청률, target_id 없음)을 가구 값으로 쓴다 — 시청률이 입력된 행만(원본 엑셀은 입력한 칸만 값이 있고 빈 칸은 DB에 0으로 들어가 있어, 0은 "입력 없음"으로 보고 뺀다 — 2026-11-12 원본 대조: 입력 2,013건 중 0은 1건)
  if (code === "SKYUHD") {
    const xs = await pages<any>(() => sb.from("ratings").select("id,broadcast_date,start_time,end_time,rating,share,program_id,target_id,channel_id,is_first_run,episode_number").eq("channel_id", cid(code)).eq("source_type", "skyuhd")
      .not("rating", "is", null).not("program_id", "is", null).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("id"));
    out.set("household", mergeSplitRatingRows(xs).filter((x) => x.end_time && pm.has(x.program_id) && Number(x.rating) > 0).map((x) => toAir(x.broadcast_date, x.start_time, x.end_time, Number(x.rating), null, pm.get(x.program_id)!, null)).filter((a): a is Air => !!a));
    return out;
  }
  for (const [label, tl] of [["수도권 2049", "p2049"], ["전국 유료가구", "household"]] as const) {
    const xs = await pages<any>(() => sb.from("ratings").select("id,broadcast_date,start_time,end_time,rating,share,program_id,target_id,channel_id,is_first_run,episode_number").eq("channel_id", cid(code)).eq("target_id", tid(label)).eq("source_type", "nielsen_daily")
      .not("program_id", "is", null).not("start_time", "is", null).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("id"));
    out.set(tl, mergeSplitRatingRows(xs).filter((x) => x.end_time && pm.has(x.program_id)).map((x) => toAir(x.broadcast_date, x.start_time, x.end_time, x.rating == null ? null : Number(x.rating), x.share == null ? null : Number(x.share), pm.get(x.program_id)!, x.is_first_run === true ? false : x.is_first_run === false ? true : null)).filter((a): a is Air => !!a));
  }
  return out;
}

// skyUHD 수기 파일 회차(원본 프로그램명 "내 아이의 사생활 24회" → ratings.episode_subtitle "24회") — 작품별 방영한 서로 다른 회차 번호와 최신 번호
const skyEp = new Map<string, { eps: Set<number>; max: number }>();
{
  const progs = await pages<any>(() => sb.from("programs").select("id,canonical_name").eq("channel_id", cid("SKYUHD")).order("id"));
  const pn = new Map(progs.map((p) => [p.id as string, normalizeProgramKey(p.canonical_name as string)]));
  const xs = await pages<any>(() => sb.from("ratings").select("program_id,episode_subtitle").eq("channel_id", cid("SKYUHD")).eq("source_type", "skyuhd").gte("broadcast_date", FROM).lte("broadcast_date", TO).not("episode_subtitle", "is", null).order("broadcast_date").order("start_time").order("id"));
  for (const x of xs) {
    const m = /(\d+)\s*회/.exec(String(x.episode_subtitle)); const k = pn.get(x.program_id);
    if (!m || !k) continue;
    const e = skyEp.get(k) ?? { eps: new Set<number>(), max: 0 }; e.eps.add(Number(m[1])); e.max = Math.max(e.max, Number(m[1])); skyEp.set(k, e);
  }
  console.log("skyUHD 회차 작품", skyEp.size);
}

console.log("IPTV 적재…");
const ALL: Def[] = [...OWN, ...COMP];
const iptv = new Map<string, Air[]>();
{
  const jobs = ALL.flatMap((d) => (["p2049", "household"] as TK[]).map((tk) => [d, tk] as const));
  let done = 0;
  await pool(jobs, 8, async ([d, tk]) => { const rows = await loadIptv(d.iptv, tk); if (rows.length) iptv.set(`${d.name}|${tk}`, rows); if (++done % 15 === 0) console.log(` IPTV ${done}/${jobs.length}`); });
}
console.log("닐슨 적재…");
const nielsen = new Map<string, Map<string, Air[]>>();
{
  let done = 0;
  await pool(ALL.filter((d) => d.own || d.comp), 4, async (d) => { nielsen.set(d.name, d.own ? await loadOwn(d.own) : await loadComp(d.comp!)); if (++done % 8 === 0) console.log(` 닐슨 ${done}`); });
}
const genreMap = new Map<string, string>();
for (const r of await pages<{ program_key: string; genre: string }>(() => sb.from("iptv_program_genre").select("program_key,genre").order("program_key"))) genreMap.set(normalizeProgramKey(r.program_key), r.genre);
const naver = new Map<string, any>();
for (const r of await pages<any>(() => sb.from("program_naver_schedule").select("program_key,status,matched_title,channels,start_date,end_date,episodes").order("program_key"))) naver.set(normalizeProgramKey(r.program_key), r);
const counters = new Map<string, { seed: number; date: string }>();
for (const r of await pages<any>(() => sb.from("program_episode_counters").select("canonical_name,seed_episode_number,seed_broadcast_date").order("canonical_name"))) counters.set(normalizeProgramKey(r.canonical_name), { seed: Number(r.seed_episode_number), date: r.seed_broadcast_date });
const snap = await pages<any>(() => sb.from("market_ytd_rank_snapshot").select("target_label,channel_name,rank,rating,share").eq("date_to", SNAP_TO).order("target_label").order("rank"));
const SNAP_LABEL: Record<TK, string> = { p2049: "수도권2049", household: "유료방송가구" };
const snapOf = (name: string, tk: TK) => snap.find((x) => x.target_label === SNAP_LABEL[tk] && String(x.channel_name).toLowerCase() === name.toLowerCase());
const snapN = (tk: TK) => snap.filter((x) => x.target_label === SNAP_LABEL[tk]).length;
const prof = JSON.parse(fs.readFileSync("docs/iptv/competitor_channel_profiles.json", "utf8"));
const GKEY: Record<string, string> = { terrestrial: "terrestrial", drama: "drama", variety: "variety", life: "life", uhd: "uhd" };
const nielsenList = (group: string): string[] => { const ch = prof.channels.find((x: any) => x.group === GKEY[group]); return ch ? String(ch.genre.nielsenList).split(/\s(?=\d+\.)/).map((s: string) => s.replace(/^\d+\./, "")) : []; };

// IPTV 누적(분 가중 평균)과 순위 — UHD 군 수도권 2049는 일부러 싣지 않는다
const iptvYtd = (tk: TK) => [...iptv].filter(([k]) => k.endsWith(`|${tk}`)).map(([k, rows]) => ({ ch: k.split("|")[0], v: wmean(rows)! })).filter((x) => x.v != null && !(tk === "p2049" && ALL.find((d) => d.name === x.ch)?.group === "uhd")).sort((a, b) => b.v - a.v);
const IY: Record<TK, ReturnType<typeof iptvYtd>> = { p2049: iptvYtd("p2049"), household: iptvYtd("household") };

// ── 채널별 집계 ─────────────────────────────────────
type Stat = { n: number; avg: number | null; share: number | null; cum: number };
const stat = (rows: Air[]): Stat => ({ n: rows.length, avg: r4(mean(rows.map((a) => a.r))), share: r4(mean(rows.map((a) => a.sh))), cum: r4(sum(rows.map((a) => a.r)), 3)! });
const groupBy = (rows: Air[]) => { const m = new Map<string, Air[]>(); for (const a of rows) (m.get(a.key) ?? m.set(a.key, []).get(a.key)!).push(a); return m; };
const naverInfo = (key: string) => {
  const nv = naver.get(key);
  if (!nv) return null;
  const eps = (nv.episodes ?? []) as { no: number }[];
  return { status: nv.status as string, end: (nv.end_date as string | null) ?? null, start: (nv.start_date as string | null) ?? null, latest: eps.length ? Math.max(...eps.map((e) => e.no)) : null, matched: nv.matched_title as string | null };
};
const result: any[] = [];
const naverTargets = new Map<string, { key: string; name: string; why: string; airings: number }>();
const mismatchAll: any[] = [];

for (const d of ALL) {
  const nm = nielsen.get(d.name) ?? new Map<string, Air[]>();
  const labels = [...nm.keys()];
  const L2049 = d.own ? "p2049" : "개인2049", LHH = d.own ? "household" : "유료방송가구";
  const third = d.own ? null : labels.filter((l) => l !== "개인2049" && l !== "유료방송가구").sort((a, b) => nm.get(b)!.length - nm.get(a)!.length)[0] ?? null;
  const n2049 = nm.get(L2049) ?? [], nHh = nm.get(LHH) ?? [], n3 = third ? nm.get(third)! : [];
  const iP = iptv.get(`${d.name}|p2049`) ?? [], iH = iptv.get(`${d.name}|household`) ?? [];
  const kn = d.focus === "p2049" ? n2049 : nHh;
  const months = (rows: Air[]) => new Set(rows.map((a) => a.d.slice(0, 7))).size;
  const kpiSrc: "nielsen" | "iptv" = months(kn) >= 4 ? "nielsen" : "iptv";
  const iKpi = d.focus === "p2049" && iP.length ? iP : iH.length ? iH : iP;
  const kpiRows = kpiSrc === "nielsen" ? kn : iKpi;
  // 방영 기준(횟수·분·본방): IPTV 방영(있으면), 없으면 닐슨 기준 타깃
  const baseAll: Air[] = iH.length ? iH : iP.length ? iP : kn.length ? kn : n2049.length ? n2049 : nHh;
  const baseSrc = iH.length || iP.length ? "iptv" : "nielsen";
  const baseTotMin = sum(baseAll.map((a) => a.dur));
  const tagged = baseSrc === "iptv" ? sum(baseAll.filter((a) => a.rerun).map((a) => a.dur)) / Math.max(1, baseTotMin) >= 0.02 : baseAll.some((a) => a.rerun !== null);

  // 닐슨 키를 IPTV 키에 맞춘다(채널명 접두어·부분 일치) — 맞지 않는 이름은 목록으로 남긴다
  const iKeys = new Set([...iP, ...iH].map((a) => a.key));
  const remap = new Map<string, string>();
  const nKeys = new Set([...n2049, ...nHh, ...n3].map((a) => a.key));
  const miss: string[] = [];
  for (const k of nKeys) {
    if (iKeys.has(k) || iKeys.size === 0) continue;
    const cands = [...iKeys].filter((x) => x.length >= 4 && k.length >= 4 && (x.includes(k) || k.includes(x)));
    if (cands.length === 1) remap.set(k, cands[0]); else miss.push(k);
  }
  const fix = (rows: Air[]) => rows.map((a) => (remap.has(a.key) ? { ...a, key: remap.get(a.key)! } : a));
  const N2049 = groupBy(fix(n2049)), NHH = groupBy(fix(nHh)), N3 = groupBy(fix(n3)), IP = groupBy(iP), IH = groupBy(iH), KP = groupBy(fix(kpiRows)), BASE = groupBy(baseSrc === "iptv" ? baseAll : fix(baseAll));
  const keys = new Set<string>([...N2049.keys(), ...NHH.keys(), ...N3.keys(), ...IP.keys(), ...IH.keys()]);
  const nameOf = (k: string) => { const a = (IH.get(k) ?? IP.get(k))?.[0] ?? (NHH.get(k) ?? N2049.get(k) ?? N3.get(k))?.[0] ?? BASE.get(k)?.[0]; return dispName(d.name, a ? a.name : k); };
  if (miss.length) mismatchAll.push({ channel: d.name, unmatched: miss.length, sample: miss.slice(0, 8) });

  const programs: any[] = [];
  for (const k of keys) {
    // IPTV 방영이 없는 작품(닐슨에만 있는 이름)은 닐슨 방영 행으로 센다 — 본방·재방은 닐슨 이름의 <본>·<재> 표시가 있을 때만 구분
    const nFallback = BASE.get(k) ? null : (KP.get(k) ?? NHH.get(k) ?? N2049.get(k) ?? N3.get(k) ?? []);
    const base = BASE.get(k) ?? nFallback ?? [];
    const name = nameOf(k);
    const dates = [...new Set(base.map((a) => a.d))].sort();
    const bon = tagged ? base.filter((a) => !a.rerun) : [];
    const bonDates = tagged ? new Set(base.filter((a) => !a.rerun).map((a) => a.d)) : new Set<string>();
    const re = tagged ? base.filter((a) => a.rerun) : [];
    const nv = naverInfo(k);
    const nvTotal = nv && nv.status === "found" ? nv.latest : null;
    let eps: number | null, basis: string;
    const rerunOnly = tagged && bonDates.size === 0 && dates.length > 0;
    if (nFallback && nFallback.length) { eps = nFallback.some((a) => a.rerun !== null) ? new Set(nFallback.filter((a) => !a.rerun).map((a) => a.d)).size : dates.length; basis = "추정(닐슨 방영일 수)"; }
    else if (!tagged) { eps = dates.length; basis = "추정(재방 표기 없음)"; }
    else if (rerunOnly) {
      if (nvTotal) { eps = Math.min(dates.length, nvTotal); basis = dates.length >= nvTotal ? "네이버 총 회차(재방)" : "재방 방영일 수(네이버 상한)"; }
      else { eps = dates.length; basis = "추정(재방 방영일 수)"; }
    } else {
      eps = bonDates.size; basis = "DB 본방";
      if (nvTotal && nv!.end && eps > nvTotal) { eps = nvTotal; basis = "DB 본방(네이버 총 회차로 상한)"; }
    }
    // skyUHD: 수기 파일의 회차 번호가 있으면 그것으로(에피소드 = 방영한 서로 다른 회차 수, 최신 회차 = 가장 큰 번호)
    let skyHit: { eps: Set<number>; max: number } | undefined;
    if (d.own === "SKYUHD") { skyHit = skyEp.get(k); if (!skyHit) for (const [rk, v] of skyEp) if (remap.get(rk) === k) skyHit = v; }
    if (skyHit) { eps = skyHit.eps.size; basis = "수기 파일 회차"; }
    const cnt = counters.get(k);
    const cum = cnt && tagged && bonDates.size ? cnt.seed + [...bonDates].filter((x) => x > cnt.date).length : null;
    const kpi = stat(KP.get(k) ?? []);
    const hh = IH.get(k) ?? [], pp = IP.get(k) ?? [];
    const totalMin = sum(base.map((a) => a.dur));
    // 네이버 조회 대상: 전부 재방 5회 이상 · 마지막 방영이 2026-10-10 이전인 5회 이상(종영 추정)이고 아직 네이버 정보가 없는 것
    const lastD = dates[dates.length - 1];
    if (!nv && !/뉴스|NEWS|몰아보기|하이라이트|스페셜|특집|다시보기/i.test(name) && base.length >= 5 && ((tagged && rerunOnly) || lastD <= "2026-10-10")) {
      const cur = naverTargets.get(k);
      if (!cur || cur.airings < base.length) naverTargets.set(k, { key: k, name, why: rerunOnly ? "전부 재방" : "종영 추정", airings: base.length });
    }
    programs.push({
      key: k, name, genre: genreMap.get(k) ?? "미분류", first: dates[0] ?? null, last: lastD ?? null,
      episodes: eps, epBasis: basis, naverTotal: skyHit ? skyHit.max : nvTotal, naverEnd: nv?.end ?? null, naverStatus: nv?.status ?? null, cumEpisode: cum,
      slot: tagged ? slots(bon, 5, 2).join(" / ") : "",
      nAll: base.length, nBon: tagged ? base.length - re.length : null, nRe: tagged ? re.length : null, minutes: totalMin,
      n2049: stat(N2049.get(k) ?? []), nHh: stat(NHH.get(k) ?? []), n3: stat(N3.get(k) ?? []),
      i2049: stat(pp), iHh: stat(hh), reach: r4(mean((hh.length ? hh : pp).map((a) => a.reach ?? null)), 4),
      kpiAvg: kpi.avg, kpiCum: kpi.cum, kpiN: kpi.n,
    });
  }
  programs.sort((a, b) => (b.kpiAvg ?? -1) - (a.kpiAvg ?? -1) || b.minutes - a.minutes);
  programs.forEach((p, i) => (p.rank = i + 1));

  // 채널 머리글
  const ytd = Object.fromEntries((["p2049", "household"] as TK[]).map((t) => { const s = snapOf(d.snap, t); return [t, s ? { rating: Number(s.rating), rank: s.rank, of: snapN(t) } : null]; }));
  const iy = Object.fromEntries((["p2049", "household"] as TK[]).map((t) => { const i = IY[t].findIndex((x) => x.ch === d.name); return [t, i >= 0 ? { rating: r4(IY[t][i].v, 4), rank: i + 1, of: IY[t].length } : null]; }));
  const lst = nielsenList(d.group); const gi = lst.findIndex((x) => x.toLowerCase() === d.snap.toLowerCase());
  const members = ALL.filter((x) => x.group === d.group).map((x) => x.name);
  const gI = IY.household.filter((x) => members.includes(x.ch)); const gii = gI.findIndex((x) => x.ch === d.name);
  const genreRank = { nielsen: gi >= 0 ? { rank: gi + 1, of: lst.length } : null, iptv: gii >= 0 ? { rank: gii + 1, of: gI.length } : null };

  const bonRows = tagged ? baseAll.filter((a) => !a.rerun) : [];
  const bonMin = sum(bonRows.map((a) => a.dur));
  const epsTotal = programs.reduce((s, p) => s + (p.episodes ?? 0), 0);
  const titles = programs.filter((p) => (p.episodes ?? 0) > 0).length;
  const titlesBon = tagged ? programs.filter((p) => (p.nBon ?? 0) > 0).length : null;
  const gs = new Map<string, { titles: number; eps: number; min: number }>();
  for (const p of programs) { const g = gs.get(p.genre) ?? { titles: 0, eps: 0, min: 0 }; g.titles++; g.eps += p.episodes ?? 0; g.min += p.minutes; gs.set(p.genre, g); }
  const genreSummary = [...gs].map(([genre, g]) => ({ genre, titles: g.titles, episodes: g.eps, minShare: r4(g.min / Math.max(1, baseTotMin), 4) })).sort((a, b) => (b.minShare ?? 0) - (a.minShare ?? 0));
  const cov = (rows: Air[]) => rows.length ? { rows: rows.length, months: months(rows), from: rows.reduce((m, a) => (a.d < m ? a.d : m), "9"), to: rows.reduce((m, a) => (a.d > m ? a.d : m), "0") } : null;
  result.push({
    name: d.name, snap: d.snap, manualNielsen: d.own === "SKYUHD", sec: d.sec, group: d.group, own: !!d.own, focus: d.focus, kpiSrc, kpiLabel: `${kpiSrc === "nielsen" ? "닐슨" : "IPTV"} ${d.focus === "p2049" ? "수도권 2049" : kpiSrc === "nielsen" ? "유료방송가구" : "가구"}`,
    thirdLabel: third, tagged, baseSrc,
    head: { ytd, iptvYtd: iy, genreRank, snapRank: ytd[d.focus]?.rank ?? null },
    summary: { titles, titlesBon, episodes: epsTotal, bonMinShare: tagged ? r4(bonMin / Math.max(1, baseTotMin), 4) : null, bonSlots: tagged ? slots(bonRows, 30, 3) : [], totalMin: baseTotMin, bonMin: tagged ? bonMin : null },
    genreSummary, programs,
    coverage: { n2049: cov(n2049), nHh: cov(nHh), n3: cov(n3), nShare: [...n2049, ...nHh].some((a) => a.sh != null), i2049: cov(iP), iHh: cov(iH), genreKnown: r4(programs.filter((p) => p.genre !== "미분류").length / Math.max(1, programs.length), 3), naverFound: programs.filter((p) => p.naverStatus === "found").length, titles: programs.length },
  });
  console.log(`${d.name}: 타이틀 ${programs.length} · 본방표기 ${tagged ? "O" : "X"} · KPI ${kpiSrc} · 불일치 ${miss.length}`);
}

// 탭 순서: 자사 → 국내드라마 → 예능 → 교양/취미레저 → UHD → 지상파·종편, 장르 안 2049 중심 먼저, 같은 중심 안에서 닐슨 순위(KPI 타깃) 순
const SEC_ORDER = ["국내드라마", "예능", "교양/취미레저", "UHD", "지상파·종편"];
const ordered = [
  ...OWN.map((o) => result.find((r) => r.name === o.name)),
  ...SEC_ORDER.flatMap((s) => result.filter((r) => !r.own && r.sec === s).sort((a, b) => (a.focus === b.focus ? 0 : a.focus === "p2049" ? -1 : 1) || (a.head.snapRank ?? 9999) - (b.head.snapRank ?? 9999))),
];
const targets = [...naverTargets.values()].sort((a, b) => b.airings - a.airings);
fs.mkdirSync("docs/iptv/excel", { recursive: true });
fs.writeFileSync("docs/iptv/excel/channel_workbook_data.json", JSON.stringify({ period: [FROM, TO], snapshot: Object.fromEntries((["p2049", "household"] as TK[]).map((t) => [t, snap.filter((x) => x.target_label === SNAP_LABEL[t]).map((x) => ({ n: x.channel_name, rank: x.rank, rating: Number(x.rating) }))])), channels: ordered }));
fs.writeFileSync("docs/iptv/excel/naver_targets.json", JSON.stringify(targets, null, 1));
fs.writeFileSync("docs/iptv/excel/name_mismatch.json", JSON.stringify(mismatchAll, null, 1));
console.log(`\n채널 ${ordered.length}개 · 네이버 조회 대상 ${targets.length}개(전부 재방 ${targets.filter((t) => t.why === "전부 재방").length}) · 이름 불일치 채널 ${mismatchAll.length}개`);
