// 경쟁(자사 7개 제외) 채널별 2쪽 보고서용 계산 — 2026-11-11 사용자 지시
// "당사 채널 7개 제외 나머지 채널들 … 닐슨 누적 시청률/순위(수도권 2049·가구), IPTV 셋톱 누적 시청률/순위, 장르군 내 순위(가구 기준),
//  상위 10~15개 프로그램, 주요 편성 인사이트·요일/시간대 히트맵 … 같은 채널군끼리 한 파일, 닐슨 시청률 순위 높은 순".
// 수치는 모두 여기서 계산한다(원칙 1). 닐슨(공식)과 IPTV(보조)는 섞지 않고 나란히 둔다.
//  - 닐슨 누적: market_ytd_rank_snapshot(시장 216개 채널, 2026-01-01~11-10, 관리자 업로드 원본)
//  - 닐슨 프로그램: 경쟁 = competitor_program_target_ratings(개인2049·유료방송가구), 자사 = ratings(nielsen_daily, 수도권 2049·전국 유료가구)
//  - IPTV: iptv_airing_metrics(방영 단위, 방영 분 가중 평균). 'IPTV 누적'은 2026년 방영 건 분 가중 평균이며 순위는 우리 IPTV 자료 채널끼리.
// 실행: node --env-file=.env --import tsx scripts/iptv-research/competitor-channel-profiles.mts → docs/iptv/competitor_channel_profiles.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FROM = "2026-01-01", TO = "2026-11-10", SNAP_TO = "2026-11-10";
// 히트맵 시간대는 2시간 단위(2026-11-12 사용자 "히트맵 3시간 단위를 모두 2시간 단위로"). 02시 이전 방송은 전날 24~26시로 본다.
const BANDS = ["06-08", "08-10", "10-12", "12-14", "14-16", "16-18", "18-20", "20-22", "22-24", "24-26", "02-04", "04-06"];
type TK = "p2049" | "household";
type Own = { name: string; code: string; iptv: string };
// 채널 정의: name = 보고서 표기, snap = 닐슨 누적 순위 파일 이름, comp = 닐슨 경쟁 프로그램 자료 이름(2026 자료 없으면 null), iptv = IPTV 이름
// tk/own = 군 기본과 다르게 볼 때(가구 중심 채널은 자사 비교 대상이 ONCE), self = 자사 채널 자신(자사 비교·진단 대상), onceRef = ONCE 참고 작품 절을 넣을 채널
type Ch = { name: string; snap: string; comp: string | null; iptv: string | null; tk?: TK; own?: Own; self?: boolean; onceRef?: boolean };
type Group = { key: string; file: string; label: string; tk: TK; ownRef: Own; rankExtra: string[]; channels: Ch[] };
const c = (name: string, snap: string, comp: string | null, iptv: string | null, x: Partial<Ch> = {}): Ch => ({ name, snap, comp, iptv, ...x });
const ONCE: Own = { name: "ONCE", code: "ONCE", iptv: "ONCE" };
// 가구 중심으로 보는 드라마군 5개(2026-11-12 사용자 "MBC ON, 하이라이트TV, EDGE TV, CNTV, D-ONE은 가구 중심, 잘 나온 프로그램은 ONCE가 참고할 만")
const HH = { tk: "household" as TK, own: ONCE, onceRef: true };
const GROUPS: Group[] = [
  { key: "terrestrial", file: "지상파·종편", label: "지상파·종편·tvN군", tk: "p2049", ownRef: { name: "ENA", code: "ENA", iptv: "ENA" }, rankExtra: ["ENA"],
    channels: [c("KBS1", "KBS1", "KBS1", "KBS1"), c("KBS2", "KBS2", "KBS2", "KBS2"), c("MBC", "MBC", "MBC", "MBC"), c("SBS", "SBS", "SBS", "SBS"), c("EBS", "EBS", null, "EBS"),
      c("JTBC", "JTBC", "JTBC", "JTBC"), c("TV CHOSUN", "TV CHOSUN", "TV CHOSUN", "TV CHOSUN"), c("tvN", "tvN", "tvN", "tvN"), c("MBN", "MBN", "MBN", "MBN"), c("채널A", "채널A", "채널A", "채널A")] },
  { key: "drama", file: "드라마", label: "드라마군", tk: "p2049", ownRef: { name: "ENA Drama", code: "ENA_DRAMA", iptv: "ENA Drama" }, rankExtra: ["ENA DRAMA", "ONCE", "Channel J", "채널차이나"],
    channels: [c("SBS Plus", "SBS Plus", "SBS Plus", "SBS Plus"), c("KBS드라마", "KBS드라마", null, "KBS drama"), c("MBC드라마넷", "MBC드라마넷", "MBC드라마넷", "MBC 드라마넷"), c("D-ONE", "D-ONE", "D-ONE", "D-ONE", HH),
      c("하이라이트TV", "하이라이트TV", null, "하이라이트 TV", HH), c("EDGE TV", "EDGETV", "EDGETV", "EDGE TV", HH), c("DRAMAcube", "DRAMAcube", "DRAMAcube", "Dramacube"), c("CNTV", "CNTV", "CNTV", "CNTV", HH),
      c("MBC ON", "MBC ON", "MBC ON", "MBC ON", HH), c("tvN DRAMA", "tvN DRAMA", null, "tvN DRAMA"), c("Dramax", "Dramax", "Dramax", "Dramax"), c("KBS Story", "KBS Story", "KBS Story", "KBS Story")] },
  { key: "variety", file: "예능·오락", label: "예능·오락군", tk: "p2049", ownRef: { name: "ENA Play", code: "ENA_PLAY", iptv: "ENA Play" }, rankExtra: ["ENA PLAY", "ENA STORY"],
    channels: [c("MBC every1", "MBC every1", "MBC every1", "MBC every1"), c("tvN STORY", "tvN STORY", "tvN STORY", "tvN Story"), c("KBS JOY", "KBS JOY", "KBS JOY", "KBS Joy"), c("채널S", "채널S", "채널S", "채널S"),
      c("SBS funE", "SBS funE", "SBS funE", "SBS FunE"), c("JTBC2", "JTBC2", "JTBC2", "JTBC2"), c("FUN TV", "FUN TV", "FUN TV", "FUN TV"), c("tvN SHOW", "tvN SHOW", "tvN SHOW", "tvN SHOW"),
      c("E채널", "E채널", "E채널", "E채널"), c("GTV", "GTV", "GTV", "GTV"), c("K STAR", "K STAR", "K STAR", "K star"), c("theLIFE", "theLIFE", "theLIFE", "theLIFE"),
      c("CH view", "CH view", "CH view", "CH view"), c("코미디TV", "코미디TV", "코미디TV", "코미디TV"), c("Mnet", "Mnet", "Mnet", "Mnet")] },
  { key: "life", file: "라이프·취미", label: "라이프·취미군", tk: "household", ownRef: { name: "OLIFE", code: "OLIFE", iptv: "OLIFE" }, rankExtra: ["OLIFE"],
    channels: [c("CMC TV", "CMCTV", "CMCTV", "CMC TV"), c("ONT", "ONT", "ONT", "ONT")] },
  { key: "uhd", file: "UHD", label: "UHD군", tk: "household", ownRef: { name: "skyUHD", code: "SKYUHD", iptv: "skyUHD" }, rankExtra: [],
    // 자사 skyUHD 도 같은 표에 넣는다(2026-11-12 사용자 "UHD 경쟁채널 파일에 skyUHD도 추가") — 자사 비교는 하지 않고 편성 진단을 붙인다
    channels: [c("skyUHD", "SkyUHD", null, "skyUHD", { self: true }), c("UXN", "UXN", null, "UXN"), c("Asia UHD", "Asia UHD", null, "Asia UHD"), c("UMAX", "UMAX", null, "UMAX"), c("UHD Dream", "UHD Dream TV", null, "UHD Dream"), c("SBS NEX", "SBS NEX", null, "SBS NEX")] },
];

