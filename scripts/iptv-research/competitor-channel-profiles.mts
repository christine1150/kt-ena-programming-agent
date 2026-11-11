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
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];
type TK = "p2049" | "household";
// 채널 정의: name = 보고서 표기, snap = 닐슨 누적 순위 파일 이름, comp = 닐슨 경쟁 프로그램 자료 이름(2026 자료 없으면 null), iptv = IPTV 이름
type Ch = { name: string; snap: string; comp: string | null; iptv: string | null };
type Group = { key: string; file: string; label: string; tk: TK; ownRef: { name: string; code: string; iptv: string }; rankExtra: string[]; channels: Ch[] };
const c = (name: string, snap: string, comp: string | null, iptv: string | null): Ch => ({ name, snap, comp, iptv });
const GROUPS: Group[] = [
  { key: "terrestrial", file: "지상파·종편", label: "지상파·종편·tvN군", tk: "p2049", ownRef: { name: "ENA", code: "ENA", iptv: "ENA" }, rankExtra: ["ENA"],
    channels: [c("KBS1", "KBS1", "KBS1", "KBS1"), c("KBS2", "KBS2", "KBS2", "KBS2"), c("MBC", "MBC", "MBC", "MBC"), c("SBS", "SBS", "SBS", "SBS"), c("EBS", "EBS", null, "EBS"),
      c("JTBC", "JTBC", "JTBC", "JTBC"), c("TV CHOSUN", "TV CHOSUN", "TV CHOSUN", "TV CHOSUN"), c("tvN", "tvN", "tvN", "tvN"), c("MBN", "MBN", "MBN", "MBN"), c("채널A", "채널A", "채널A", "채널A")] },
  { key: "drama", file: "드라마", label: "드라마군", tk: "p2049", ownRef: { name: "ENA Drama", code: "ENA_DRAMA", iptv: "ENA Drama" }, rankExtra: ["ENA DRAMA", "ONCE", "Channel J", "채널차이나"],
    channels: [c("SBS Plus", "SBS Plus", "SBS Plus", "SBS Plus"), c("KBS드라마", "KBS드라마", null, "KBS drama"), c("MBC드라마넷", "MBC드라마넷", "MBC드라마넷", "MBC 드라마넷"), c("D-ONE", "D-ONE", "D-ONE", "D-ONE"),
      c("하이라이트TV", "하이라이트TV", null, "하이라이트 TV"), c("EDGE TV", "EDGETV", "EDGETV", "EDGE TV"), c("DRAMAcube", "DRAMAcube", "DRAMAcube", "Dramacube"), c("CNTV", "CNTV", "CNTV", "CNTV"),
      c("MBC ON", "MBC ON", "MBC ON", "MBC ON"), c("tvN DRAMA", "tvN DRAMA", null, "tvN DRAMA"), c("Dramax", "Dramax", "Dramax", "Dramax"), c("KBS Story", "KBS Story", "KBS Story", "KBS Story")] },
  { key: "variety", file: "예능·오락", label: "예능·오락군", tk: "p2049", ownRef: { name: "ENA Play", code: "ENA_PLAY", iptv: "ENA Play" }, rankExtra: ["ENA PLAY", "ENA STORY"],
    channels: [c("MBC every1", "MBC every1", "MBC every1", "MBC every1"), c("tvN STORY", "tvN STORY", "tvN STORY", "tvN Story"), c("KBS JOY", "KBS JOY", "KBS JOY", "KBS Joy"), c("채널S", "채널S", "채널S", "채널S"),
      c("SBS funE", "SBS funE", "SBS funE", "SBS FunE"), c("JTBC2", "JTBC2", "JTBC2", "JTBC2"), c("FUN TV", "FUN TV", "FUN TV", null), c("tvN SHOW", "tvN SHOW", "tvN SHOW", "tvN SHOW"),
      c("E채널", "E채널", "E채널", "E채널"), c("GTV", "GTV", "GTV", null), c("K STAR", "K STAR", "K STAR", "K star"), c("theLIFE", "theLIFE", "theLIFE", null),
      c("CH view", "CH view", "CH view", null), c("코미디TV", "코미디TV", "코미디TV", null), c("Mnet", "Mnet", "Mnet", null)] },
  { key: "life", file: "라이프·취미", label: "라이프·취미군", tk: "household", ownRef: { name: "OLIFE", code: "OLIFE", iptv: "OLIFE" }, rankExtra: ["OLIFE"],
    channels: [c("CMC TV", "CMCTV", "CMCTV", "CMC TV"), c("ONT", "ONT", "ONT", "ONT")] },
  { key: "uhd", file: "UHD", label: "UHD군", tk: "household", ownRef: { name: "skyUHD", code: "SKYUHD", iptv: "skyUHD" }, rankExtra: ["SkyUHD"],
    channels: [c("UXN", "UXN", null, "UXN"), c("Asia UHD", "Asia UHD", null, "Asia UHD"), c("UMAX", "UMAX", null, "UMAX"), c("UHD Dream", "UHD Dream TV", null, "UHD Dream"), c("SBS NEX", "SBS NEX", null, "SBS NEX")] },
];

