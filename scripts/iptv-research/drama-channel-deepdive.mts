// 드라마군 심층(2026-11-12 사용자 요청): MBC ON <전원일기> 집중 편성(이벤트) 분리, 하이라이트TV 지상파 드라마 활용 방식, 작품별 원 방송사·편성 유형.
// IPTV(TV INDEX) 가구 방영 행을 읽어 기간·작품·원 방송사 묶음별로 집계한다(수치 계산은 모두 이 스크립트).
// 원 방송사·첫 방송일은 program_naver_schedule(네이버 조회 저장분), 네이버가 다른 작품을 잡은 경우만 ORIGIN_FIX로 바로잡는다.
// 본방 최고 시청률은 외부 기사·위키 확인값(PEAK, 조사기관·권역이 서로 달라 참고용) — 확인 못 한 작품은 비워 둔다.
// 실행: npx tsx --env-file=.env scripts/iptv-research/drama-channel-deepdive.mts → docs/iptv/drama_channel_deepdive.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normalizeProgramKey } from "../../src/lib/purchaseSim/normalize";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
type Row = { broadcast_date: string; start_minute: number; duration_min: number; program_name: string; program_key: string; is_rerun_tag: boolean | null; rating: number | null };

// 네이버가 다른 작품을 잡았거나 못 찾은 경우의 원 방송사·편성(웹 확인, 2026-11-12)
const ORIGIN_FIX: Record<string, { ch: string; start: string; type: string }> = {
  빛과그림자: { ch: "MBC", start: "2011-11-28", type: "월화" },
  유리의성: { ch: "SBS", start: "2008-09-06", type: "주말" },
  가화만사성: { ch: "MBC", start: "2016-02-20", type: "주말" },
  에덴의동쪽: { ch: "MBC", start: "2008-08-25", type: "월화" },
  모범택시: { ch: "SBS", start: "2021-04-09", type: "금토" },
  낭만닥터김사부: { ch: "SBS", start: "2016-11-07", type: "월화" },
  전원일기: { ch: "MBC", start: "1980-10-21", type: "주간" },
  내일은미스터트롯: { ch: "TV조선", start: "2020-01-02", type: "주간" },
  백년의유산: { ch: "MBC", start: "2013-01-05", type: "주말" },
  파하최불암입니다: { ch: "MBC", start: "2026-05-05", type: "다큐" },
  // D-ONE <허준>은 1999년 MBC판(2026-11-12 사용자 확인, 2013 <구암 허준> 아님)
  허준: { ch: "MBC", start: "1999-11-29", type: "월화" },
};
// 첫 방송 요일·기간으로는 일일극처럼 보이는 장기 월화극
const LONG_MINI: Record<string, string> = { 자이언트: "월화", 동이: "월화", 주몽: "월화", 허준: "월화", 구가의서: "월화" };
// 본방 최고 시청률(외부 확인값, 기관·권역 표기 그대로)
const PEAK: Record<string, string> = {
  인어아가씨: "47.9%(AGB 전국)", 웃어라동해야: "44.8%(TNmS 전국)", 같이살래요: "38.8%(TNmS 전국)", 소문난칠공주: "43.8%(TNS)",
  수상한삼형제: "32.1%(AGB 전국, 최종회)", 왔다장보리: "37.3% 이상(닐슨 전국)", 조강지처클럽: "30% 안팎(기사)", 분홍립스틱: "23.6%(AGB 수도권)",
  있을때잘해: "20.6% 이상", 하얀거짓말: "20% 이상(기사)", 오자룡이간다: "18.3%(TNmS 수도권)", 황금물고기: "16.0%(AGB 수도권)",
  위대한조강지처: "15.5%(TNmS 수도권)", 금나와라뚝딱: "17% 안팎", 낭만닥터김사부: "27%(전국, 기사)", 모범택시2: "21.0%(닐슨 전국)",
};

