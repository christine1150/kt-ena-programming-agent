// skyUHD·UHD 경쟁 채널 편성 보고서용 계산(사용자 지시 2026-11-11). 모든 수치는 이 스크립트가 계산하고(원칙 1) 보고서는 옮겨 적는다.
// 기준: IPTV 셋톱(TV INDEX) 가구, 닐슨은 skyUHD 수기 파일(ratings)·경쟁채널 짝(iptv_nielsen_match)으로 교차 확인. 두 값은 섞지 않는다.
//  A. 채널별 사실: 연·월 평균, 연간·월간·주간·일간 히트 작품, 장르·시간대 편성 추이, 요일×시간대 시청률
//  B. 닐슨 vs IPTV: 월별 비교, 닐슨 0 비율, 검출 한계, 닐슨에 안 잡히는데 IPTV 에서 강한 작품(숨은 타이틀)
//  C. skyUHD 요일×시간대 편성 지도(칸 시청률·잘 되는 장르·작품·경쟁 1위)
//  D. 과제: 지구마불 세계여행 4 / 리틀 빅 씬 신규 50편 / 크래시2 / 영미드 23편(미드 채널 벤치마크)
// 실행: node --env-file=.env --import tsx scripts/iptv-research/skyuhd-programming-report.mts → docs/iptv/skyuhd_programming_report.json(+xlsx)
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FROM = "2024-08-01", TO = "2026-11-10", RECENT = "2025-08-01"; // 편성 지도·작품 지수는 최근 15개월
const UHD = ["skyUHD", "UXN", "Asia UHD", "UMAX", "UHD Dream", "SBS NEX"];
const MID = ["채널나우", "NXT", "SCREEN", "cineF", "OCN", "OCN Movies"];
const OWN_OTHER = ["ENA", "ENA Play", "ENA Drama", "ENA Story", "ONCE", "OLIFE"];
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];
const CRIME_US = /NCIS|FBI|CSI|크리미널\s*마인드|S\.W\.A\.T|닥터\s*라슨|Law\s*&\s*Order|로\s*앤\s*오더|시카고|블루\s*블러드|루키|트래커|엘스베스|하이 포텐셜|매트록|더 레지던트|굿 닥터|뉴 암스테르담|매그넘|본즈|멘탈리스트|캐슬|엘리멘트리|하와이 파이브|블라인드스팟/i;

type A = { ch: string; d: string; s: number; e: number; pn: string; pk: string; rerun: boolean; r: number; reach: number | null; amv: number | null; rr: number | null; dur: number; dow: number; band: string; n?: number };
const clean = (s: string) => s.replace(/\s*<[^>]+>/g, "").trim();
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const wmean = (xs: A[], v: (a: A) => number = (a) => a.r) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + v(a) * a.dur, 0) / w : null; };
const r4 = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const bandOf = (m: number) => (m >= 1380 || m < 120 ? "23-02" : m < 300 ? "02-05" : m < 480 ? "05-08" : m < 660 ? "08-11" : m < 840 ? "11-14" : m < 1020 ? "14-17" : m < 1200 ? "17-20" : "20-23");

async function load(ch: string, ilike?: string): Promise<A[]> {
  const out: A[] = [];
  for (let f = 0; ; f += 1000) {
    let q = sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,end_minute,program_name,program_key,is_rerun_tag,rating,reach_viewers,avg_minute_viewers,reach_rate,duration_min,dow,slot_band")
      .eq("channel_name", ch).eq("target_kind", "household").gte("broadcast_date", FROM).lte("broadcast_date", TO);
    if (ilike) q = q.ilike("program_name", ilike);
    const { data, error } = await q.order("broadcast_date").order("start_minute").order("program_key").range(f, f + 999);
    if (error) throw new Error(`${ch}: ${error.message}`);
    for (const x of data ?? []) if (x.rating != null && Number(x.duration_min) > 0)
      out.push({ ch, d: x.broadcast_date, s: x.start_minute, e: x.end_minute, pn: clean(x.program_name), pk: x.program_key, rerun: x.is_rerun_tag, r: Number(x.rating), reach: x.reach_viewers == null ? null : Number(x.reach_viewers), amv: x.avg_minute_viewers == null ? null : Number(x.avg_minute_viewers), rr: x.reach_rate == null ? null : Number(x.reach_rate), dur: Number(x.duration_min), dow: x.dow, band: x.slot_band });
    if (!data || data.length < 1000) break;
  }
  return out;
}
const data = new Map<string, A[]>();
for (const group of [UHD, MID]) await Promise.all(group.map(async (c) => data.set(c, await load(c))));
console.log("읽기:", [...data].map(([c, v]) => `${c} ${v.length}`).join(" · "));