type Row = { d: string; dow: number; band: string; dur: number; r: number; pn: string; key: string; rerun: boolean; s?: number; pk?: string };
const norm = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
const clean = (s: string) => s.replace(/\s*<[^>]*>/g, "").trim();
const r4 = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const wmean = (xs: Row[]) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + a.r * a.dur, 0) / w : null; };
const vol = (xs: Row[]) => xs.reduce((s, a) => s + a.r * a.dur, 0);
const isoDow = (d: string) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
// 시작 분(02:00 기준 방송일, 00~02시는 +1440) → 2시간 단위 시간대. 시작 시각으로만 칸을 정한다.
const bandOf = (sm: number) => { const h = Math.min(24, Math.max(2, Math.floor(sm / 120) * 2)); return `${String(h).padStart(2, "0")}-${String(h + 2).padStart(2, "0")}`; };
// 저녁 승부 시간(17~23시 시작)·밤 20~23시 시작
const inPrimeWide = (a: Row) => (a.s ?? 0) >= 1020 && (a.s ?? 0) < 1380;
const inPrime = (a: Row) => (a.s ?? 0) >= 1200 && (a.s ?? 0) < 1380;
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

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

// 프로그램이 아닌 방송 휴지(정파·방송 종료)는 대표 작품·비교에서 뺀다
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
// 닐슨 경쟁 프로그램 행
const COMP_LABEL: Record<TK, string> = { p2049: "개인2049", household: "유료방송가구" };
async function loadComp(name: string, tk: TK): Promise<Row[]> {
  const xs = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,end_time,program_name,norm_program_name,rating")
    .eq("competitor_name", name).eq("target_label", COMP_LABEL[tk]).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("program_name"));
  return xs.filter((x) => x.rating != null && x.start_time && x.end_time).map((x) => {
    let sm = mins(x.start_time), em = mins(x.end_time);
    if (sm < 120) sm += 1440;
    if (em < 120 || em < sm) em += 1440;
    return { d: x.broadcast_date, dow: isoDow(x.broadcast_date), band: bandOf(sm), dur: em - sm, r: Number(x.rating), pn: clean(x.program_name), key: norm(x.program_name), rerun: /<재>/.test(x.program_name), s: sm };
  }).filter((x) => x.dur > 0 && x.dur < 600 && !NOT_PROG.test(x.pn));
}
// 닐슨 자사 프로그램 행(자사 대비 칸 비교용)
const { data: chRows } = await sb.from("channels").select("id,code");
const { data: tgRows } = await sb.from("targets").select("id,label");
const OWN_TARGET: Record<TK, string> = { p2049: "수도권 2049", household: "전국 유료가구" };
async function loadOwnNielsen(code: string, tk: TK): Promise<Row[]> {
  const cid = chRows!.find((x) => x.code === code)?.id, tid = tgRows!.find((x) => x.label === OWN_TARGET[tk])?.id;
  if (!cid || !tid) return [];
  const xs = await pages<any>(() => sb.from("ratings").select("id,broadcast_date,start_time,end_time,rating").eq("channel_id", cid).eq("target_id", tid).eq("source_type", "nielsen_daily")
    .not("program_id", "is", null).not("start_time", "is", null).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("id"));
  return xs.filter((x) => x.rating != null && x.end_time).map((x) => {
    let sm = mins(x.start_time), em = mins(x.end_time);
    if (sm < 120) sm += 1440;
    if (em < 120 || em < sm) em += 1440;
    return { d: x.broadcast_date, dow: isoDow(x.broadcast_date), band: bandOf(sm), dur: em - sm, r: Number(x.rating), pn: "", key: "", rerun: false, s: sm };
  }).filter((x) => x.dur > 0 && x.dur < 600);
}
// IPTV 방영 행
async function loadIptv(name: string, tk: TK): Promise<Row[]> {
  const xs = await pages<any>(() => sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,program_key,program_name,is_rerun_tag,rating,duration_min,dow,slot_band")
    .eq("channel_name", name).eq("target_kind", tk).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_minute").order("program_key"));
  return xs.filter((x) => x.rating != null && Number(x.duration_min) > 0 && !NOT_PROG.test(clean(String(x.program_name)))).map((x) => ({ d: x.broadcast_date, dow: x.dow, band: bandOf(Number(x.start_minute)), dur: Number(x.duration_min), r: Number(x.rating), pn: clean(x.program_name), key: norm(x.program_name), rerun: !!x.is_rerun_tag, s: Number(x.start_minute), pk: x.program_key }));
}

// ── 적재 ────────────────────────────────────────────
const { data: mapRows } = await sb.from("iptv_channel_map").select("iptv_channel_name");
// 2026-11-12 추가 전달 자료(FUN TV·GTV·theLIFE·CH view·코미디TV·Mnet)는 채널 매핑표에 없어 이름을 더해 읽는다
const IPTV_ALL = [...new Set([...(mapRows ?? []).map((x) => x.iptv_channel_name as string), "FUN TV", "GTV", "theLIFE", "CH view", "코미디TV", "Mnet"])];
// IPTV 작품별 장르(iptv_program_genre) — UHD 장르 히트맵·장르 편성 분석, ONCE 참고 작품의 장르 표기에 쓴다
const genreMap = new Map<string, string>();
for (const r of await pages<{ program_key: string; genre: string }>(() => sb.from("iptv_program_genre").select("program_key,genre").order("program_key"))) genreMap.set(r.program_key, r.genre);
const genreOf = (a: Row) => genreMap.get(a.pk ?? "") ?? genreMap.get(a.key) ?? "기타";
const iptv = new Map<string, Row[]>();   // `${채널}|${tk}`
const jobsI = IPTV_ALL.flatMap((ch) => (["p2049", "household"] as TK[]).map((tk) => [ch, tk] as const));
let done = 0;
await pool(jobsI, 8, async ([ch, tk]) => { const rows = await loadIptv(ch, tk); if (rows.length) iptv.set(`${ch}|${tk}`, rows); if (++done % 10 === 0) console.log(`IPTV ${done}/${jobsI.length}`); });
const nComp = new Map<string, Row[]>();
const jobsN = GROUPS.flatMap((g) => g.channels.filter((x) => x.comp).flatMap((x) => (["p2049", "household"] as TK[]).map((tk) => [x.comp!, tk] as const)));
done = 0;
await pool(jobsN, 8, async ([nm, tk]) => { const rows = await loadComp(nm, tk); if (rows.length) nComp.set(`${nm}|${tk}`, rows); if (++done % 10 === 0) console.log(`닐슨 ${done}/${jobsN.length}`); });
// 자사 닐슨 프로그램 행: (자사 코드, 타깃)별 — 가구 중심 채널은 ONCE 가구, 나머지는 군 기본 자사
const nOwn = new Map<string, Row[]>();
for (const g of GROUPS) for (const ch of g.channels) {
  const own = ch.own ?? g.ownRef, tk = ch.tk ?? g.tk, k = `${own.code}|${tk}`;
  if (own.code !== "SKYUHD" && !nOwn.has(k)) nOwn.set(k, await loadOwnNielsen(own.code, tk));
}

// 닐슨 누적(시장 216개)
const snap = await pages<any>(() => sb.from("market_ytd_rank_snapshot").select("target_label,channel_name,rank,rating,share").eq("date_to", SNAP_TO).order("target_label").order("rank"));
const SNAP_LABEL: Record<TK, string> = { p2049: "수도권2049", household: "유료방송가구" };
const snapOf = (name: string, tk: TK) => snap.find((x) => x.target_label === SNAP_LABEL[tk] && x.channel_name === name);
const snapN = (tk: TK) => snap.filter((x) => x.target_label === SNAP_LABEL[tk]).length;

// IPTV 누적(우리 자료 채널끼리 순위)
const iptvYtd = (tk: TK) => [...iptv].filter(([k]) => k.endsWith(`|${tk}`)).map(([k, rows]) => ({ ch: k.split("|")[0], v: wmean(rows)!, from: rows[0].d, to: rows[rows.length - 1].d })).sort((a, b) => b.v - a.v);
const IY: Record<TK, ReturnType<typeof iptvYtd>> = { p2049: iptvYtd("p2049"), household: iptvYtd("household") };

// ── 계산 도우미 ─────────────────────────────────────
const DOWN = ["월", "화", "수", "목", "금", "토", "일"];
const BAND_TXT = (b: string) => `${b.slice(0, 2)}~${b.slice(3)}시`;
function cells(rows: Row[], minN = 3) {
  const m = new Map<string, Row[]>();
  for (const a of rows) (m.get(`${a.dow}|${a.band}`) ?? m.set(`${a.dow}|${a.band}`, []).get(`${a.dow}|${a.band}`)!).push(a);
  const out: Record<string, (number | null)[]> = {};
  for (const b of BANDS) out[b] = DOWN.map((_, d) => { const xs = m.get(`${d}|${b}`) ?? []; return xs.length >= minN ? r4(wmean(xs), 5) : null; });
  return { grid: out, rows: m };
}
// 주력 시간대 = 시청 규모(시청률×방영 분)가 가장 큰 시간대와 그 시간대의 주요 요일(심야 재방 횟수에 끌려가지 않게)
function mainSlot(as: Row[]) {
  const bc = new Map<string, number>(); as.forEach((a) => bc.set(a.band, (bc.get(a.band) ?? 0) + a.r * a.dur));
  const b = [...bc].sort((p, q) => q[1] - p[1])[0][0];
  const dc = new Map<number, number>(); as.filter((a) => a.band === b).forEach((a) => dc.set(a.dow, (dc.get(a.dow) ?? 0) + a.r * a.dur));
  const mx = Math.max(...dc.values());
  const days = [...dc].filter(([, n]) => n >= mx * 0.5).map(([d]) => d).sort();
  const ds = days.length === 0 ? DOWN[[...dc].sort((p, q) => q[1] - p[1])[0][0]] : days.length === 7 ? "매일" : days.join() === "0,1,2,3,4" ? "월~금" : days.join() === "5,6" ? "토·일" : days.map((d) => DOWN[d]).join("·");
  return `${ds} ${BAND_TXT(b)}`;
}
// 칸 대표 프로그램(2026-11-11 사용자 "요일별 시간대별 가장 대표적인 프로그램이 맞는지 확인"):
// 한두 번 나간 특집(선거 개표 등)이 시청 규모만으로 대표가 되지 않게, 그 칸 방송일의 15% 이상(최소 3회) 나간 정규 편성 작품 중
// 시청 규모(시청률×방영 분) 1위. 해당 작품이 없으면 가장 자주 나간 작품.
function cellRep(xs: Row[]) {
  const by = new Map<string, Row[]>(); xs.forEach((a) => (by.get(a.key) ?? by.set(a.key, []).get(a.key)!).push(a));
  const days = new Set(xs.map((a) => a.d)).size, need = Math.max(3, Math.ceil(days * 0.15)), tot = vol(xs);
  const freq = (as: Row[]) => new Set(as.map((a) => a.d)).size;
  const all = [...by.values()].sort((p, q) => vol(q) - vol(p));
  const reg = all.filter((as) => freq(as) >= need);
  const pick = reg[0] ?? [...by.values()].sort((p, q) => freq(q) - freq(p))[0];
  if (!pick) return null;
  return { name: pick[0].pn, days: freq(pick), cellDays: days, volShare: r4(vol(pick) / tot, 3), volTop: all[0][0].pn, volTopDays: freq(all[0]), regular: !!reg[0] };
}
function topCellProg(xs: Row[]) { return cellRep(xs)?.name ?? null; }

// 닐슨 vs IPTV 비교(2026-11-12 사용자 "IPTV와 닐슨 데이터를 비교했을 때 얻을 수 있는 인사이트"). 같은 채널·같은 타깃.
// 두 자료는 표본·가중치가 달라 절대값을 섞지 않고, 각 자료 안에서 "채널 평균=1" 지수로 바꿔 시간대·작품의 상대적 강약만 비교한다.
function compareSrc(nR: Row[], iR: Row[], t: TK) {
  const nAvg = wmean(nR)!, iAvg = wmean(iR)!;
  const cn = cells(nR), ci = cells(iR);
  const pairs = BANDS.flatMap((b) => DOWN.map((dn, d) => ({ cell: `${dn} ${BAND_TXT(b)}`, b, d, n: cn.grid[b][d], i: ci.grid[b][d] }))).filter((x) => x.n != null && x.i != null && x.n > 0);
  const rank = (xs: number[]) => { const s = xs.map((v, k) => [v, k] as const).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length); s.forEach(([, k], j) => (r[k] = j + 1)); return r as number[]; };
  const rn = rank(pairs.map((x) => x.n!)), ri = rank(pairs.map((x) => x.i!)), m = (pairs.length + 1) / 2;
  const spear = pairs.length > 5 ? rn.reduce((s, v, k) => s + (v - m) * (ri[k] - m), 0) / Math.sqrt(rn.reduce((s, v) => s + (v - m) ** 2, 0) * ri.reduce((s, v) => s + (v - m) ** 2, 0)) : null;
  // 시간대: IPTV 지수 ÷ 닐슨 지수 — 1보다 크면 IPTV(셋톱)에서 상대적으로 더 강함. 표본이 얇은 닐슨 극소값 칸은 제외(닐슨 지수 0.3 이상)
  const cellsR = pairs.map((x) => ({ cell: x.cell, ni: x.n! / nAvg, ii: x.i! / iAvg, prog: topCellProg(ci.rows.get(`${x.d}|${x.b}`) ?? []) })).filter((x) => x.ni >= 0.3).map((x) => ({ ...x, r: x.ii / x.ni }));
  const fmtC = (x: typeof cellsR[number]) => ({ cell: x.cell, nIdx: r4(x.ni, 2), iIdx: r4(x.ii, 2), prog: x.prog });
  // 작품: 두 자료 모두 8회 이상, 채널 평균 대비 지수
  const by = (rows: Row[]) => { const mm = new Map<string, Row[]>(); rows.forEach((a) => (mm.get(a.key) ?? mm.set(a.key, []).get(a.key)!).push(a)); return mm; };
  const bn = by(nR), bi = by(iR);
  const progs = [...bn].filter(([k, v]) => v.length >= 8 && (bi.get(k)?.length ?? 0) >= 8).map(([k, v]) => { const ni = wmean(v)! / nAvg, ii = wmean(bi.get(k)!)! / iAvg; return { name: bi.get(k)![0].pn, ni, ii, r: ii / Math.max(ni, 0.05), vol: vol(v) }; }).filter((x) => x.ni >= 0.3);
  const fmtP = (x: typeof progs[number]) => ({ name: x.name, nIdx: r4(x.ni, 2), iIdx: r4(x.ii, 2) });
  const peakN = [...pairs].sort((p, q) => q.n! - p.n!)[0], peakI = [...pairs].sort((p, q) => q.i! - p.i!)[0];
  // 평일 낮(08~17시)·저녁(17~23시)·심야(23~05시) 묶음별 지수 차 — 셋톱 가구는 낮·심야 시청이 상대적으로 크게 잡히는지
  const grp = (bs: string[]) => { const a = wmean(nR.filter((x) => bs.includes(x.band))), b = wmean(iR.filter((x) => bs.includes(x.band))); return a && b ? r4((b / iAvg) / (a / nAvg), 2) : null; };
  return {
    target: t, cells: pairs.length, spearman: r4(spear, 2),
    nZero: r4(nR.filter((a) => a.r === 0).length / nR.length, 3),
    iptvFav: [...cellsR].sort((p, q) => q.r - p.r).slice(0, 2).map(fmtC), nielsenFav: [...cellsR].sort((p, q) => p.r - q.r).slice(0, 2).map(fmtC),
    progIptvFav: [...progs].sort((p, q) => q.r - p.r).slice(0, 2).map(fmtP), progNielsenFav: [...progs].sort((p, q) => p.r - q.r).slice(0, 2).map(fmtP), progN: progs.length,
    progAgree: progs.length >= 5 ? r4((() => { const a = rank(progs.map((x) => x.ni)), b = rank(progs.map((x) => x.ii)), mm = (progs.length + 1) / 2; return a.reduce((s, v, k) => s + (v - mm) * (b[k] - mm), 0) / Math.sqrt(a.reduce((s, v) => s + (v - mm) ** 2, 0) * b.reduce((s, v) => s + (v - mm) ** 2, 0)); })(), 2) : null,
    peakN: peakN ? peakN.cell : null, peakI: peakI ? peakI.cell : null,
    dayparts: { 낮: grp(["08-10", "10-12", "12-14", "14-16"]), 저녁: grp(["16-18", "18-20", "20-22", "22-24"]), 심야: grp(["24-26", "02-04", "04-06"]), 아침: grp(["06-08"]) },
  };
}