async function load(channel: string, from = "2025-01-01"): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from("iptv_airing_metrics")
      .select("broadcast_date,start_minute,duration_min,program_name,program_key,is_rerun_tag,rating")
      .eq("channel_name", channel).eq("target_kind", "household")
      .gte("broadcast_date", from).lte("broadcast_date", "2026-11-10")
      .order("broadcast_date").order("start_minute").range(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r4 = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000);
const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
const clean = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[?!~？！～]/g, "").replace(/\s+/g, " ").trim();
const nkey = (s: string) => clean(s).replace(/[^가-힣a-zA-Z0-9]/g, "");
const band2 = (m: number) => { const h = Math.floor(m / 60); const b = h - (h % 2); return `${String(b).padStart(2, "0")}~${String(b + 2).padStart(2, "0")}시`; };
const isJW = (n: string) => /전원일기/.test(n);

// 장르(종합 엑셀 중간 자료) — 드라마 계열만 첫 방송 요일로 편성 유형을 정하고, 교양·예능은 장르명으로 둔다
const GENRE = new Map<string, string>();
for (const c of JSON.parse(fs.readFileSync("docs/iptv/excel/channel_workbook_data.json", "utf8")).channels) for (const p of c.programs) if (!GENRE.has(nkey(p.name))) GENRE.set(nkey(p.name), p.genre);
const isDramaGenre = (g: string | undefined) => !g || /드라마/.test(g);

// 원 방송사·편성 유형
const naver = new Map<string, any>();
async function loadNaver(names: string[]) {
  const keys = [...new Set(names.map((n) => normalizeProgramKey(clean(n))))];
  // 한글 키는 URL이 길어져 한 번에 많이 묻으면 요청이 실패한다 → 40개씩
  for (let i = 0; i < keys.length; i += 40) {
    const { data, error } = await sb.from("program_naver_schedule").select("program_key,status,matched_title,channels,start_date,end_date").in("program_key", keys.slice(i, i + 40));
    if (error) throw new Error(error.message);
    for (const x of data ?? []) naver.set(x.program_key, x);
  }
}
const TERR = /^(KBS1|KBS2|MBC|SBS|EBS|JTBC|MBN|TV조선|TV CHOSUN|채널A|tvN)$/i;
function origin(name: string, genre?: string) {
  const k = nkey(name), fix = ORIGIN_FIX[k];
  const g = genre ?? GENRE.get(k);
  let ch: string | null = null, start: string | null = null, end: string | null = null, type: string | null = null;
  if (fix) ({ ch, start, type } = fix);
  else {
    const n = naver.get(normalizeProgramKey(clean(name)));
    if (n && n.status === "found" && n.start_date) { ch = (n.channels ?? [])[0] ?? null; start = n.start_date; end = n.end_date; }
  }
  if (!ch || !start) return { ch: ch ?? null, year: start ? Number(start.slice(0, 4)) : null, type: type ?? null, peak: PEAK[k] ?? null };
  if (!type && !isDramaGenre(g)) type = g === "다큐·교양" ? "교양" : g === "미분류" ? "기타" : g!;
  if (!type) {
    const dow = new Date(start + "T00:00:00Z").getUTCDay();   // 0=일
    const spanDays = end ? (Date.parse(end) - Date.parse(start)) / 86400000 : null;
    if (LONG_MINI[k]) type = LONG_MINI[k];
    else if (dow === 6 || dow === 0) type = "주말";
    else if (spanDays != null && spanDays >= 120) type = "평일 일일";
    else type = ({ 1: "월화", 2: "월화", 3: "수목", 4: "수목", 5: "금토" } as Record<number, string>)[dow] ?? "미니";
  }
  return { ch, year: Number(start.slice(0, 4)), type, peak: PEAK[k] ?? null, terr: TERR.test(ch) };
}