// skyUHD 닐슨(수기) 짝짓기: 방송일 + 시작 ±3분
{
  const { data: ch } = await sb.from("channels").select("id").eq("code", "SKYUHD").single();
  const nl = new Map<string, { s: number; r: number }[]>();
  for (let f = 0; ; f += 1000) {
    const { data: rows, error } = await sb.from("ratings").select("broadcast_date,start_time,rating").eq("channel_id", ch!.id).eq("source_type", "skyuhd").gte("broadcast_date", "2026-01-01").order("broadcast_date").order("start_time").order("id").range(f, f + 999);
    if (error) throw error;
    for (const x of rows ?? []) { if (x.rating == null || !x.start_time) continue; const [h, m] = String(x.start_time).split(":").map(Number); (nl.get(x.broadcast_date) ?? nl.set(x.broadcast_date, []).get(x.broadcast_date)!).push({ s: (h < 2 ? h + 24 : h) * 60 + m, r: Number(x.rating) }); }
    if (!rows || rows.length < 1000) break;
  }
  for (const a of data.get("skyUHD")!) { const c = (nl.get(a.d) ?? []).filter((x) => Math.abs(x.s - a.s) <= 3).sort((p, q) => Math.abs(p.s - a.s) - Math.abs(q.s - a.s))[0]; if (c) a.n = c.r; }
}

// 장르(iptv_program_genre, 추정 포함)
const genre = new Map<string, string>();
{
  const keys = [...new Set(UHD.flatMap((c) => data.get(c)!.map((a) => a.pk)))];
  for (let i = 0; i < keys.length; i += 80) {
    const { data: g } = await sb.from("iptv_program_genre").select("program_key,genre").in("program_key", keys.slice(i, i + 80));
    for (const x of g ?? []) genre.set(x.program_key, x.genre);
  }
}
const gOf = (a: A) => genre.get(a.pk) ?? "미분류";

// 칸 평균(채널·요일·시간대, 기간 한정) → 칸 대비 지수
function cellMeans(rows: A[], v: (a: A) => number | undefined = (a) => a.r) {
  const m = new Map<string, A[]>();
  for (const a of rows) if (v(a) != null) (m.get(`${a.dow}|${a.band}`) ?? m.set(`${a.dow}|${a.band}`, []).get(`${a.dow}|${a.band}`)!).push(a);
  return new Map([...m].map(([k, xs]) => [k, wmean(xs, (a) => v(a)!)!]));
}
const recent = (c: string) => data.get(c)!.filter((a) => a.d >= RECENT);
const cmI = new Map(UHD.concat(MID).map((c) => [c, cellMeans(recent(c))]));
const idxI = (a: A) => { const c = cmI.get(a.ch)!.get(`${a.dow}|${a.band}`); return c && c > 0 ? a.r / c : null; };
const skyN = data.get("skyUHD")!.filter((a) => a.n != null);
const cmN = cellMeans(skyN, (a) => a.n);
const idxN = (a: A) => { const c = cmN.get(`${a.dow}|${a.band}`); return a.n != null && c && c > 0 ? a.n / c : null; };