// 편성 패턴(2026-11-12 사용자 "상대사·자사의 편성 패턴도 읽어서 편성 전략이 드러나게"): 시청률이 아니라 편성표 구조를 본다.
//  작품 수, 상위 5편 시청량 비중, 재방 표기 비중, 같은 작품 3회 이상 연속 편성 비중, 평일 띠 편성, 대표작 반복 운용, 20~23시 평일·주말 대표작
function pattern(rows: Row[]) {
  if (!rows.length) return null;
  const totMin = rows.reduce((s, a) => s + a.dur, 0), totVol = vol(rows);
  const byT = new Map<string, Row[]>(); rows.forEach((a) => (byT.get(a.key) ?? byT.set(a.key, []).get(a.key)!).push(a));
  const weeks = new Set(rows.map((a) => { const t = new Date(a.d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); })).size;
  // 연속 편성: 같은 날 같은 작품이 10분 안쪽으로 이어진 묶음
  let blockMin = 0, runs = 0, runAir = 0;
  const byDay = new Map<string, Row[]>(); rows.forEach((a) => (byDay.get(a.d) ?? byDay.set(a.d, []).get(a.d)!).push(a));
  for (const day of byDay.values()) {
    day.sort((p, q) => (p.s ?? 0) - (q.s ?? 0));
    let cur: Row[] = [];
    const flush = () => { if (cur.length) { runs++; runAir += cur.length; if (cur.length >= 3) blockMin += cur.reduce((s, a) => s + a.dur, 0); } cur = []; };
    for (const a of day) { const p = cur[cur.length - 1]; if (p && p.key === a.key && (a.s ?? 0) - ((p.s ?? 0) + p.dur) <= 10) cur.push(a); else { flush(); cur = [a]; } }
    flush();
  }
  // 평일 띠: 같은 작품이 같은 시간대에 평일 4개 요일 이상, 요일마다 4회 이상
  const strips: { name: string; band: string; vol: number }[] = [];
  for (const as of byT.values()) for (const b of BANDS) {
    const wd = as.filter((a) => a.band === b && a.dow < 5);
    const dc = new Map<number, number>(); wd.forEach((a) => dc.set(a.dow, (dc.get(a.dow) ?? 0) + 1));
    if ([...dc.values()].filter((n) => n >= 4).length >= 4) strips.push({ name: as[0].pn, band: BAND_TXT(b), vol: vol(wd) });
  }
  strips.sort((p, q) => q.vol - p.vol);
  const ranked = [...byT.values()].sort((p, q) => vol(q) - vol(p));
  // 대표작은 정규 편성(8주 이상 나간 작품) 중 시청량 1위 — 월드컵 같은 단발 중계 제외
  const wk = (as: Row[]) => new Set(as.map((a) => { const t = new Date(a.d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); })).size;
  const lead = ranked.find((as) => wk(as) >= 8) ?? ranked[0];
  const hasTag = rows.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / totMin >= 0.02;
  const first = lead.filter((a) => !a.rerun), re = lead.filter((a) => a.rerun);
  const prime = (f: (a: Row) => boolean) => { const xs = rows.filter((a) => inPrime(a) && f(a)); const t = cellRep(xs); return t?.name ?? null; };
  return {
    titles: byT.size, weeks,
    top5: r4(ranked.slice(0, 5).reduce((s, as) => s + vol(as), 0) / totVol, 3),
    rerunShare: hasTag ? r4(rows.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / totMin, 3) : null,
    blockShare: r4(blockMin / totMin, 3), avgRun: r4(runAir / Math.max(1, runs), 2),
    strips: strips.length, stripTop: strips.slice(0, 2).map((x) => ({ name: x.name, band: x.band })),
    lead: { name: lead[0].pn, perWeek: r4(lead.length / Math.max(1, weeks), 1), slots: new Set(lead.map((a) => `${a.dow}|${a.band}`)).size, share: r4(vol(lead) / totVol, 3),
      firstSlot: hasTag && first.length >= 3 ? mainSlot(first) : null, rerunSlot: hasTag && re.length >= 3 ? mainSlot(re) : null },
    primeWeekday: prime((a) => a.dow < 5), primeWeekend: prime((a) => a.dow >= 5),
  };
}