type Row = { d: string; dow: number; band: string; dur: number; r: number; pn: string; key: string; rerun: boolean };
const norm = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
const clean = (s: string) => s.replace(/\s*<[^>]*>/g, "").trim();
const r4 = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const wmean = (xs: Row[]) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + a.r * a.dur, 0) / w : null; };
const vol = (xs: Row[]) => xs.reduce((s, a) => s + a.r * a.dur, 0);
const isoDow = (d: string) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
const bandOf = (sm: number) => (sm >= 1380 ? "23-02" : sm < 300 ? "02-05" : sm < 480 ? "05-08" : sm < 660 ? "08-11" : sm < 840 ? "11-14" : sm < 1020 ? "14-17" : sm < 1200 ? "17-20" : "20-23");
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

// 닐슨 경쟁 프로그램 행
const COMP_LABEL: Record<TK, string> = { p2049: "개인2049", household: "유료방송가구" };
async function loadComp(name: string, tk: TK): Promise<Row[]> {
  const xs = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,end_time,program_name,norm_program_name,rating")
    .eq("competitor_name", name).eq("target_label", COMP_LABEL[tk]).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("program_name"));
  return xs.filter((x) => x.rating != null && x.start_time && x.end_time).map((x) => {
    let sm = mins(x.start_time), em = mins(x.end_time);
    if (sm < 120) sm += 1440;
    if (em < 120 || em < sm) em += 1440;
    return { d: x.broadcast_date, dow: isoDow(x.broadcast_date), band: bandOf(sm), dur: em - sm, r: Number(x.rating), pn: clean(x.program_name), key: norm(x.program_name), rerun: /<재>/.test(x.program_name) };
  }).filter((x) => x.dur > 0 && x.dur < 600);
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
    return { d: x.broadcast_date, dow: isoDow(x.broadcast_date), band: bandOf(sm), dur: em - sm, r: Number(x.rating), pn: "", key: "", rerun: false };
  }).filter((x) => x.dur > 0 && x.dur < 600);
}
// IPTV 방영 행
async function loadIptv(name: string, tk: TK): Promise<Row[]> {
  const xs = await pages<any>(() => sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,program_key,program_name,is_rerun_tag,rating,duration_min,dow,slot_band")
    .eq("channel_name", name).eq("target_kind", tk).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_minute").order("program_key"));
  return xs.filter((x) => x.rating != null && Number(x.duration_min) > 0).map((x) => ({ d: x.broadcast_date, dow: x.dow, band: x.slot_band, dur: Number(x.duration_min), r: Number(x.rating), pn: clean(x.program_name), key: norm(x.program_name), rerun: !!x.is_rerun_tag }));
}

// ── 적재 ────────────────────────────────────────────
const { data: mapRows } = await sb.from("iptv_channel_map").select("iptv_channel_name");
const IPTV_ALL = (mapRows ?? []).map((x) => x.iptv_channel_name as string);
const iptv = new Map<string, Row[]>();   // `${채널}|${tk}`
const jobsI = IPTV_ALL.flatMap((ch) => (["p2049", "household"] as TK[]).map((tk) => [ch, tk] as const));
let done = 0;
await pool(jobsI, 8, async ([ch, tk]) => { const rows = await loadIptv(ch, tk); if (rows.length) iptv.set(`${ch}|${tk}`, rows); if (++done % 10 === 0) console.log(`IPTV ${done}/${jobsI.length}`); });
const nComp = new Map<string, Row[]>();
const jobsN = GROUPS.flatMap((g) => g.channels.filter((x) => x.comp).flatMap((x) => (["p2049", "household"] as TK[]).map((tk) => [x.comp!, tk] as const)));
done = 0;
await pool(jobsN, 8, async ([nm, tk]) => { const rows = await loadComp(nm, tk); if (rows.length) nComp.set(`${nm}|${tk}`, rows); if (++done % 10 === 0) console.log(`닐슨 ${done}/${jobsN.length}`); });
const nOwn = new Map<string, Row[]>();
for (const g of GROUPS) if (g.ownRef.code !== "SKYUHD") nOwn.set(g.ownRef.code, await loadOwnNielsen(g.ownRef.code, g.tk));

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
function topCellProg(xs: Row[]) { const by = new Map<string, Row[]>(); xs.forEach((a) => (by.get(a.key) ?? by.set(a.key, []).get(a.key)!).push(a)); const t = [...by.values()].sort((p, q) => vol(q) - vol(p))[0]; return t ? t[0].pn : null; }

// ── 채널별 ─────────────────────────────────────────
const out: Record<string, unknown>[] = [];
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
    const tk = g.tk, other: TK = tk === "p2049" ? "household" : "p2049";
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
    const iy = Object.fromEntries((["p2049", "household"] as TK[]).map((t) => { const i = ch.iptv ? IY[t].findIndex((x) => x.ch === ch.iptv) : -1; return [t, i >= 0 ? { rating: r4(IY[t][i].v, 4), rank: i + 1, of: IY[t].length, from: IY[t][i].from, to: IY[t][i].to } : null]; }));
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
    const top = progs.slice(0, 12);
    const top5Vol = r4([...byP.values()].map(vol).sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0) / totVol, 3);
    const volLeader = [...byP.values()].sort((a, b) => vol(b) - vol(a))[0];

    // Ⅲ. 히트맵(기준 자료 + 다른 자료)
    const heat: Record<string, unknown>[] = [];
    const hP = cells(P);
    // 칸 대표 프로그램 = 그 칸 시청 규모(시청률×방영 분) 1위(2026-11-11 사용자 "히트맵 시청률 아랫줄에 대표 프로그램")
    const progGrid = Object.fromEntries(BANDS.map((b) => [b, DOWN.map((_, d) => (hP.grid[b][d] == null ? null : topCellProg(hP.rows.get(`${d}|${b}`) ?? [])))]));
    heat.push({ label: srcLabel(primary, pTk), grid: hP.grid, prog: progGrid });
    const alt = primary === "nielsen" ? (iRows.length ? { rows: iRows, label: srcLabel("iptv", iTk!) } : null) : (nRows.length ? { rows: nRows, label: srcLabel("nielsen", tk) + `(${nRows[0].d.slice(5).replace("-", "/")}~)` } : null);
    if (alt) heat.push({ label: alt.label, grid: cells(alt.rows).grid });

    // Ⅳ. 인사이트 재료(기준 자료)
    const cellList = BANDS.flatMap((b) => DOWN.map((_, d) => ({ d, b, v: hP.grid[b][d], xs: hP.rows.get(`${d}|${b}`) ?? [] }))).filter((x) => x.v != null);
    const peaks = [...cellList].sort((p, q) => q.v! - p.v!).slice(0, 3).map((x) => ({ dow: DOWN[x.d], band: BAND_TXT(x.b), v: x.v, prog: topCellProg(x.xs) }));
    const bandVol = BANDS.map((b) => ({ b: BAND_TXT(b), share: r4(vol(P.filter((a) => a.band === b)) / totVol, 3), avg: r4(wmean(P.filter((a) => a.band === b)), 4) })).sort((p, q) => (q.share ?? 0) - (p.share ?? 0));
    const wk = (f: (a: Row) => boolean) => wmean(P.filter((a) => (a.band === "20-23" || a.band === "17-20") && f(a)));
    const weekdayPrime = wk((a) => a.dow < 5), weekendPrime = wk((a) => a.dow >= 5);
    const airMin = P.reduce((s, a) => s + a.dur, 0);
    const rerunShare = r4(P.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / airMin, 3);
    const firstAvg = r4(wmean(P.filter((a) => !a.rerun)), 4), rerunAvg = r4(wmean(P.filter((a) => a.rerun)), 4);
    const titles = byP.size;
    // IPTV 상·하반기(가구) — 닐슨 2026-08 모집단 가중치 변경 때문에 기간 비교는 IPTV로만
    const ih = ch.iptv ? iptv.get(`${ch.iptv}|household`) : null;
    const trend = ih ? { h1: r4(wmean(ih.filter((x) => x.d < "2026-07-01")), 4), h2: r4(wmean(ih.filter((x) => x.d >= "2026-07-01")), 4), pct: r4((half(ih) ?? 0) * 100, 1), grp: r4((grpTrend ?? 0) * 100, 1) } : null;
    // 자사 기준 채널과 칸 비교(같은 자료·같은 타깃)
    const ownRows = primary === "nielsen" ? nOwn.get(g.ownRef.code) ?? [] : iptv.get(`${g.ownRef.iptv}|${pTk}`) ?? [];
    let ownCmp: Record<string, unknown> | null = null;
    if (ownRows.length) {
      const og = cells(ownRows).grid;
      const pairs = BANDS.flatMap((b) => DOWN.map((dn, d) => ({ dow: dn, band: BAND_TXT(b), c: hP.grid[b][d], o: og[b][d] }))).filter((x) => x.c != null && x.o != null);
      const ahead = pairs.filter((x) => x.o! > x.c!);
      ownCmp = {
        own: g.ownRef.name, cells: pairs.length, ownAhead: ahead.length,
        biggestGap: [...pairs].sort((p, q) => (q.c! - q.o!) - (p.c! - p.o!)).slice(0, 2).map((x) => ({ ...x, c: r4(x.c, 4), o: r4(x.o, 4) })),
        ownBest: [...ahead].sort((p, q) => (q.o! - q.c!) - (p.o! - p.c!)).slice(0, 2).map((x) => ({ ...x, c: r4(x.c, 4), o: r4(x.o, 4) })),
        avgC: r4(wmean(P), 4), avgO: r4(wmean(ownRows), 4),
      };
    }
    out.push({
      group: g.key, groupFile: g.file, groupLabel: g.label, focus: tk, channel: ch.name, snapName: ch.snap,
      primary, primaryLabel: srcLabel(primary, pTk), nielsenPeriod: nRows.length ? [nRows[0].d, nRows[nRows.length - 1].d] : null, iptvTarget: iTk,
      ytd, iptvYtd: iy, genre, skew, skewMed: r4(skewMed, 3),
      top, progCount: titles, top5Vol, volLeader: volLeader ? { name: volLeader[0].pn, share: r4(vol(volLeader) / totVol, 3) } : null,
      heat, peaks, bandVol: bandVol.slice(0, 3), weekdayPrime: r4(weekdayPrime, 4), weekendPrime: r4(weekendPrime, 4),
      rerunShare, firstAvg, rerunAvg, trend, ownCmp,
    });
    console.log(`${g.file} ${ch.name}: 기준 ${primary}(${P.length}) 닐슨누적 ${ytd[tk]?.rank ?? "-"} IPTV ${iy[tk]?.rank ?? iy.household?.rank ?? "-"}`);
  }
}
fs.writeFileSync("docs/iptv/competitor_channel_profiles.json", JSON.stringify({ 기간: [FROM, TO], 닐슨누적기준일: SNAP_TO, iptvChannels: { p2049: IY.p2049.length, household: IY.household.length }, channels: out }, null, 1));
console.log("저장 docs/iptv/competitor_channel_profiles.json", out.length);