// ── A. 채널별 사실 ─────────────────────────────────────────
const yearly: Record<string, unknown>[] = [], monthly: Record<string, unknown>[] = [], topYear: Record<string, unknown>[] = [];
const topMonth: Record<string, unknown>[] = [], weeklyTop: Record<string, unknown>[] = [], dailyTop: Record<string, unknown>[] = [];
const genreMix: Record<string, unknown>[] = [], dowBand: Record<string, unknown>[] = [];
const isoWeek = (d: string) => { const t = new Date(d + "T00:00:00Z"); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day); return t.toISOString().slice(0, 10); };
for (const c of UHD) {
  const rows = data.get(c)!;
  for (const [y, a, b] of [["2024(8~12월)", "2024-08-01", "2024-12-31"], ["2025", "2025-01-01", "2025-12-31"], ["2026(~11/10)", "2026-01-01", TO]] as const) {
    const xs = rows.filter((x) => x.d >= a && x.d <= b);
    yearly.push({ 채널: c, 연도: y, 평균시청률: r4(wmean(xs), 5), 방영수: xs.length, 작품수: new Set(xs.map((x) => x.pk)).size, 재방표기_비중: r4(xs.filter((x) => x.rerun).reduce((s, x) => s + x.dur, 0) / xs.reduce((s, x) => s + x.dur, 0), 2) });
  }
  const months = [...new Set(rows.map((x) => x.d.slice(0, 7)))].sort();
  for (const m of months) { const xs = rows.filter((x) => x.d.startsWith(m)); monthly.push({ 채널: c, 월: m, 평균시청률: r4(wmean(xs), 5) }); }
  // 연간 히트: 시청 규모(시청률×분) 상위 + 평균 시청률·칸 대비
  for (const [y, a, b] of [["2025", "2025-01-01", "2025-12-31"], ["2026", "2026-01-01", TO]] as const) {
    const xs = rows.filter((x) => x.d >= a && x.d <= b);
    const tot = xs.reduce((s, x) => s + x.r * x.dur, 0);
    const by = new Map<string, A[]>(); for (const x of xs) (by.get(x.pk) ?? by.set(x.pk, []).get(x.pk)!).push(x);
    [...by.values()].sort((p, q) => q.reduce((s, x) => s + x.r * x.dur, 0) - p.reduce((s, x) => s + x.r * x.dur, 0)).slice(0, 8).forEach((as, i) => {
      const bands = new Map<string, number>(); as.forEach((x) => bands.set(`${DOW[x.dow]} ${x.band}`, (bands.get(`${DOW[x.dow]} ${x.band}`) ?? 0) + 1));
      topYear.push({ 채널: c, 연도: y, 순위: i + 1, 작품: as[0].pn, 장르: gOf(as[0]), 시청몫: r4(as.reduce((s, x) => s + x.r * x.dur, 0) / tot, 3), 방영수: as.length, 평균시청률: r4(wmean(as), 5), 칸대비: r4(mean(as.map(idxI).filter((v): v is number => v != null)), 2), 주력칸: [...bands].sort((p, q) => q[1] - p[1]).slice(0, 2).map(([k, n]) => `${k}(${n})`).join(", ") });
    });
  }
  // 월간 1위(시청 규모) 2025-08~
  for (const m of months.filter((m) => m >= "2025-08")) {
    const xs = rows.filter((x) => x.d.startsWith(m));
    const by = new Map<string, number>(); xs.forEach((x) => by.set(x.pn, (by.get(x.pn) ?? 0) + x.r * x.dur));
    const tot = [...by.values()].reduce((a, b) => a + b, 0);
    const top = [...by].sort((p, q) => q[1] - p[1]).slice(0, 3);
    topMonth.push({ 채널: c, 월: m, "1위": top[0]?.[0], "1위몫": r4((top[0]?.[1] ?? 0) / tot, 2), "2위": top[1]?.[0], "3위": top[2]?.[0] });
  }
  // 주간 1위(그 주 3회 이상 방영 작품 중 평균 시청률 1위) 2026 · 일간 1위(그날 20분 이상 방영 중 최고 시청률)
  const r26 = rows.filter((x) => x.d >= "2026-01-01");
  const wk = new Map<string, A[]>(); r26.forEach((x) => (wk.get(isoWeek(x.d)) ?? wk.set(isoWeek(x.d), []).get(isoWeek(x.d))!).push(x));
  const wCount = new Map<string, number>();
  for (const xs of wk.values()) { const by = new Map<string, A[]>(); xs.forEach((x) => (by.get(x.pn) ?? by.set(x.pn, []).get(x.pn)!).push(x)); const best = [...by].filter(([, v]) => v.length >= 3).sort((p, q) => wmean(q[1])! - wmean(p[1])!)[0]; if (best) wCount.set(best[0], (wCount.get(best[0]) ?? 0) + 1); }
  [...wCount].sort((p, q) => q[1] - p[1]).slice(0, 5).forEach(([t, n], i) => weeklyTop.push({ 채널: c, 순위: i + 1, 작품: t, 주간1위_주수: n, 전체주수: wk.size }));
  const dy = new Map<string, A[]>(); r26.filter((x) => x.dur >= 20).forEach((x) => (dy.get(x.d) ?? dy.set(x.d, []).get(x.d)!).push(x));
  const dCount = new Map<string, number>(); const dSlot = new Map<string, Map<string, number>>();
  for (const xs of dy.values()) { const best = xs.sort((p, q) => q.r - p.r)[0]; dCount.set(best.pn, (dCount.get(best.pn) ?? 0) + 1); const sm = dSlot.get(best.pn) ?? new Map(); sm.set(best.band, (sm.get(best.band) ?? 0) + 1); dSlot.set(best.pn, sm); }
  [...dCount].sort((p, q) => q[1] - p[1]).slice(0, 5).forEach(([t, n], i) => dailyTop.push({ 채널: c, 순위: i + 1, 작품: t, 일간1위_일수: n, 전체일수: dy.size, 주로_나온_시간대: [...dSlot.get(t)!].sort((p, q) => q[1] - p[1])[0][0] }));
  // 장르 편성 비중(분기, 방영 분 기준)과 장르별 칸 대비
  const q = (d: string) => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  const quarters = [...new Set(rows.filter((x) => x.d >= "2025-01-01").map((x) => q(x.d)))].sort();
  const genres = [...new Set(rows.map(gOf))];
  for (const gn of genres) {
    const row: Record<string, unknown> = { 채널: c, 장르: gn };
    for (const qq of quarters) { const xs = rows.filter((x) => q(x.d) === qq); const tot = xs.reduce((s, x) => s + x.dur, 0); row[qq] = r4(xs.filter((x) => gOf(x) === gn).reduce((s, x) => s + x.dur, 0) / tot, 3); }
    const gx = rows.filter((x) => x.d >= RECENT && gOf(x) === gn);
    row["칸대비_최근15개월"] = r4(mean(gx.map(idxI).filter((v): v is number => v != null)), 2);
    row["방영수_최근15개월"] = gx.length;
    genreMix.push(row);
  }
  // 요일×시간대 시청률(2026)
  const cm = cellMeans(r26);
  for (const b of BANDS) dowBand.push({ 채널: c, 시간대: b, ...Object.fromEntries(DOW.map((d, i) => [d, r4(cm.get(`${i}|${b}`) ?? null, 5)])) });
}

