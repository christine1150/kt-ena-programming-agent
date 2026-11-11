// 편성 인사이트 분석(사용자 지시 2026-11-11: "닐슨만으로 알기 어려웠던 편성 패턴·시청률 획득 패턴·경쟁사 편성 노하우").
// IPTV 셋톱 전수(TV INDEX 방영 성과)로 계산하고, 자사 채널은 같은 방영 건의 닐슨 값으로 같은 계산을 한 번 더 해 방향을 확인한다.
// IPTV 는 보조 자료이며 닐슨 값과 섞지 않는다. 모든 수치는 이 스크립트가 계산한다(원칙 1, LLM 암산 없음).
//
//  ① 채널 프로필: 시청률·도달률·몰입도(1분 시청자 ÷ 도달자, 방영 길이 구간별 보정)·재방 비중·작품 집중도·연속 편성 비중
//  ② 획득 유형: 작품별 도달 지수 × 몰입 지수(같은 채널·같은 길이 구간 평균 대비) → 넓게/좁게 × 오래/잠깐
//  ③ 연속 블록 편성: 같은 작품을 이어 붙였을 때 2·3·4번째 회차가 첫 회차 대비 어떻게 되는지(칸 평균으로 시간대 효과 제거)
//  ④ 리드인: 앞 작품이 평소보다 잘 나온 날 뒤 작품도 평소보다 잘 나오는지(같은 작품·요일·시간대 평균 대비 잔차의 상관)
//  ⑤ 재방 시점: 마지막 본방 후 경과일별 재방 성적(칸 평균 대비)
//  ⑥ 경쟁사 히트작 편성 방식: 채널별 시청 규모 상위 작품의 방영 수·본방 비중·사용 칸 수·주력 칸·블록 길이
//  ⑦ 빈 칸: 군 전체 시청 수요가 큰데 자사 몫이 평소보다 작은 칸 / 자사가 평소보다 많이 가져가는 칸
//
// 실행: node --env-file=.env --import tsx scripts/iptv-research/programming-insights.mts
// 출력: docs/iptv/programming_insights.xlsx, docs/iptv/programming_insights.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const HIST_FROM = "2025-07-01"; // 재방 경과일 계산용 본방 이력
const FROM = "2026-01-01";
const TO = "2026-11-10";
const OWN_TARGET: Record<string, string> = { ENA: "p2049", "ENA Drama": "p2049", "ENA Play": "p2049", ONCE: "household", "ENA Story": "household", OLIFE: "household", skyUHD: "household" };
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];

type A = {
  ch: string; tk: string; d: string; s: number; e: number; pn: string; pk: string; rerun: boolean;
  r: number | null; reach: number | null; amv: number | null; rr: number | null; dur: number; dow: number; band: string;
  nr?: number; // 같은 방영 건 닐슨 시청률(자사만)
};

// ── 자료 읽기 ─────────────────────────────────────────────
const { data: groupRows } = await sb.from("iptv_peer_groups").select("group_key, group_label, iptv_channel_name, role");
const groups = new Map<string, { label: string; members: { ch: string; role: string }[] }>();
for (const g of groupRows ?? []) {
  const o = groups.get(g.group_key) ?? { label: g.group_label as string, members: [] as { ch: string; role: string }[] };
  o.members.push({ ch: g.iptv_channel_name, role: g.role });
  groups.set(g.group_key, o);
}
// 인자로 자사 채널을 주면 그 채널이 속한 군만 계산한다(예: skyUHD → UHD 6개). 출력 파일명에도 붙는다.
const ONLY = process.argv[2];
if (ONLY) for (const [k, g] of [...groups]) if (!g.members.some((m) => m.role === "own" && m.ch === ONLY)) groups.delete(k);
const channels = [...new Set([...groups.values()].flatMap((g) => g.members.map((m) => m.ch)))];
const OUT = `docs/iptv/programming_insights${ONLY ? "_" + ONLY.replace(/\s+/g, "_") : ""}`;