// UHD 장르 편성(2026-11-12 사용자 "UHD 장르군은 히트맵을 장르명으로도 보여주는 칸을 추가, 어떤 장르를 어떻게 배치하는지 규칙성 코멘트"):
// 칸마다 방영 분이 가장 많은 장르를 보여 주고, 장르별 편성 시간 비중·몰린 시간대·평일 띠·평일/주말 차이·칸 일관성(규칙성)을 계산한다.
const weekOf = (d: string) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
function genreInfo(rows: Row[], grid: Record<string, (number | null)[]>) {
  const tot = rows.reduce((s, a) => s + a.dur, 0), avg = wmean(rows)!, totVol = vol(rows);
  const gs = rows.map((a) => ({ a, g: genreOf(a) }));
  const byG = new Map<string, typeof gs>(); gs.forEach((x) => (byG.get(x.g) ?? byG.set(x.g, []).get(x.g)!).push(x));
  const sum = (xs: Row[]) => xs.reduce((s, a) => s + a.dur, 0);
  const mix = [...byG].map(([g, xs]) => {
    const as = xs.map((x) => x.a), m = sum(as);
    const bandMin = new Map<string, number>(); as.forEach((a) => bandMin.set(a.band, (bandMin.get(a.band) ?? 0) + a.dur));
    const bands = [...bandMin].sort((p, q) => q[1] - p[1]);
    const wd = sum(as.filter((a) => a.dow < 5)), we = m - wd;
    const wdTot = sum(rows.filter((a) => a.dow < 5)), weTot = tot - wdTot;
    return {
      g, minShare: r4(m / tot, 3), avg: r4(wmean(as), 4), idx: r4(wmean(as)! / avg, 2), volShare: r4(vol(as) / totVol, 3), titles: new Set(as.map((a) => a.key)).size,
      topBands: bands.slice(0, 2).map(([b, v]) => ({ band: BAND_TXT(b), share: r4(v / m, 3) })), top2Share: r4(bands.slice(0, 2).reduce((s, [, v]) => s + v, 0) / m, 3),
      wdShare: r4(wd / Math.max(1, wdTot), 3), weShare: r4(we / Math.max(1, weTot), 3),
      rerun: r4(sum(as.filter((a) => a.rerun)) / m, 3),
    };
  }).sort((p, q) => (q.minShare ?? 0) - (p.minShare ?? 0));
  // 칸별 대표 장르(방영 분 1위)와 그 비중 — 시청률 히트맵에 값이 있는 칸만
  const cellsG = new Map<string, typeof gs>(); gs.forEach((x) => (cellsG.get(`${x.a.dow}|${x.a.band}`) ?? cellsG.set(`${x.a.dow}|${x.a.band}`, []).get(`${x.a.dow}|${x.a.band}`)!).push(x));
  const dom = new Map<string, { g: string; sh: number; m: number }>();
  for (const [k, xs] of cellsG) {
    const [d, b] = k.split("|"); if (grid[b]?.[Number(d)] == null) continue;
    const gm = new Map<string, number>(); xs.forEach((x) => gm.set(x.g, (gm.get(x.g) ?? 0) + x.a.dur));
    const top = [...gm].sort((p, q) => q[1] - p[1])[0], m = [...gm.values()].reduce((s, v) => s + v, 0);
    dom.set(k, { g: top[0], sh: top[1] / m, m });
  }
  const gridG = Object.fromEntries(BANDS.map((b) => [b, DOWN.map((_, d) => { const x = dom.get(`${d}|${b}`); return x ? { g: x.g, sh: r4(x.sh, 2) } : null; })]));
  const dv = [...dom.values()], dm = dv.reduce((s, x) => s + x.m, 0);
  const regular = r4(dv.reduce((s, x) => s + x.sh * x.m, 0) / dm, 3);   // 칸 안에서 가장 큰 장르가 차지하는 방영 시간 비중(방영 분 가중 평균) — 클수록 한 칸에 한 장르가 규칙적으로 편성
  const fixedShare = r4(dv.filter((x) => x.sh >= 0.7).length / dv.length, 3);
  // 평일 띠: 같은 시간대에서 평일 4개 요일 이상 같은 장르가 1위(비중 60%+)
  const strips: { g: string; band: string; days: number; sh: number }[] = [];
  for (const b of BANDS) {
    const cs = [0, 1, 2, 3, 4].map((d) => ({ d, x: dom.get(`${d}|${b}`) })).filter((x) => x.x && x.x.sh >= 0.6);
    const gm = new Map<string, number[]>(); cs.forEach((x) => (gm.get(x.x!.g) ?? gm.set(x.x!.g, []).get(x.x!.g)!).push(x.d));
    for (const [g, ds] of gm) if (ds.length >= 4) strips.push({ g, band: BAND_TXT(b), days: ds.length, sh: r4(ds.reduce((s, d) => s + dom.get(`${d}|${b}`)!.sh, 0) / ds.length, 2)! });
  }
  // 같은 장르가 여러 시간대에 이어 붙은 구간(평일 같은 장르 연속 시간대) 묶기 — 설명용
  const merged: { g: string; from: string; to: string; days: number }[] = [];
  for (const s of strips) {   // strips 는 BANDS 순서(06시부터 24~26시, 마지막에 02~06시)로 쌓여 있어 바로 이웃 시간대끼리 합친다
    const last = merged[merged.length - 1];
    const [f0, t0] = s.band.replace("시", "").split("~");
    if (last && last.g === s.g && last.to === f0) { last.to = t0; last.days = Math.min(last.days, s.days); } else merged.push({ g: s.g, from: f0, to: t0, days: s.days });
  }
  // 평일·주말 편성 비중 차이가 가장 큰 장르(평일 비중 − 주말 비중, 편성 3% 이상)
  const wk = mix.filter((x) => (x.minShare ?? 0) >= 0.03).map((x) => ({ g: x.g, wd: x.wdShare ?? 0, we: x.weShare ?? 0, d: (x.wdShare ?? 0) - (x.weShare ?? 0) }));
  const weekendUp = [...wk].sort((p, q) => p.d - q.d)[0], weekdayUp = [...wk].sort((p, q) => q.d - p.d)[0];
  // 성적 좋은데 편성이 적은 장르(지수 1.15 이상, 편성 비중 10% 미만)와 편성은 큰데 성적이 낮은 장르(지수 0.85 이하, 편성 비중 15% 이상)
  const underUsed = mix.filter((x) => (x.idx ?? 0) >= 1.15 && (x.minShare ?? 0) < 0.1 && (x.minShare ?? 0) >= 0.01).slice(0, 2);
  const overUsed = mix.filter((x) => (x.idx ?? 1) <= 0.85 && (x.minShare ?? 0) >= 0.15).slice(0, 2);
  return {
    mix: mix.slice(0, 7), genreCount: mix.length, gridG, regular, fixedShare, cells: dv.length,
    strips: strips.length, stripList: merged.slice(0, 5), weekendUp: weekendUp && weekendUp.d < -0.03 ? weekendUp : null, weekdayUp: weekdayUp && weekdayUp.d > 0.03 ? weekdayUp : null,
    underUsed, overUsed,
  };
}
// UHD 편성 규칙성 지표(진단·군 비교용) — 같은 칸에 같은 작품이 얼마나 규칙적으로 나가는지, 소수 작품 반복, 단기 편성·재방 비중
function schedMetrics(rows: Row[], grid: Record<string, (number | null)[]>) {
  const tot = rows.reduce((s, a) => s + a.dur, 0);
  const byT = new Map<string, Row[]>(); rows.forEach((a) => (byT.get(a.key) ?? byT.set(a.key, []).get(a.key)!).push(a));
  const ranked = [...byT.values()].sort((p, q) => q.reduce((s, a) => s + a.dur, 0) - p.reduce((s, a) => s + a.dur, 0));
  const minOf = (xs: Row[]) => xs.reduce((s, a) => s + a.dur, 0);
  const top = ranked.slice(0, 5).map((as) => ({ name: as[0].pn, minShare: r4(minOf(as) / tot, 3)!, airings: as.length, weeks: new Set(as.map((a) => weekOf(a.d))).size, rerun: r4(minOf(as.filter((a) => a.rerun)) / minOf(as), 2)!, avg: r4(wmean(as), 4) }));
  // 칸 규칙성: 칸마다 1위 작품이 그 칸 방송일의 몇 %에서 나가는가(방영 분 가중 평균)
  const m = new Map<string, Row[]>(); rows.forEach((a) => (m.get(`${a.dow}|${a.band}`) ?? m.set(`${a.dow}|${a.band}`, []).get(`${a.dow}|${a.band}`)!).push(a));
  let wsum = 0, wtot = 0, fixedN = 0, nCells = 0;
  for (const [k, xs] of m) {
    const [d, b] = k.split("|"); if (grid[b]?.[Number(d)] == null) continue;
    const by = new Map<string, Set<string>>(); xs.forEach((a) => (by.get(a.key) ?? by.set(a.key, new Set()).get(a.key)!).add(a.d));
    const days = new Set(xs.map((a) => a.d)).size, best = Math.max(...[...by.values()].map((s) => s.size)), w = minOf(xs);
    wsum += (best / days) * w; wtot += w; nCells++; if (best / days >= 0.5) fixedN++;
  }
  // 작품별 방영 주 수: 짧게(3주 이하) 지나간 작품 비중, 길게(12주 이상) 이어진 작품 비중 — 방영 분 기준
  let shortMin = 0, longMin = 0;
  for (const as of byT.values()) { const wks = new Set(as.map((a) => weekOf(a.d))).size; if (wks <= 3) shortMin += minOf(as); if (wks >= 12) longMin += minOf(as); }
  // 월별 신작: 2026년에 처음 보이는 작품 수(1월은 이전부터 방영 중인 작품이 섞여 제외, 2~10월 평균)
  const first = new Map<string, string>(); rows.forEach((a) => { const cur = first.get(a.key); if (!cur || a.d < cur) first.set(a.key, a.d); });
  const monthly = new Map<string, number>(); first.forEach((d) => monthly.set(d.slice(0, 7), (monthly.get(d.slice(0, 7)) ?? 0) + 1));
  const ms = [...monthly].filter(([mo]) => mo >= "2026-02" && mo <= "2026-10").map(([, v]) => v);
  const pt = pattern(rows);
  return {
    titles: byT.size, airings: rows.length, top1: top[0]?.minShare ?? null, top5: r4(ranked.slice(0, 5).reduce((s, as) => s + minOf(as), 0) / tot, 3),
    top, cellRegular: r4(wsum / wtot, 3), fixedCells: r4(fixedN / nCells, 3), cells: nCells,
    shortShare: r4(shortMin / tot, 3), longShare: r4(longMin / tot, 3), newPerMonth: ms.length ? r4(ms.reduce((s, v) => s + v, 0) / ms.length, 1) : null,
    rerun: r4(minOf(rows.filter((a) => a.rerun)) / tot, 3), strips: pt?.strips ?? 0, block: pt?.blockShare ?? null, avg: r4(wmean(rows), 4),
  };
}