// UHD 칸별 순위(2026): 6개 채널 칸 시청률 비교
const cellRank: Record<string, unknown>[] = [];
{
  const cms = new Map(UHD.map((c) => [c, cellMeans(data.get(c)!.filter((x) => x.d >= "2026-01-01"))]));
  for (const b of BANDS) for (let d = 0; d < 7; d++) {
    const vals = UHD.map((c) => [c, cms.get(c)!.get(`${d}|${b}`) ?? 0] as const).sort((p, q) => q[1] - p[1]);
    cellRank.push({ 요일: DOW[d], 시간대: b, "1위": `${vals[0][0]} ${vals[0][1].toFixed(4)}`, skyUHD순위: vals.findIndex(([c]) => c === "skyUHD") + 1, skyUHD: r4(cms.get("skyUHD")!.get(`${d}|${b}`) ?? null, 5), 군합계: r4(vals.reduce((s, [, v]) => s + v, 0), 4) });
  }
}

// ── B. 닐슨 vs IPTV(skyUHD) ─────────────────────────────────
const nvi: Record<string, unknown>[] = [];
{
  const sky = data.get("skyUHD")!.filter((a) => a.d >= "2026-01-01");
  for (const m of [...new Set(sky.map((a) => a.d.slice(0, 7)))].sort()) {
    const xs = sky.filter((a) => a.d.startsWith(m) && a.n != null);
    nvi.push({ 월: m, 짝: xs.length, IPTV평균: r4(wmean(xs), 5), 닐슨평균: r4(wmean(xs, (a) => a.n!), 5), "닐슨÷IPTV": r4(wmean(xs, (a) => a.n!)! / wmean(xs)!, 2), 닐슨0비율: r4(xs.filter((a) => a.n === 0).length / xs.length, 2), IPTV_1분시청가구_평균: Math.round(mean(xs.filter((a) => a.amv != null).map((a) => a.amv!)) ?? 0) });
  }
}
// 시간대별 닐슨 0 비율·IPTV 1분 시청 가구(skyUHD 2026)
const zeroByBand = BANDS.map((b) => { const xs = skyN.filter((a) => a.band === b && a.d >= "2026-01-01"); return { 시간대: b, 짝: xs.length, 닐슨0비율: r4(xs.filter((a) => a.n === 0).length / xs.length, 2), IPTV_1분시청가구: Math.round(mean(xs.filter((a) => a.amv != null).map((a) => a.amv!)) ?? 0), IPTV_도달가구: Math.round(mean(xs.filter((a) => a.reach != null).map((a) => a.reach!)) ?? 0) }; });
// 숨은 타이틀(skyUHD): 최근 15개월 8회 이상, IPTV 칸 대비 ≥ 1.15 인데 닐슨에서 약하거나 0이 많은 작품
const titleRows: Record<string, unknown>[] = [];
{
  const by = new Map<string, A[]>();
  for (const a of recent("skyUHD")) (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a);
  for (const as of by.values()) {
    if (as.length < 8) continue;
    const ii = mean(as.map(idxI).filter((v): v is number => v != null));
    const withN = as.filter((a) => a.n != null);
    const nn = mean(withN.map(idxN).filter((v): v is number => v != null));
    const bands = new Map<string, number>(); as.forEach((x) => bands.set(x.band, (bands.get(x.band) ?? 0) + 1));
    titleRows.push({ 작품: as[0].pn, 장르: gOf(as[0]), 방영수: as.length, 주력시간대: [...bands].sort((p, q) => q[1] - p[1])[0][0], IPTV칸대비: r4(ii, 2), 닐슨칸대비: r4(nn, 2), 닐슨0비율: withN.length ? r4(withN.filter((a) => a.n === 0).length / withN.length, 2) : null, 평균시청률: r4(wmean(as), 5), 첫방: as[0].d, 끝방: as[as.length - 1].d });
  }
}