function progTable(rows: Row[], chAvg: number) {
  const m = new Map<string, { name: string; min: number; n: number; r: number[]; days: Set<string>; bands: Map<string, number>; perDay: Map<string, number> }>();
  for (const x of rows) {
    const k = nkey(x.program_name);
    const p = m.get(k) ?? { name: clean(x.program_name), min: 0, n: 0, r: [] as number[], days: new Set<string>(), bands: new Map<string, number>(), perDay: new Map<string, number>() };
    p.min += Number(x.duration_min) || 0; p.n++; if (x.rating != null) p.r.push(Number(x.rating));
    p.days.add(x.broadcast_date); p.perDay.set(x.broadcast_date, (p.perDay.get(x.broadcast_date) ?? 0) + 1);
    const b = band2(Number(x.start_minute)); p.bands.set(b, (p.bands.get(b) ?? 0) + 1);
    m.set(k, p);
  }
  return [...m.values()].map((p) => ({
    name: p.name, airings: p.n, minutes: p.min, avg: r4(avg(p.r)), idx: r2(avg(p.r) != null ? avg(p.r)! / chAvg : null),
    days: p.days.size, perDay: r2(p.n / p.days.size), topBands: [...p.bands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([b]) => b),
    ...origin(p.name),
  })).sort((a, b) => b.minutes - a.minutes);
}

const out: Record<string, unknown> = {};

// ── MBC ON: 전원일기 이벤트 분리 ────────────────────────────
{
  const rows = await load("MBC ON");
  await loadNaver(rows.map((x) => x.program_name));
  const inP = (d: string, a: string, b: string) => d >= a && d <= b;
  const P = { 평소: ["2026-01-01", "2026-10-11"], 집중편성: ["2026-10-12", "2026-11-01"], 이후: ["2026-11-02", "2026-11-10"] } as const;
  const period = Object.fromEntries(Object.entries(P).map(([k, [a, b]]) => {
    const rs = rows.filter((x) => inP(x.broadcast_date, a, b));
    const mins = rs.reduce((s, x) => s + (Number(x.duration_min) || 0), 0), jw = rs.filter((x) => isJW(x.program_name));
    const jwMin = jw.reduce((s, x) => s + (Number(x.duration_min) || 0), 0);
    const nonJw = rs.filter((x) => !isJW(x.program_name) && x.rating != null);
    return [k, { from: a, to: b, chAvg: r4(avg(rs.filter((x) => x.rating != null).map((x) => Number(x.rating)))), jwShare: r2(jwMin / mins), jwAvg: r4(avg(jw.filter((x) => x.rating != null).map((x) => Number(x.rating)))), nonJwAvg: r4(avg(nonJw.map((x) => Number(x.rating)))) }];
  }));
  // 평소(2026-01-01~10-11) 기준 전원일기 제외 작품 성과 — 채널 평균은 전원일기 제외 평균
  const base = rows.filter((x) => inP(x.broadcast_date, "2026-01-01", "2026-10-11"));
  const baseNon = base.filter((x) => !isJW(x.program_name));
  const nonAvg = avg(baseNon.filter((x) => x.rating != null).map((x) => Number(x.rating)))!;
  const progs = progTable(baseNon, nonAvg).filter((p) => p.airings >= 30);
  // 작품 묶음(원 방송사 × 편성 유형)별 방영 시간 비중·성과
  const grp = new Map<string, { min: number; r: number[]; n: number }>();
  const totalMin = baseNon.reduce((s, x) => s + (Number(x.duration_min) || 0), 0);
  for (const x of baseNon) { const o = origin(x.program_name), g = o.ch && o.type ? `${o.ch} ${o.type}` : "기타·미확인"; const v = grp.get(g) ?? { min: 0, r: [], n: 0 }; v.min += Number(x.duration_min) || 0; v.n++; if (x.rating != null) v.r.push(Number(x.rating)); grp.set(g, v); }
  const groups = [...grp.entries()].map(([g, v]) => ({ g, share: r2(v.min / totalMin), idx: r2(avg(v.r)! / nonAvg), n: v.n })).sort((a, b) => b.share! - a.share!);
  // 전원일기 평소 비중·성과
  const jwBase = base.filter((x) => isJW(x.program_name));
  const baseAll = avg(base.filter((x) => x.rating != null).map((x) => Number(x.rating)))!;
  out["MBC ON"] = { period, nonJwAvg: r4(nonAvg), baseAll: r4(baseAll), jwBaseShare: r2(jwBase.reduce((s, x) => s + x.duration_min, 0) / base.reduce((s, x) => s + x.duration_min, 0)), jwBaseIdx: r2(avg(jwBase.filter((x) => x.rating != null).map((x) => Number(x.rating)))! / baseAll), groups, programs: progs.slice(0, 25) };
  console.log("== MBC ON", JSON.stringify(period));
}