// ── 채널별 ─────────────────────────────────────────
const out: Record<string, unknown>[] = [];
const uhdMetrics = new Map<string, ReturnType<typeof schedMetrics>>();
for (const g of GROUPS.filter((x) => x.key === "uhd")) for (const ch of g.channels) {
  const rows = ch.iptv ? iptv.get(`${ch.iptv}|household`) ?? [] : [];
  if (rows.length) uhdMetrics.set(ch.name, schedMetrics(rows, cells(rows).grid));
}
for (const g of GROUPS) {
  const rankNames = [...g.channels.map((x) => x.snap), ...g.rankExtra];
  const genreN = (tk: TK) => rankNames.map((n) => ({ n, s: snapOf(n, tk) })).filter((x) => x.s).sort((a, b) => Number(b.s.rating) - Number(a.s.rating));
  const iptvNames = [...g.channels.map((x) => x.iptv).filter(Boolean) as string[], g.ownRef.iptv];
  const genreI = (tk: TK) => IY[tk].filter((x) => iptvNames.includes(x.ch));
  // 군 평균 2049÷가구 비(닐슨 누적)
  const skewAll = rankNames.map((n) => { const a = snapOf(n, "p2049"), b = snapOf(n, "household"); return a && b && Number(b.rating) > 0 ? Number(a.rating) / Number(b.rating) : null; }).filter((v): v is number => v != null).sort((a, b) => a - b);
  const skewMed = skewAll.length ? skewAll[Math.floor(skewAll.length / 2)] : null;
  // 군 IPTV 상·하반기 변화(가구, 군 채널 평균)
  const half = (rows: Row[]) => { const a = wmean(rows.filter((x) => x.d < "2026-07-01")), b = wmean(rows.filter((x) => x.d >= "2026-07-01")); return a && b ? b / a - 1 : null; };
  const grpTrend = (() => { const vs = iptvNames.map((n) => iptv.get(`${n}|household`)).filter(Boolean).map((r) => half(r!)).filter((v): v is number => v != null).sort((a, b) => a - b); return vs.length ? vs[Math.floor(vs.length / 2)] : null; })();

  for (const ch of g.channels) {
    const tk = ch.tk ?? g.tk, other: TK = tk === "p2049" ? "household" : "p2049";
    const own = ch.own ?? g.ownRef;   // 가구 중심 드라마 5개는 자사 비교 대상이 ONCE
    // 기준 자료: 닐슨 프로그램 자료가 2026년 4개월 이상이면 닐슨, 아니면 IPTV
    const nRows = ch.comp ? nComp.get(`${ch.comp}|${tk}`) ?? [] : [];
    const nMonths = new Set(nRows.map((x) => x.d.slice(0, 7))).size;
    const iTk: TK | null = ch.iptv ? (iptv.has(`${ch.iptv}|${tk}`) ? tk : iptv.has(`${ch.iptv}|household`) ? "household" : null) : null;
    const iRows = ch.iptv && iTk ? iptv.get(`${ch.iptv}|${iTk}`)! : [];
    const primary: "nielsen" | "iptv" = nMonths >= 4 || (!iRows.length && nRows.length) ? "nielsen" : "iptv";
    const P0 = primary === "nielsen" ? nRows : iRows;
    // 닐슨 경쟁 자료의 프로그램명은 띄어쓰기가 빠져 있어, 같은 이름의 IPTV 표기(띄어쓰기 있음)가 있으면 그것으로 보여준다
    const dispName = new Map<string, string>();
    for (const t of ["p2049", "household"] as TK[]) for (const a of (ch.iptv ? iptv.get(`${ch.iptv}|${t}`) ?? [] : [])) if (!dispName.has(a.key)) dispName.set(a.key, a.pn);
    const P = P0.map((a) => ({ ...a, pn: dispName.get(a.key) ?? a.pn }));
    const pTk: TK = primary === "nielsen" ? tk : iTk!;
    const srcLabel = (src: "nielsen" | "iptv", t: TK) => `${src === "nielsen" ? "닐슨" : "IPTV"} ${t === "p2049" ? "수도권 2049" : src === "nielsen" ? "유료방송가구" : "가구"}`;

    // Ⅰ. 누적
    const ytd = Object.fromEntries((["p2049", "household"] as TK[]).map((t) => { const s = snapOf(ch.snap, t); return [t, s ? { rating: Number(s.rating), rank: s.rank, share: s.share == null ? null : Number(s.share), of: snapN(t) } : null]; }));
    // UHD군은 IPTV 수도권 2049 자료를 일부러 싣지 않는다(2026-11-12 사용자 "UHD 경쟁군 ipTV 수도권 2049는 일부러 다 안 넣었어, 그 줄 삭제")
    const iy = Object.fromEntries((["p2049", "household"] as TK[]).map((t) => { const i = ch.iptv && !(g.key === "uhd" && t === "p2049") ? IY[t].findIndex((x) => x.ch === ch.iptv) : -1; return [t, i >= 0 ? { rating: r4(IY[t][i].v, 4), rank: i + 1, of: IY[t].length, from: IY[t][i].from, to: IY[t][i].to } : null]; }));
    const gN = genreN("household"), gI = genreI("household");
    const gi = gN.findIndex((x) => x.n === ch.snap), ii = ch.iptv ? gI.findIndex((x) => x.ch === ch.iptv) : -1;
    const nb = (arr: { n: string; v: number }[], i: number) => (i < 0 ? null : { rank: i + 1, of: arr.length, above: i > 0 ? arr[i - 1] : null, below: i < arr.length - 1 ? arr[i + 1] : null, self: arr[i].v });
    const disp = (n: string) => g.channels.find((x) => x.snap === n || x.iptv === n)?.name ?? n;
    const genre = {
      nielsen: nb(gN.map((x) => ({ n: disp(x.n), v: Number(x.s.rating) })), gi),
      iptv: nb(gI.map((x) => ({ n: disp(x.ch), v: r4(x.v, 4)! })), ii),
      nielsenList: gN.map((x, i) => `${i + 1}.${disp(x.n)}`).join(" "),
    };
    const skew = ytd.p2049 && ytd.household ? r4(ytd.p2049.rating / ytd.household.rating, 3) : null;

    // Ⅱ. 상위 프로그램(기준 자료·기준 타깃, 3회 이상 방영, 평균 시청률 순)
    const byP = new Map<string, Row[]>(); P.forEach((a) => (byP.get(a.key) ?? byP.set(a.key, []).get(a.key)!).push(a));
    const nOther = ch.comp ? nComp.get(`${ch.comp}|${other}`) ?? [] : [];
    const nSame = ch.comp ? nComp.get(`${ch.comp}|${tk}`) ?? [] : [];
    const avgBy = (rows: Row[]) => { const m = new Map<string, Row[]>(); rows.forEach((a) => (m.get(a.key) ?? m.set(a.key, []).get(a.key)!).push(a)); return new Map([...m].map(([k, v]) => [k, r4(wmean(v), 4)])); };
    const mN = avgBy(nSame), mNo = avgBy(nOther), mI = avgBy(iRows);
    const totVol = vol(P);
    // 3회짜리 특집이 상위를 차지하지 않게 8회 이상 방영 작품만(2026-11-11)
    const progs = [...byP.values()].filter((as) => as.length >= 8).map((as) => ({
      name: as[0].pn, n: as.length, v: r4(wmean(as), 4)!, vol: vol(as) / totVol,
      nielsen: mN.get(as[0].key) ?? null, nielsenOther: mNo.get(as[0].key) ?? null, iptv: mI.get(as[0].key) ?? null,
      first: as.filter((a) => !a.rerun).length, slot: mainSlot(as), last: as[as.length - 1].d,
    })).sort((a, b) => b.v - a.v);
    // 상위 15편(2026-11-12 사용자 "워드 파일에서 상위 프로그램 15개까지 늘려줘")
    const top = progs.slice(0, 15);
    const top5Vol = r4([...byP.values()].map(vol).sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0) / totVol, 3);
    const volLeader = [...byP.values()].sort((a, b) => vol(b) - vol(a))[0];

    // Ⅲ. 히트맵(기준 자료 + 다른 자료)
    const heat: Record<string, unknown>[] = [];
    const hP = cells(P);
    // 칸 대표 프로그램 = 그 칸 시청 규모(시청률×방영 분) 1위(2026-11-11 사용자 "히트맵 시청률 아랫줄에 대표 프로그램")
    const progGrid = Object.fromEntries(BANDS.map((b) => [b, DOWN.map((_, d) => (hP.grid[b][d] == null ? null : topCellProg(hP.rows.get(`${d}|${b}`) ?? [])))]));
    // 검증용: 칸마다 대표 작품의 방영일 수·시청 규모 비중, 규모만으로 고르면 달라졌을 작품
    const repCheck = BANDS.flatMap((b) => DOWN.map((dn, d) => { if (hP.grid[b][d] == null) return null; const r = cellRep(hP.rows.get(`${d}|${b}`) ?? []); return r ? { cell: `${dn} ${b}`, ...r } : null; })).filter(Boolean);
    heat.push({ src: primary, label: srcLabel(primary, pTk), grid: hP.grid, prog: progGrid, repCheck });
    // 다른 자료 히트맵도 칸 대표 프로그램과 함께(2026-11-12 사용자 "IPTV 히트맵도 다시 넣어줘")
    const alt = primary === "nielsen" ? (iRows.length ? { src: "iptv", rows: iRows, label: srcLabel("iptv", iTk!) } : null) : (nRows.length ? { src: "nielsen", rows: nRows, label: srcLabel("nielsen", tk) + (nRows[0].d > "2026-01-31" ? `(${nRows[0].d.slice(5).replace("-", "/")}~)` : "") } : null);
    if (alt) {
      const ar = alt.rows.map((a) => ({ ...a, pn: dispName.get(a.key) ?? a.pn })), hA = cells(ar);
      heat.push({ src: alt.src, label: alt.label, grid: hA.grid, prog: Object.fromEntries(BANDS.map((b) => [b, DOWN.map((_, d) => (hA.grid[b][d] == null ? null : topCellProg(hA.rows.get(`${d}|${b}`) ?? [])))])) });
    }
    // 닐슨 vs IPTV 비교(같은 타깃끼리): 시간대·작품별로 "채널 평균 대비" 지수를 두 자료에서 각각 구해 어느 쪽에서 더 강한지 본다
    const cmpT: TK | null = iTk && nComp.get(`${ch.comp}|${iTk}`)?.length ? iTk : null;
    const srcCmp = cmpT ? compareSrc((nComp.get(`${ch.comp}|${cmpT}`) ?? []).map((a) => ({ ...a, pn: dispName.get(a.key) ?? a.pn })), iptv.get(`${ch.iptv}|${cmpT}`)!.map((a) => ({ ...a, pn: dispName.get(a.key) ?? a.pn })), cmpT) : null;

    // Ⅳ. 인사이트 재료(기준 자료)
    const cellList = BANDS.flatMap((b) => DOWN.map((_, d) => ({ d, b, v: hP.grid[b][d], xs: hP.rows.get(`${d}|${b}`) ?? [] }))).filter((x) => x.v != null);
    const peaks = [...cellList].sort((p, q) => q.v! - p.v!).slice(0, 3).map((x) => ({ dow: DOWN[x.d], band: BAND_TXT(x.b), v: x.v, prog: topCellProg(x.xs) }));
    const bandVol = BANDS.map((b) => ({ b: BAND_TXT(b), share: r4(vol(P.filter((a) => a.band === b)) / totVol, 3), avg: r4(wmean(P.filter((a) => a.band === b)), 4) })).sort((p, q) => (q.share ?? 0) - (p.share ?? 0));
    const wk = (f: (a: Row) => boolean) => wmean(P.filter((a) => inPrimeWide(a) && f(a)));
    const weekdayPrime = wk((a) => a.dow < 5), weekendPrime = wk((a) => a.dow >= 5);
    const airMin = P.reduce((s, a) => s + a.dur, 0);
    const rerunShare = r4(P.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / airMin, 3);
    const firstAvg = r4(wmean(P.filter((a) => !a.rerun)), 4), rerunAvg = r4(wmean(P.filter((a) => a.rerun)), 4);
    const titles = byP.size;
    // IPTV 상·하반기(가구) — 닐슨 2026-08 모집단 가중치 변경 때문에 기간 비교는 IPTV로만
    const ih = ch.iptv ? iptv.get(`${ch.iptv}|household`) : null;
    const trend = ih ? { h1: r4(wmean(ih.filter((x) => x.d < "2026-07-01")), 4), h2: r4(wmean(ih.filter((x) => x.d >= "2026-07-01")), 4), pct: r4((half(ih) ?? 0) * 100, 1), grp: r4((grpTrend ?? 0) * 100, 1) } : null;
    // 자사 기준 채널과 칸 비교(같은 자료·같은 타깃)
    const ownRows = ch.self ? [] : primary === "nielsen" ? nOwn.get(`${own.code}|${pTk}`) ?? [] : iptv.get(`${own.iptv}|${pTk}`) ?? [];
    let ownCmp: Record<string, unknown> | null = null;
    if (ownRows.length) {
      const og = cells(ownRows).grid;
      const pairs = BANDS.flatMap((b) => DOWN.map((dn, d) => ({ dow: dn, band: BAND_TXT(b), c: hP.grid[b][d], o: og[b][d] }))).filter((x) => x.c != null && x.o != null);
      const ahead = pairs.filter((x) => x.o! > x.c!);
      ownCmp = {
        own: own.name, cells: pairs.length, ownAhead: ahead.length,
        biggestGap: [...pairs].sort((p, q) => (q.c! - q.o!) - (p.c! - p.o!)).slice(0, 2).map((x) => ({ ...x, c: r4(x.c, 4), o: r4(x.o, 4) })),
        ownBest: [...ahead].sort((p, q) => (q.o! - q.c!) - (p.o! - p.c!)).slice(0, 2).map((x) => ({ ...x, c: r4(x.c, 4), o: r4(x.o, 4) })),
        avgC: r4(wmean(P), 4), avgO: r4(wmean(ownRows), 4),
        // 자사가 가장 강한 시간대에 이 채널은 무엇을 틀고 얼마나 나오는가(맞대결 지점)
        ownPeak: (() => { const x = [...pairs].sort((p, q) => q.o! - p.o!)[0]; if (!x) return null; const b = BANDS.find((bb) => BAND_TXT(bb) === x.band)!, d = DOWN.indexOf(x.dow); return { ...x, c: r4(x.c, 4), o: r4(x.o, 4), prog: topCellProg(hP.rows.get(`${d}|${b}`) ?? []) }; })(),
        ownAheadList: [...ahead].sort((p, q) => (q.o! / q.c!) - (p.o! / p.c!)).slice(0, 3).map((x) => `${x.dow} ${x.band}`),
      };
    }
    // UHD군: 장르 히트맵·장르 편성 분석(IPTV 가구 행), 자사 skyUHD 는 군 안의 다른 채널과 편성 규칙성 지표를 나란히 둔다
    const uhd = g.key === "uhd" && iRows.length ? {
      genre: genreInfo(iRows, hP.grid), metrics: uhdMetrics.get(ch.name) ?? null,
      peers: ch.self ? [...uhdMetrics].filter(([n]) => n !== ch.name).map(([n, m]) => ({ channel: n, ...m })) : null,
    } : null;
    // ONCE 참고 작품(가구 중심 드라마 5개): IPTV 가구 기준으로 이 채널에서 잘 나온 작품이 ONCE에 편성돼 있는지·ONCE 평균과 비교(같은 자료끼리)
    const onceRef = (() => {
      if (!ch.onceRef || !ch.iptv) return null;
      const hh = iptv.get(`${ch.iptv}|household`) ?? [], oh = iptv.get("ONCE|household") ?? [];
      if (!hh.length || !oh.length) return null;
      const grp = (rows: Row[]) => { const m = new Map<string, Row[]>(); rows.forEach((a) => (m.get(a.key) ?? m.set(a.key, []).get(a.key)!).push(a)); return m; };
      const gh = grp(hh), go = grp(oh), oAvg = wmean(oh)!, cAvg = wmean(hh)!;
      const list = [...gh.values()].filter((as) => as.length >= 8).map((as) => ({ as, genre: genreOf(as[0]) })).filter((x) => !/뉴스|스포츠/.test(x.genre))
        .map((x) => { const o = go.get(x.as[0].key); return { name: x.as[0].pn, genre: x.genre, n: x.as.length, avg: r4(wmean(x.as), 4)!, slot: mainSlot(x.as), idxCh: r4(wmean(x.as)! / cAvg, 2), vsOnce: r4(wmean(x.as)! / oAvg, 2), once: o ? { n: o.length, avg: r4(wmean(o), 4)!, slot: mainSlot(o) } : null, last: x.as[x.as.length - 1].d }; })
        .sort((p, q) => q.avg - p.avg).slice(0, 8);
      return { onceAvg: r4(oAvg, 4), chAvg: r4(cAvg, 4), list, onceTitles: go.size };
    })();
    out.push({
      uhd, onceRef,
      group: g.key, groupFile: g.file, groupLabel: g.label, focus: tk, channel: ch.name, snapName: ch.snap, self: !!ch.self,
      primary, primaryLabel: srcLabel(primary, pTk), nielsenPeriod: nRows.length ? [nRows[0].d, nRows[nRows.length - 1].d] : null, iptvTarget: iTk,
      ytd, iptvYtd: iy, genre, skew, skewMed: r4(skewMed, 3),
      top, progCount: titles, top5Vol, volLeader: volLeader ? { name: volLeader[0].pn, share: r4(vol(volLeader) / totVol, 3) } : null,
      heat, peaks, bandVol: bandVol.slice(0, 3), weekdayPrime: r4(weekdayPrime, 4), weekendPrime: r4(weekendPrime, 4),
      rerunShare, firstAvg, rerunAvg, trend, ownCmp, srcCmp,
      // 편성 패턴: 경쟁 채널은 기준 자료 행, 자사는 IPTV 행(편성표 구조라 시청률 출처와 무관)
      // 닐슨 경쟁 자료는 이어 붙은 회차를 한 행으로 묶는 경우가 많아 연속 편성이 안 보이므로 IPTV(회차 단위)가 있으면 IPTV로, 없으면 닐슨으로 하되 연속 편성 지표는 비운다
      pattern: iRows.length ? pattern(iRows.map((a) => ({ ...a, pn: dispName.get(a.key) ?? a.pn }))) : (() => { const p = pattern(P); return p ? { ...p, blockShare: null, avgRun: null } : null; })(),
      patternSrc: iRows.length ? "iptv" : "nielsen", ownPattern: ch.self ? null : pattern(iptv.get(`${own.iptv}|${pTk}`) ?? iptv.get(`${own.iptv}|household`) ?? []), ownName: own.name,
    });
    console.log(`${g.file} ${ch.name}: 기준 ${primary}(${P.length}) 닐슨누적 ${ytd[tk]?.rank ?? "-"} IPTV ${iy[tk]?.rank ?? iy.household?.rank ?? "-"}`);
  }
}
fs.writeFileSync("docs/iptv/competitor_channel_profiles.json", JSON.stringify({ 기간: [FROM, TO], 닐슨누적기준일: SNAP_TO, iptvChannels: { p2049: IY.p2049.length, household: IY.household.length }, channels: out }, null, 1));
console.log("저장 docs/iptv/competitor_channel_profiles.json", out.length);