// ── C. skyUHD 편성 지도(최근 15개월) ─────────────────────────
const mapRows: Record<string, unknown>[] = [];
{
  const sky = recent("skyUHD");
  const comp = UHD.filter((c) => c !== "skyUHD").flatMap((c) => recent(c));
  for (const b of BANDS) for (let d = 0; d < 7; d++) {
    const cell = sky.filter((a) => a.dow === d && a.band === b);
    const byT = new Map<string, A[]>(); cell.forEach((a) => (byT.get(a.pn) ?? byT.set(a.pn, []).get(a.pn)!).push(a));
    const bestT = [...byT].filter(([, v]) => v.length >= 4).map(([t, v]) => [t, mean(v.map(idxI).filter((x): x is number => x != null))!, v.length] as const).sort((p, q) => q[1] - p[1])[0];
    // 같은 시간대(요일 무관) 장르별 칸 대비, 15회 이상
    const bandRows = sky.filter((a) => a.band === b && (d < 5 ? a.dow < 5 : a.dow >= 5));
    const byG = new Map<string, number[]>(); bandRows.forEach((a) => { const v = idxI(a); if (v != null) (byG.get(gOf(a)) ?? byG.set(gOf(a), []).get(gOf(a))!).push(v); });
    const bestG = [...byG].filter(([g, v]) => v.length >= 15 && g !== "미분류").map(([g, v]) => [g, mean(v)!] as const).sort((p, q) => q[1] - p[1])[0];
    const cc = comp.filter((a) => a.dow === d && a.band === b);
    const byC = new Map<string, A[]>(); cc.forEach((a) => (byC.get(`${a.ch}|${a.pn}`) ?? byC.set(`${a.ch}|${a.pn}`, []).get(`${a.ch}|${a.pn}`)!).push(a));
    const bestC = [...byC].filter(([, v]) => v.length >= 4).map(([k, v]) => [k, wmean(v)!] as const).sort((p, q) => q[1] - p[1])[0];
    mapRows.push({ 요일: DOW[d], 시간대: b, skyUHD칸시청률: r4(cmI.get("skyUHD")!.get(`${d}|${b}`) ?? null, 5), 잘된작품: bestT ? `${bestT[0]} ${bestT[1].toFixed(2)}(${bestT[2]})` : "", 잘된장르: bestG ? `${bestG[0]} ${bestG[1].toFixed(2)}` : "", 경쟁1위: bestC ? `${bestC[0].replace("|", " ")} ${bestC[1].toFixed(4)}` : "" });
  }
}

// ── D. 과제 ────────────────────────────────────────────────
// 슬롯 지수(각 채널 칸 평균 대비)용 칸 평균: 자사 다른 채널도 읽어 온다(해당 작품만이 아니라 채널 전체가 필요)
const ownCache = new Map<string, Map<string, number>>();
async function ownCell(c: string) { if (!ownCache.has(c)) ownCache.set(c, cellMeans((await load(c)).filter((a) => a.d >= RECENT))); return ownCache.get(c)!; }
async function titleAcross(pattern: string, chans: string[]) {
  const out: (A & { idx: number | null })[] = [];
  for (const c of chans) {
    const rows = UHD.includes(c) || MID.includes(c) ? data.get(c)!.filter((a) => new RegExp(pattern.replace(/%/g, ".*")).test(a.pn)) : await load(c, pattern);
    if (!rows.length) continue;
    const cm = UHD.includes(c) || MID.includes(c) ? cmI.get(c)! : await ownCell(c);
    // 기간 전체를 쓰되 칸 평균은 최근 15개월 기준(편성 환경 기준값)
    for (const a of rows) { const m = cm.get(`${a.dow}|${a.band}`); out.push({ ...a, idx: m && m > 0 ? a.r / m : null }); }
  }
  return out;
}
const summarize = (xs: (A & { idx: number | null })[], key: (a: A) => string, minN = 3) => {
  const m = new Map<string, (A & { idx: number | null })[]>(); xs.forEach((a) => (m.get(key(a)) ?? m.set(key(a), []).get(key(a))!).push(a));
  return [...m].filter(([, v]) => v.length >= minN).map(([k, v]) => ({ 구분: k, 방영수: v.length, 칸대비: r4(mean(v.map((a) => a.idx).filter((x): x is number => x != null)), 2), 평균시청률: r4(wmean(v), 4), 본방비중: r4(v.filter((a) => !a.rerun).length / v.length, 2) })).sort((p, q) => (q.칸대비 ?? 0) - (p.칸대비 ?? 0));
};