// ── 하이라이트 TV: 지상파 드라마 활용 ─────────────────────────
{
  const rows = await load("하이라이트 TV", "2026-01-01");
  await loadNaver(rows.map((x) => x.program_name));
  const chAvg = avg(rows.filter((x) => x.rating != null).map((x) => Number(x.rating)))!;
  const progs = progTable(rows, chAvg);
  const totalMin = rows.reduce((s, x) => s + (Number(x.duration_min) || 0), 0);
  const by = (keyOf: (p: (typeof progs)[number]) => string) => {
    const m = new Map<string, { min: number; w: number; titles: number }>();
    for (const p of progs) { const k = keyOf(p); const v = m.get(k) ?? { min: 0, w: 0, titles: 0 }; v.min += p.minutes; v.w += (p.idx ?? 0) * p.minutes; v.titles++; m.set(k, v); }
    return [...m.entries()].map(([k, v]) => ({ k, share: r2(v.min / totalMin), idx: r2(v.w / v.min), titles: v.titles })).sort((a, b) => b.share! - a.share!);
  };
  const decade = (y: number | null) => (y == null ? "미확인" : y < 2005 ? "~2004" : y < 2010 ? "2005~09" : y < 2015 ? "2010~14" : y < 2020 ? "2015~19" : "2020~");
  // 하루 몇 회씩 몇 개 시간대에 트는가(작품 단위 평균, 방영 30회 이상)
  const big = progs.filter((p) => p.airings >= 30);
  const concurrent = (() => { const m = new Map<string, Set<string>>(); for (const x of rows) { const s = m.get(x.broadcast_date) ?? new Set(); s.add(nkey(x.program_name)); m.set(x.broadcast_date, s); } return r2(avg([...m.values()].map((s) => s.size))); })();
  out["하이라이트 TV"] = {
    chAvg: r4(chAvg), titles: progs.length, concurrentPerDay: concurrent,
    perDayMedian: big.map((p) => p.perDay!).sort((a, b) => a - b)[Math.floor(big.length / 2)] ?? null,
    byOrigin: by((p) => p.ch ?? "미확인"), byType: by((p) => p.type ?? "미확인"), byDecade: by((p) => decade(p.year)),
    programs: progs.slice(0, 30),
  };
  console.log("== 하이라이트 TV", progs.length, "작품");
}

// ── 작품별 원 방송사·편성(ONCE 참고 작품 표용) ───────────────
{
  const P = JSON.parse(fs.readFileSync("docs/iptv/competitor_channel_profiles.json", "utf8"));
  const names = P.channels.flatMap((c: any) => (c.onceRef?.list ?? []).map((x: any) => x.name as string));
  await loadNaver(names);
  const gOf = new Map<string, string>(P.channels.flatMap((c: any) => (c.onceRef?.list ?? []).map((x: any) => [x.name, x.genre])));
  out.origins = Object.fromEntries(names.map((n: string) => [n, origin(n, gOf.get(n))]));
}
fs.writeFileSync("docs/iptv/drama_channel_deepdive.json", JSON.stringify(out, null, 1));
console.log("저장: docs/iptv/drama_channel_deepdive.json");