async function fetchAll(ch: string, tk: string): Promise<A[]> {
  const out: A[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb
      .from("iptv_airing_metrics")
      .select("broadcast_date,start_minute,end_minute,program_name,program_key,is_rerun_tag,rating,reach_viewers,avg_minute_viewers,reach_rate,duration_min,dow,slot_band")
      .eq("channel_name", ch).eq("target_kind", tk).gte("broadcast_date", HIST_FROM).lte("broadcast_date", TO)
      .order("broadcast_date").order("start_minute").order("program_key")
      .range(f, f + 999);
    if (error) throw new Error(`${ch}/${tk}: ${error.message}`);
    for (const x of data ?? [])
      out.push({
        ch, tk, d: x.broadcast_date, s: x.start_minute, e: x.end_minute, pn: x.program_name, pk: x.program_key, rerun: x.is_rerun_tag,
        r: x.rating == null ? null : Number(x.rating), reach: x.reach_viewers == null ? null : Number(x.reach_viewers),
        amv: x.avg_minute_viewers == null ? null : Number(x.avg_minute_viewers), rr: x.reach_rate == null ? null : Number(x.reach_rate),
        dur: Number(x.duration_min), dow: x.dow, band: x.slot_band,
      });
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function fetchNielsen(ch: string, tk: string) {
  const m = new Map<string, number>();
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("iptv_nielsen_match").select("broadcast_date,start_minute,program_key,nielsen_rating")
      .eq("channel_name", ch).eq("target_kind", tk).gte("broadcast_date", FROM).lte("broadcast_date", TO).not("nielsen_rating", "is", null)
      .order("broadcast_date").order("start_minute").order("program_key").range(f, f + 999);
    if (error) throw new Error(`닐슨 ${ch}: ${error.message}`);
    for (const x of data ?? []) m.set(`${x.broadcast_date}|${x.start_minute}|${x.program_key}`, Number(x.nielsen_rating));
    if (!data || data.length < 1000) break;
  }
  return m;
}

const jobs: [string, string][] = [];
for (const ch of channels) for (const tk of ["household", "p2049"]) jobs.push([ch, tk]);
const data = new Map<string, A[]>(); // ch|tk → 방영(2025-07~)
let done = 0;
for (let i = 0; i < jobs.length; i += 8) {
  await Promise.all(jobs.slice(i, i + 8).map(async ([ch, tk]) => {
    const rows = await fetchAll(ch, tk);
    if (rows.length) data.set(`${ch}|${tk}`, rows);
    done++;
  }));
  process.stdout.write(`\r읽는 중 ${done}/${jobs.length}`);
}
process.stdout.write("\n");
for (const [ch, tk] of Object.entries(OWN_TARGET)) {
  const rows = data.get(`${ch}|${tk}`);
  if (!rows) continue;
  const nm = await fetchNielsen(ch, tk);
  let n = 0;
  for (const a of rows) { const v = nm.get(`${a.d}|${a.s}|${a.pk}`); if (v != null) { a.nr = v; n++; } }
  console.log(`닐슨 짝 ${ch} ${tk} ${n}건`);
}

// ── 공통 도구 ─────────────────────────────────────────────
const in26 = (a: A) => a.d >= FROM;
const wmean = (xs: { v: number; w: number }[]) => { const w = xs.reduce((s, x) => s + x.w, 0); return w > 0 ? xs.reduce((s, x) => s + x.v * x.w, 0) / w : null; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length; if (n < 20) return null;
  const mx = mean(xs)!, my = mean(ys)!;
  let c = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { c += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
  return vx > 0 && vy > 0 ? c / Math.sqrt(vx * vy) : null;
};
const durBucket = (m: number) => (m < 40 ? "40분 미만" : m < 80 ? "40~80분" : "80분 이상");
const r3 = (v: number | null | undefined, d = 3) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

/** 채널·타깃별 2026 방영(시청률 있는 것) + 칸 평균(요일×시간대, 방영 길이 가중) + 작품·요일·시간대 평균 */
function prep(rows: A[], val: (a: A) => number | null | undefined) {
  const r26 = rows.filter((a) => in26(a) && (val(a) ?? 0) > 0 && a.dur > 0);
  const cell = new Map<string, { v: number; w: number }[]>();
  const pslot = new Map<string, number[]>();
  for (const a of r26) {
    const ck = `${a.dow}|${a.band}`;
    (cell.get(ck) ?? cell.set(ck, []).get(ck)!).push({ v: val(a)!, w: a.dur });
    const pkk = `${a.pk}|${a.dow}|${a.band}`;
    (pslot.get(pkk) ?? pslot.set(pkk, []).get(pkk)!).push(val(a)!);
  }
  const cellMean = new Map([...cell].map(([k, v]) => [k, wmean(v)!]));
  const pslotMean = new Map([...pslot].filter(([, v]) => v.length >= 3).map(([k, v]) => [k, mean(v)!]));
  return { r26, cellMean, pslotMean };
}

// ── ① 채널 프로필 · ② 획득 유형 · ⑥ 히트작 ───────────────────
const profileRows: Record<string, unknown>[] = [];
const typeRows: Record<string, unknown>[] = [];
const hitRows: Record<string, unknown>[] = [];

/** 연속 블록: 같은 날 같은 작품이 10분 안쪽 간격으로 이어지면 한 블록 */
function blocks(rows: A[]) {
  const byDay = new Map<string, A[]>();
  for (const a of rows) (byDay.get(a.d) ?? byDay.set(a.d, []).get(a.d)!).push(a);
  const out: A[][] = [];
  for (const day of byDay.values()) {
    day.sort((x, y) => x.s - y.s);
    let cur: A[] = [];
    for (const a of day) {
      const p = cur[cur.length - 1];
      if (p && p.pk === a.pk && a.s - p.e <= 10 && a.s >= p.s) cur.push(a);
      else { if (cur.length) out.push(cur); cur = [a]; }
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

for (const [key, rows] of data) {
  const [ch, tk] = key.split("|");
  const { r26 } = prep(rows, (a) => a.r);
  if (r26.length < 200) continue;
  const chAvg = wmean(r26.map((a) => ({ v: a.r!, w: a.dur })))!;
  const reachAvg = mean(r26.filter((a) => a.rr != null).map((a) => a.rr!));
  // 몰입도: 방영 길이 구간별 평균(1분 시청자 ÷ 도달자)
  const stickBy = new Map<string, number[]>();
  const reachBy = new Map<string, number[]>();
  for (const a of r26) if (a.reach && a.amv != null && a.rr != null) {
    const b = durBucket(a.dur);
    (stickBy.get(b) ?? stickBy.set(b, []).get(b)!).push(a.amv / a.reach);
    (reachBy.get(b) ?? reachBy.set(b, []).get(b)!).push(a.rr);
  }
  const stickMean = new Map([...stickBy].map(([k, v]) => [k, mean(v)!]));
  const reachMean = new Map([...reachBy].map(([k, v]) => [k, mean(v)!]));
  const totMin = r26.reduce((s, a) => s + a.dur, 0);
  const vm = new Map<string, number>(); // 작품별 시청 규모(시청률 × 분)
  for (const a of r26) vm.set(a.pk, (vm.get(a.pk) ?? 0) + a.r! * a.dur);
  const vmTot = [...vm.values()].reduce((a, b) => a + b, 0);
  const top5 = [...vm.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const bl = blocks(r26);
  const inLong = bl.filter((b) => b.length >= 3).reduce((s, b) => s + b.reduce((x, a) => x + a.dur, 0), 0);
  profileRows.push({
    채널: ch, 타깃: tk, 방영수: r26.length, 평균시청률: r3(chAvg, 4), 평균도달률: r3(reachAvg, 3),
    몰입도_40_80분: r3(stickMean.get("40~80분") ?? null, 3), 몰입도_80분이상: r3(stickMean.get("80분 이상") ?? null, 3),
    재방표기_비중: r3(r26.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / totMin, 3),
    작품수: vm.size, 상위5작품_시청규모비중: r3(top5 / vmTot, 3),
    연속3회이상_블록_시간비중: r3(inLong / totMin, 3), 평균블록길이: r3(mean(bl.map((b) => b.length)), 2),
  });

  // 작품별
  const byP = new Map<string, A[]>();
  for (const a of r26) (byP.get(a.pk) ?? byP.set(a.pk, []).get(a.pk)!).push(a);
  const blockLenOf = new Map<A, number>();
  for (const b of bl) for (const a of b) blockLenOf.set(a, b.length);
  const ranked = [...byP.entries()].sort((x, y) => (vm.get(y[0]) ?? 0) - (vm.get(x[0]) ?? 0));
  ranked.forEach(([pk, as], idx) => {
    const rIdx = wmean(as.map((a) => ({ v: a.r!, w: a.dur })))! / chAvg;
    const st = as.filter((a) => a.reach && a.amv != null && a.rr != null && stickMean.get(durBucket(a.dur)));
    const stickIdx = mean(st.map((a) => (a.amv! / a.reach!) / stickMean.get(durBucket(a.dur))!));
    const reachIdx = mean(st.map((a) => a.rr! / reachMean.get(durBucket(a.dur))!));
    if (as.length >= 8 && stickIdx != null && reachIdx != null) {
      typeRows.push({
        채널: ch, 타깃: tk, 작품: as[0].pn.replace(/\s*<[^>]+>/g, ""), 작품키: pk, 방영수: as.length, 시청규모순위: idx + 1,
        평균대비_시청률: r3(rIdx, 2), 도달지수: r3(reachIdx, 2), 몰입지수: r3(stickIdx, 2),
        유형: `${reachIdx >= 1 ? "넓게" : "좁게"}·${stickIdx >= 1 ? "오래" : "잠깐"}`,
      });
    }
    if (idx < 10) {
      const slots = new Map<string, number>();
      for (const a of as) slots.set(`${DOW[a.dow]} ${a.band}`, (slots.get(`${DOW[a.dow]} ${a.band}`) ?? 0) + 1);
      const months = new Set(as.map((a) => a.d.slice(0, 7)));
      hitRows.push({
        채널: ch, 타깃: tk, 순위: idx + 1, 작품: as[0].pn.replace(/\s*<[^>]+>/g, ""), 시청규모비중: r3((vm.get(pk) ?? 0) / vmTot, 3),
        방영수: as.length, 본방표기_비중: r3(as.filter((a) => !a.rerun).length / as.length, 2), 사용칸수: slots.size,
        주력칸: [...slots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}(${n})`).join(", "),
        평균블록길이: r3(mean(as.map((a) => blockLenOf.get(a) ?? 1)), 1), 방영개월수: months.size,
        평균대비_시청률: r3(rIdx, 2), 도달지수: r3(reachIdx, 2), 몰입지수: r3(stickIdx, 2),
      });
    }
  });
}

// ── ③ 연속 블록 · ④ 리드인 · ⑤ 재방 시점 ─────────────────────
type Dyn = { blockPos: Record<number, number | null>; blockN: Record<number, number>; leadR: number | null; leadN: number; rerun: Record<string, number | null>; rerunN: Record<string, number> };
const RERUN_BUCKETS = ["1일 이내", "2~7일", "8~30일", "31~90일", "91일 이상"];
function dyn(rows: A[], val: (a: A) => number | null | undefined): Dyn | null {
  const { r26, cellMean, pslotMean } = prep(rows, val);
  if (r26.length < 200) return null;
  const norm = (a: A) => val(a)! / (cellMean.get(`${a.dow}|${a.band}`) ?? NaN);
  // ③ 블록 위치 효과
  const pos: Record<number, number[]> = { 2: [], 3: [], 4: [] };
  for (const b of blocks(r26)) {
    if (b.length < 2) continue;
    const base = norm(b[0]);
    if (!(base > 0)) continue;
    for (let k = 2; k <= Math.min(4, b.length); k++) { const v = norm(b[k - 1]) / base; if (Number.isFinite(v) && v > 0) pos[k].push(v); }
  }
  // ④ 리드인: 앞 작품 잔차와 뒤 작품 잔차(같은 작품·요일·시간대 평균 대비, 로그)의 상관
  const xs: number[] = [], ys: number[] = [];
  const byDay = new Map<string, A[]>();
  for (const a of r26) (byDay.get(a.d) ?? byDay.set(a.d, []).get(a.d)!).push(a);
  for (const day of byDay.values()) {
    day.sort((x, y) => x.s - y.s);
    for (let i = 1; i < day.length; i++) {
      const p = day[i - 1], c = day[i];
      if (p.pk === c.pk || c.s - p.e > 10 || c.s < p.s) continue;
      const mp = pslotMean.get(`${p.pk}|${p.dow}|${p.band}`), mc = pslotMean.get(`${c.pk}|${c.dow}|${c.band}`);
      if (!mp || !mc) continue;
      xs.push(Math.log(val(p)! / mp)); ys.push(Math.log(val(c)! / mc));
    }
  }
  // ⑤ 재방 시점: 마지막 본방(재방 표기 없는 방영) 후 경과일
  const allSorted = [...rows].filter((a) => (val(a) ?? 0) > 0 || !a.rerun).sort((x, y) => (x.d === y.d ? x.s - y.s : x.d < y.d ? -1 : 1));
  const lastFirst = new Map<string, string>();
  const rb: Record<string, number[]> = Object.fromEntries(RERUN_BUCKETS.map((b) => [b, []]));
  for (const a of allSorted) {
    if (!a.rerun) { lastFirst.set(a.pk, a.d); continue; }
    if (!in26(a) || !((val(a) ?? 0) > 0)) continue;
    const lf = lastFirst.get(a.pk);
    if (!lf) continue;
    const days = Math.round((Date.parse(a.d) - Date.parse(lf)) / 86400000);
    const b = days <= 1 ? RERUN_BUCKETS[0] : days <= 7 ? RERUN_BUCKETS[1] : days <= 30 ? RERUN_BUCKETS[2] : days <= 90 ? RERUN_BUCKETS[3] : RERUN_BUCKETS[4];
    const v = norm(a);
    if (Number.isFinite(v) && v > 0) rb[b].push(v);
  }
  return {
    blockPos: { 2: r3(median(pos[2]), 3), 3: r3(median(pos[3]), 3), 4: r3(median(pos[4]), 3) },
    blockN: { 2: pos[2].length, 3: pos[3].length, 4: pos[4].length },
    leadR: r3(pearson(xs, ys), 3), leadN: xs.length,
    rerun: Object.fromEntries(RERUN_BUCKETS.map((b) => [b, r3(median(rb[b]), 3)])),
    rerunN: Object.fromEntries(RERUN_BUCKETS.map((b) => [b, rb[b].length])),
  };
}
const dynRows: Record<string, unknown>[] = [];
const dynMap = new Map<string, Dyn>();
for (const [key, rows] of data) {
  const [ch, tk] = key.split("|");
  const d = dyn(rows, (a) => a.r);
  if (!d) continue;
  dynMap.set(`${key}|IPTV`, d);
  const add = (src: string, x: Dyn) => dynRows.push({
    채널: ch, 타깃: tk, 자료: src,
    블록_2번째: x.blockPos[2], 블록_3번째: x.blockPos[3], 블록_4번째: x.blockPos[4], 블록_표본: `${x.blockN[2]}/${x.blockN[3]}/${x.blockN[4]}`,
    리드인_상관: x.leadR, 리드인_쌍수: x.leadN,
    ...Object.fromEntries(RERUN_BUCKETS.map((b) => [`재방_${b}`, x.rerun[b]])),
    재방_표본: RERUN_BUCKETS.map((b) => x.rerunN[b]).join("/"),
  });
  add("IPTV", d);
  if (OWN_TARGET[ch] === tk) {
    const dn = dyn(rows.filter((a) => a.nr != null), (a) => a.nr);
    if (dn) { dynMap.set(`${key}|닐슨`, dn); add("닐슨(같은 방영 건)", dn); }
  }
}

// ── ⑦ 빈 칸(군 수요 대비 자사 몫) ─────────────────────────────
const gapRows: Record<string, unknown>[] = [];
for (const [gk, g] of groups) {
  const own = g.members.filter((m) => m.role === "own").map((m) => m.ch);
  for (const o of own) {
    const tk = OWN_TARGET[o];
    const cellBy = new Map<string, Map<string, number>>(); // 칸 → 채널 → 평균 시청률
    const chMeans = new Map<string, number>();
    for (const m of g.members) {
      const rows = data.get(`${m.ch}|${tk}`);
      if (!rows) continue;
      const { r26, cellMean } = prep(rows, (a) => a.r);
      if (r26.length < 200) continue;
      chMeans.set(m.ch, wmean(r26.map((a) => ({ v: a.r!, w: a.dur })))!);
      for (const [ck, v] of cellMean) (cellBy.get(ck) ?? cellBy.set(ck, new Map()).get(ck)!).set(m.ch, v);
    }
    if (!chMeans.has(o)) continue;
    const overallShare = chMeans.get(o)! / [...chMeans.values()].reduce((a, b) => a + b, 0);
    const demands = [...cellBy.values()].map((m) => [...m.values()].reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
    for (const [ck, m] of cellBy) {
      if (!m.has(o) || m.size < Math.min(4, chMeans.size)) continue;
      const demand = [...m.values()].reduce((a, b) => a + b, 0);
      const share = m.get(o)! / demand;
      const rivals = [...m.entries()].filter(([c]) => c !== o).sort((a, b) => b[1] - a[1]);
      const rank = [...m.values()].filter((v) => v > m.get(o)!).length + 1;
      const [dw, band] = ck.split("|");
      gapRows.push({
        군: g.label, 자사: o, 타깃: tk, 요일: DOW[Number(dw)], 시간대: band, 군_시청수요: r3(demand, 4),
        수요_백분위: r3(demands.filter((x) => x <= demand).length / demands.length, 2),
        자사_시청률: r3(m.get(o)!, 4), 자사_몫: r3(share, 3), 몫_지수: r3(share / overallShare, 2), 군안_순위: `${rank}/${m.size}`,
        "1위_경쟁": rivals[0] ? `${rivals[0][0]} ${rivals[0][1].toFixed(3)}` : "",
      });
    }
  }
}

// ── 저장 ───────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
const sheet = (name: string, rows: Record<string, unknown>[], note: string) => {
  const ws = wb.addWorksheet(name);
  ws.addRow([note]).font = { italic: true, color: { argb: "FF666666" } };
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  ws.addRow(cols).font = { bold: true };
  for (const r of rows) ws.addRow(cols.map((c) => r[c] as ExcelJS.CellValue));
  ws.views = [{ state: "frozen", ySplit: 2 }];
};
sheet("1_채널프로필", profileRows, `IPTV ${FROM}~${TO}. 몰입도 = 1분 시청자 ÷ 도달자(방영 길이 구간별 평균). 블록 = 같은 날 같은 작품이 10분 안쪽 간격으로 이어진 방영.`);
sheet("2_획득유형", typeRows, "방영 8회 이상 작품. 도달·몰입 지수 = 같은 채널·같은 방영 길이 구간 평균 대비. 넓게/좁게 = 도달지수 1 기준, 오래/잠깐 = 몰입지수 1 기준.");
sheet("3_블록_리드인_재방", dynRows, "블록 n번째 = n번째 회차 ÷ 첫 회차(각각 같은 채널 요일×시간대 평균으로 나눈 뒤, 중앙값). 리드인 상관 = 앞·뒤 작품의 '평소 대비' 잔차 상관. 재방 = 마지막 본방 후 경과일별 재방의 칸 평균 대비(중앙값). 닐슨 행은 자사 채널의 같은 방영 건 닐슨 값으로 같은 계산.");
sheet("4_히트작_편성방식", hitRows, "채널별 2026 시청 규모(시청률×분) 상위 10개 작품. 본방 표기는 TV INDEX 기준으로 채널 첫 방송과 다를 수 있다.");
sheet("5_빈칸", gapRows, "군 시청 수요 = 그 칸 군 채널 시청률 합. 몫 지수 = 그 칸 자사 몫 ÷ 자사 평소 몫(1보다 크면 평소보다 많이 가져감).");
await wb.xlsx.writeFile(`${OUT}.xlsx`);
fs.writeFileSync(`${OUT}.json`,JSON.stringify({ period: { from: FROM, to: TO }, profileRows, typeRows, hitRows, dynRows, gapRows }, null, 1));
console.log(`저장: 프로필 ${profileRows.length} · 유형 ${typeRows.length} · 히트작 ${hitRows.length} · 동학 ${dynRows.length} · 빈칸 ${gapRows.length}`);