// D1 지구마불
const jgmb = await titleAcross("%지구마불%", [...OWN_OTHER, ...UHD, ...MID]);
const jgmbByCh = summarize(jgmb, (a) => `${a.ch} · ${a.pn}`, 5);
const jgmbByBand = summarize(jgmb, (a) => a.band, 10);
const jgmbByDowBand = summarize(jgmb.filter((a) => a.band === "17-20" || a.band === "20-23" || a.band === "23-02"), (a) => `${DOW[a.dow]} ${a.band}`, 6);
const jgmbFirstVsRe = summarize(jgmb, (a) => (a.rerun ? "재방 표기" : "본방 표기"), 10);
// skyUHD 본방 + 24시간 안 재방 2회 조합: 기대 = skyUHD 칸 시청률 × 지구마불 시간대 지수(재방은 ×0.94, skyUHD 1일 이내 재방 계수)
const bandIdx = new Map(jgmbByBand.map((x) => [x.구분, x.칸대비 ?? 1]));
const skyCm = cmI.get("skyUHD")!;
const bandStart: Record<string, number> = { "05-08": 300, "08-11": 480, "11-14": 660, "14-17": 840, "17-20": 1020, "20-23": 1200, "23-02": 1380, "02-05": 1560 };
const combos: Record<string, unknown>[] = [];
for (let d = 0; d < 7; d++) for (const pb of ["17-20", "20-23"]) {
  const t0 = d * 1440 + bandStart[pb];
  const cands: { k: string; v: number }[] = [];
  for (let dd = 0; dd < 7; dd++) for (const b of BANDS) {
    let t = dd * 1440 + bandStart[b]; if (t <= t0) t += 7 * 1440;
    if (t - t0 < 180 || t - t0 > 1440) continue; // 본방 3시간 뒤~24시간 안
    cands.push({ k: `${DOW[dd]} ${b}`, v: (skyCm.get(`${dd}|${b}`) ?? 0) * (bandIdx.get(b) ?? 1) * 0.94 });
  }
  const top2 = cands.sort((p, q) => q.v - p.v).slice(0, 2);
  const main = (skyCm.get(`${d}|${pb}`) ?? 0) * (bandIdx.get(pb) ?? 1);
  const comp = cellRank.find((x) => x.요일 === DOW[d] && x.시간대 === pb);
  combos.push({ 본방: `${DOW[d]} ${pb}`, 본방기대: r4(main, 5), 재방1: top2[0]?.k, 재방2: top2[1]?.k, "3회합계": r4(main + top2.reduce((s, x) => s + x.v, 0), 5), 본방칸_경쟁1위: comp?.["1위"] });
}
combos.sort((p, q) => (q["3회합계"] as number) - (p["3회합계"] as number));

// D2 리틀 빅 씬
const lbs = data.get("skyUHD")!.filter((a) => /리틀\s*빅\s*씬/.test(a.pn));
const lbsDur = mean(lbs.map((a) => a.dur));
const lbsBand = BANDS.map((b) => {
  const xs = lbs.filter((a) => a.band === b);
  const ii = mean(xs.map(idxI).filter((v): v is number => v != null)), nn = mean(xs.map(idxN).filter((v): v is number => v != null));
  const cell = mean([0, 1, 2, 3, 4, 5, 6].map((d) => skyCm.get(`${d}|${b}`) ?? 0));
  const ownIdx = ii ?? 0.6; // 해당 시간대 방영 이력이 없으면 리틀 빅 씬 평균 칸 대비로 가정
  return { 시간대: b, 방영수: xs.length, IPTV칸대비: r4(ii, 2), 닐슨칸대비: r4(nn, 2), skyUHD칸시청률: r4(cell, 5), 기대시청률: r4(cell! * ownIdx, 5), 밀어내는손실: r4(cell! * (1 - ownIdx), 5) };
});
const lbsAll = { 방영수: lbs.length, 평균길이분: r4(lbsDur, 0), IPTV칸대비: r4(mean(lbs.map(idxI).filter((v): v is number => v != null)), 2), 닐슨칸대비: r4(mean(lbs.map(idxN).filter((v): v is number => v != null)), 2), 첫방: lbs[0]?.d, 끝방: lbs[lbs.length - 1]?.d, 본방비중: r4(lbs.filter((a) => !a.rerun).length / lbs.length, 2) };
const lbsDow = DOW.map((dn, d) => { const xs = lbs.filter((a) => a.dow === d); return { 요일: dn, 방영수: xs.length, IPTV칸대비: r4(mean(xs.map(idxI).filter((v): v is number => v != null)), 2) }; });

// D3 크래시
const crash = await titleAcross("%크래시%", [...OWN_OTHER, "skyUHD"]);
const crashByCh = summarize(crash, (a) => a.ch, 5);
const crashSkyBand = summarize(crash.filter((a) => a.ch === "skyUHD"), (a) => a.band, 5);
const crashSkyDowBand = summarize(crash.filter((a) => a.ch === "skyUHD"), (a) => `${DOW[a.dow]} ${a.band}`, 5);
const crashSkyN = (() => { const xs = data.get("skyUHD")!.filter((a) => /크래시/.test(a.pn)); const byB = new Map<string, number[]>(); xs.forEach((a) => { const v = idxN(a); if (v != null) (byB.get(a.band) ?? byB.set(a.band, []).get(a.band)!).push(v); }); return [...byB].map(([b, v]) => ({ 시간대: b, 닐슨칸대비: r4(mean(v), 2), 짝: v.length })); })();
const crashMonthly = (() => { const xs = data.get("skyUHD")!.filter((a) => /크래시/.test(a.pn)); const m = new Map<string, A[]>(); xs.forEach((a) => (m.get(a.d.slice(0, 7)) ?? m.set(a.d.slice(0, 7), []).get(a.d.slice(0, 7))!).push(a)); return [...m].map(([k, v]) => ({ 월: k, 방영수: v.length, 칸대비: r4(mean(v.map(idxI).filter((x): x is number => x != null)), 2) })); })();

// D4 영미드 23편: skyUHD·자사 방영 실적 + 미드 채널 벤치마크
const US23 = ["행동과학자", "페이퍼 시즌", "아마데우스", "골든 아워 시즌", "스위트피", "로앤오더|로 앤 오더", "대멸종 : 최후", "갱스 오브 런던", "더 캡처", "헌팅 파티", "솔트 마쉬", "엘리전스", "슈츠", "아토믹", "유령마을", "그로스포인트", "라브레아", "올 허 폴트"];
const us23Rows: Record<string, unknown>[] = [];
for (const c of [...OWN_OTHER, "skyUHD"]) {
  const rows = c === "skyUHD" ? data.get(c)! : await load(c);
  const cm = c === "skyUHD" ? skyCm : await ownCell(c);
  for (const pat of US23) {
    const xs = rows.filter((a) => new RegExp(pat).test(a.pn) && a.d >= "2025-01-01");
    if (!xs.length) continue;
    const ix = xs.map((a) => { const m = cm.get(`${a.dow}|${a.band}`); return m && m > 0 ? a.r / m : null; }).filter((v): v is number => v != null);
    const bands = new Map<string, number>(); xs.forEach((a) => bands.set(`${DOW[a.dow]} ${a.band}`, (bands.get(`${DOW[a.dow]} ${a.band}`) ?? 0) + 1));
    us23Rows.push({ 채널: c, 작품: xs[0].pn, 방영수: xs.length, 기간: `${xs[0].d}~${xs[xs.length - 1].d}`, 칸대비: r4(mean(ix), 2), 닐슨칸대비: c === "skyUHD" ? r4(mean(xs.map(idxN).filter((v): v is number => v != null)), 2) : null, 주력칸: [...bands].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, n]) => `${k}(${n})`).join(", ") });
  }
}
// skyUHD 외화 드라마 전체(장르 표 기준) 시간대별 성적
const skyForeign = summarize(recent("skyUHD").filter((a) => /외화|해외|미드|영드/.test(gOf(a))).map((a) => ({ ...a, idx: idxI(a) })), (a) => a.band, 10);
const skyGenreBand: Record<string, unknown>[] = [];
{ const xs = recent("skyUHD"); const gs = [...new Set(xs.map(gOf))]; for (const g of gs) for (const b of BANDS) { const v = xs.filter((a) => gOf(a) === g && a.band === b); if (v.length < 15) continue; skyGenreBand.push({ 장르: g, 시간대: b, 방영수: v.length, 칸대비: r4(mean(v.map(idxI).filter((x): x is number => x != null)), 2) }); } }
// 미드 채널: 미국 범죄 수사극의 시간대·요일별 성적, 블록 길이, 같은 회차 재방 간격
const midRows: Record<string, unknown>[] = [], midDow: Record<string, unknown>[] = [], midTitles: Record<string, unknown>[] = [];
for (const c of MID) {
  const xs = recent(c);
  const crime = xs.filter((a) => CRIME_US.test(a.pn));
  const tot = xs.reduce((s, a) => s + a.dur, 0);
  for (const b of BANDS) {
    const v = crime.filter((a) => a.band === b), all = xs.filter((a) => a.band === b);
    midRows.push({ 채널: c, 시간대: b, 수사극_방영비중: r4(v.reduce((s, a) => s + a.dur, 0) / all.reduce((s, a) => s + a.dur, 0), 2), 수사극_칸대비: r4(mean(v.map(idxI).filter((x): x is number => x != null)), 2), 수사극_평균시청률: r4(wmean(v), 4), 채널_시간대평균: r4(wmean(all), 4) });
  }
  for (let d = 0; d < 7; d++) { const v = crime.filter((a) => a.dow === d); midDow.push({ 채널: c, 요일: DOW[d], 수사극_칸대비: r4(mean(v.map(idxI).filter((x): x is number => x != null)), 2), 방영수: v.length }); }
  // 블록 길이(같은 날 같은 작품 연속)
  let blocks = 0, inBlock = 0;
  const byDay = new Map<string, A[]>(); crime.forEach((a) => (byDay.get(a.d) ?? byDay.set(a.d, []).get(a.d)!).push(a));
  for (const day of byDay.values()) { day.sort((p, q) => p.s - q.s); let len = 1; for (let i = 1; i <= day.length; i++) { if (i < day.length && day[i].pk === day[i - 1].pk && day[i].s - day[i - 1].e <= 10) len++; else { blocks++; inBlock += len; len = 1; } } }
  const by = new Map<string, A[]>(); crime.forEach((a) => (by.get(a.pn.replace(/\s*시즌\s*\d+.*$/, "")) ?? by.set(a.pn.replace(/\s*시즌\s*\d+.*$/, ""), []).get(a.pn.replace(/\s*시즌\s*\d+.*$/, ""))!).push(a));
  [...by].sort((p, q) => q[1].reduce((s, a) => s + a.r * a.dur, 0) - p[1].reduce((s, a) => s + a.r * a.dur, 0)).slice(0, 5).forEach(([t, v]) => {
    const bands = new Map<string, number>(); v.forEach((a) => bands.set(`${DOW[a.dow]} ${a.band}`, (bands.get(`${DOW[a.dow]} ${a.band}`) ?? 0) + 1));
    midTitles.push({ 채널: c, 시리즈: t, 방영수: v.length, 칸대비: r4(mean(v.map(idxI).filter((x): x is number => x != null)), 2), 주력칸: [...bands].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, n]) => `${k}(${n})`).join(", ") });
  });
  midRows.push({ 채널: c, 시간대: "합계", 수사극_방영비중: r4(crime.reduce((s, a) => s + a.dur, 0) / tot, 2), 수사극_칸대비: r4(mean(crime.map(idxI).filter((x): x is number => x != null)), 2), 수사극_평균시청률: r4(wmean(crime), 4), 채널_시간대평균: r4(wmean(xs), 4), 평균블록길이: r4(inBlock / Math.max(1, blocks), 2) });
}

const out = { yearly, monthly, topYear, topMonth, weeklyTop, dailyTop, genreMix, dowBand, cellRank, nvi, zeroByBand, titleRows, mapRows,
  jgmbByCh, jgmbByBand, jgmbByDowBand, jgmbFirstVsRe, combos, lbsAll, lbsBand, lbsDow, crashByCh, crashSkyBand, crashSkyDowBand, crashSkyN, crashMonthly,
  us23Rows, skyForeign, skyGenreBand, midRows, midDow, midTitles };
fs.writeFileSync("docs/iptv/skyuhd_programming_report.json", JSON.stringify(out, null, 1));
const wb = new ExcelJS.Workbook();
for (const [k, v] of Object.entries(out)) { const rows = Array.isArray(v) ? v : [v]; if (!rows.length) continue; const ws = wb.addWorksheet(k.slice(0, 31)); const cols = Object.keys(rows[0] as object); ws.addRow(cols).font = { bold: true }; for (const r of rows as Record<string, unknown>[]) ws.addRow(cols.map((c) => r[c] as ExcelJS.CellValue)); }
await wb.xlsx.writeFile("docs/iptv/skyuhd_programming_report.xlsx");
console.log("저장 완료");
