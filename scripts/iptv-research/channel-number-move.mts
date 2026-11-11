// ENA Play 지니TV 채널 번호 이동(2026-09-02, 999→41 / KBS Joy 41→999) 전후 시청 패턴 비교 — 사용자 질문 2026-11-11.
// 수치는 모두 여기서 계산한다(원칙 1). 자료: TV INDEX 채널 일별 값(플랫폼별 시청률·도달률·점유율, 2049 시청률·도달률·인당 시청시간)
// + 방영 단위 값(iptv_airing_metrics, IPTV 3사 합산). 계절 요인은 2025년 같은 달력 구간과 비교하고, 번호가 바뀌지 않은 Btv·U+tv와 자사 채널을 대조군으로 둔다.
// 실행: node --env-file=.env --import tsx scripts/iptv-research/channel-number-move.mts → docs/iptv/ENA_Play_channel_number_move.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MOVE = "2026-09-02";
// 구간: 이동 전 8주 / 이동 후 1~4주·5~8주·9~10주 / 이동 후 전체(10주). 2025년은 같은 달력 날짜.
const W = { 전8주: ["2026-07-08", "2026-09-01"], 후1_4주: ["2026-09-02", "2026-09-29"], 후5_8주: ["2026-09-30", "2026-10-27"], 후9_10주: ["2026-10-28", "2026-11-10"], 후전체: ["2026-09-02", "2026-11-10"] } as const;
const y25 = (d: string) => d.replace("2026-", "2025-");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const pct = (a: number | null, b: number | null) => (a == null || b == null || !b ? null : r((a / b - 1) * 100, 1));
async function all<T>(t: string, sel: string, f: (q: any) => any): Promise<T[]> { const out: T[] = []; for (let i = 0; ; i += 1000) { const { data, error } = await f(sb.from(t).select(sel)).range(i, i + 999); if (error) throw new Error(`${t}: ${error.message}`); out.push(...(data as T[])); if (!data || data.length < 1000) break; } return out; }

// 1. TV INDEX 일별 값
type D = { channel_name: string; target_kind: string; stat_date: string; metric: string; value: number | null };
const CH_D = ["ENA Play", "ENA", "ENA Drama", "OLIFE"];
const daily = await all<D>("iptv_tvindex_channel_daily", "channel_name,target_kind,stat_date,metric,value", (q) => q.in("channel_name", CH_D).gte("stat_date", "2025-06-01").order("stat_date").order("metric").order("channel_name").order("target_kind"));
const dv = (ch: string, tk: string, m: string, a: string, b: string) => mean(daily.filter((x) => x.channel_name === ch && x.target_kind === tk && x.metric === m && x.stat_date >= a && x.stat_date <= b && x.value != null).map((x) => Number(x.value)));
const has = (ch: string, tk: string, m: string) => daily.some((x) => x.channel_name === ch && x.target_kind === tk && x.metric === m);

// 1-a. 플랫폼별(가구): 지니TV는 번호가 바뀐 곳, Btv·U+tv는 그대로인 곳
const platform: Record<string, unknown>[] = [];
for (const ch of CH_D) for (const kind of ["rating", "reach_rating", "share_rating"]) {
  if (!has(ch, "household", `${kind}_genie_tv`)) continue;
  const row: Record<string, unknown> = { 채널: ch, 지표: kind };
  for (const p of ["genie_tv", "btv", "uplus_tv"]) {
    const m = `${kind}_${p}`; const pre = dv(ch, "household", m, ...W.전8주), post = dv(ch, "household", m, ...W.후전체);
    const pre25 = dv(ch, "household", m, y25(W.전8주[0]), y25(W.전8주[1])), post25 = dv(ch, "household", m, y25(W.후전체[0]), y25(W.후전체[1]));
    row[p] = { 전: r(pre), 후: r(post), 변화: pct(post, pre), "2025전": r(pre25), "2025후": r(post25), "2025변화": pct(post25, pre25), 구간별: Object.fromEntries((["후1_4주", "후5_8주", "후9_10주"] as const).map((k) => [k, pct(dv(ch, "household", m, W[k][0], W[k][1]), pre)])) };
  }
  platform.push(row);
}
// 1-b. 지니TV ÷ (Btv·U+tv 평균) 주간 추이 — 같은 채널·같은 편성이라 콘텐츠 요인이 상쇄된다
const weekly: Record<string, unknown>[] = [];
{ const start = new Date("2026-06-03T00:00:00Z");
  for (let t = start; t <= new Date("2026-11-10T00:00:00Z"); t = new Date(t.getTime() + 7 * 864e5)) {
    const a = t.toISOString().slice(0, 10), b = new Date(t.getTime() + 6 * 864e5).toISOString().slice(0, 10);
    const row: Record<string, unknown> = { 주시작: a };
    for (const ch of CH_D) { const g = dv(ch, "household", "rating_genie_tv", a, b), bt = dv(ch, "household", "rating_btv", a, b), u = dv(ch, "household", "rating_uplus_tv", a, b);
      row[ch] = { 지니: r(g), Btv: r(bt), "U+": r(u), 지니비: g != null && bt != null && u != null ? r(g / ((bt + u) / 2), 3) : null }; }
    const p = dv("ENA Play", "p2049", "rating", a, b); row["ENA Play_2049"] = r(p);
    weekly.push(row);
  } }
// 1-c. 2049(IPTV 합산): 시청률 = 도달률 × 인당 시청시간 구조로 나눠 본다(번호 접근성 하락은 도달에 먼저 나타나야 함)
const p2049: Record<string, unknown>[] = [];
for (const ch of ["ENA Play", "ENA"]) for (const m of ["rating", "reach_rate", "viewing_minutes_per_viewer", "avg_minute_viewers", "reach_viewers"]) {
  if (!has(ch, "p2049", m)) continue;
  const pre = dv(ch, "p2049", m, ...W.전8주), post = dv(ch, "p2049", m, ...W.후전체);
  const pre25 = dv(ch, "p2049", m, y25(W.전8주[0]), y25(W.전8주[1])), post25 = dv(ch, "p2049", m, y25(W.후전체[0]), y25(W.후전체[1]));
  p2049.push({ 채널: ch, 지표: m, 전: r(pre), 후: r(post), 변화: pct(post, pre), "2025변화": pct(post25, pre25), 구간별: Object.fromEntries((["후1_4주", "후5_8주", "후9_10주"] as const).map((k) => [k, pct(dv(ch, "p2049", m, W[k][0], W[k][1]), pre)])) });
}

// 2. 방영 단위(IPTV 3사 합산): 시간대별·본방/재방별·같은 작품 전후
type A = { d: string; pk: string; pn: string; r: number; dur: number; band: string; dow: number; rerun: boolean; s: number };
async function airings(ch: string, tk: string, from: string, to: string): Promise<A[]> {
  const xs = await all<any>("iptv_airing_metrics", "broadcast_date,program_key,program_name,rating,duration_min,slot_band,dow,is_rerun_tag,start_minute", (q) => q.eq("channel_name", ch).eq("target_kind", tk).gte("broadcast_date", from).lte("broadcast_date", to).order("broadcast_date").order("start_minute").order("program_key"));
  return xs.filter((x) => x.rating != null && Number(x.duration_min) > 0).map((x) => ({ d: x.broadcast_date, pk: x.program_key, pn: String(x.program_name).replace(/\s*<[^>]+>/g, "").trim(), r: Number(x.rating), dur: Number(x.duration_min), band: x.slot_band, dow: x.dow, rerun: x.is_rerun_tag, s: x.start_minute }));
}
const wm = (xs: A[]) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + a.r * a.dur, 0) / w : null; };
const inW = (xs: A[], a: string, b: string) => xs.filter((x) => x.d >= a && x.d <= b);
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];
const AIR = new Map<string, A[]>();
const air: Record<string, unknown>[] = [], bands: Record<string, unknown>[] = [], same: Record<string, unknown>[] = [];
for (const [ch, tk] of [["ENA Play", "p2049"], ["ENA Play", "household"], ["KBS Joy", "household"], ["ENA Drama", "p2049"], ["ENA Drama", "household"], ["ENA", "p2049"], ["ENA", "household"]] as const) {
  const xs = await airings(ch, tk, "2025-07-01", "2026-11-10"); AIR.set(`${ch}|${tk}`, xs);
  const pre = inW(xs, ...W.전8주), post = inW(xs, ...W.후전체), pre25 = inW(xs, y25(W.전8주[0]), y25(W.전8주[1])), post25 = inW(xs, y25(W.후전체[0]), y25(W.후전체[1]));
  const ex = (p: A[], q: A[]) => pct(wm(q), wm(p));
  air.push({ 채널: ch, 타깃: tk, 전: r(wm(pre)), 후: r(wm(post)), 변화: ex(pre, post), "2025변화": ex(pre25, post25), 후1_4주: ex(pre, inW(xs, ...W.후1_4주)), 후5_8주: ex(pre, inW(xs, ...W.후5_8주)), 후9_10주: ex(pre, inW(xs, ...W.후9_10주)),
    본방_변화: ex(pre.filter((a) => !a.rerun), post.filter((a) => !a.rerun)), 재방_변화: ex(pre.filter((a) => a.rerun), post.filter((a) => a.rerun)), 재방비중_전: r(pre.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / pre.reduce((s, a) => s + a.dur, 0), 2), 재방비중_후: r(post.filter((a) => a.rerun).reduce((s, a) => s + a.dur, 0) / post.reduce((s, a) => s + a.dur, 0), 2) });
  for (const b of BANDS) { const f = (z: A[]) => z.filter((a) => a.band === b); bands.push({ 채널: ch, 타깃: tk, 시간대: b, 전: r(wm(f(pre))), 후: r(wm(f(post))), 변화: ex(f(pre), f(post)), "2025변화": ex(f(pre25), f(post25)) }); }
  // 같은 작품 전후(이동 전 8주·후 10주에 각 5회 이상): 콘텐츠가 같을 때의 변화
  if (["ENA Play", "KBS Joy", "ENA Drama"].includes(ch)) {
    const g = (z: A[]) => { const m = new Map<string, A[]>(); z.forEach((a) => (m.get(a.pn) ?? m.set(a.pn, []).get(a.pn)!).push(a)); return m; };
    const gp = g(pre), gq = g(post); const rows: { 작품: string; 전: number; 후: number; 변화: number; 전방영: number; 후방영: number }[] = [];
    for (const [pn, p] of gp) { const q = gq.get(pn); if (!q || p.length < 5 || q.length < 5) continue; rows.push({ 작품: pn, 전: r(wm(p))!, 후: r(wm(q))!, 변화: pct(wm(q), wm(p))!, 전방영: p.length, 후방영: q.length }); }
    rows.sort((a, b) => b.전방영 + b.후방영 - (a.전방영 + a.후방영));
    const ch2 = rows.map((x) => x.변화).sort((a, b) => a - b);
    same.push({ 채널: ch, 타깃: tk, 작품수: rows.length, 하락작품: rows.filter((x) => x.변화 < 0).length, 중앙값변화: ch2.length ? ch2[Math.floor(ch2.length / 2)] : null, 작품: rows.slice(0, 15) });
  }
}

// 3. 닐슨 대비 IPTV 비율(같은 방영 회차): 닐슨은 케이블·위성 포함 전 플랫폼이라 IPTV 쪽만의 변화를 따로 볼 수 있다
const nratio: Record<string, unknown>[] = [];
for (const [ch, tk] of [["ENA Play", "p2049"], ["ENA Play", "household"], ["KBS Joy", "household"], ["ENA Drama", "p2049"], ["ENA Drama", "household"], ["ENA", "p2049"], ["ENA", "household"]] as const) {
  const am = new Map(AIR.get(`${ch}|${tk}`)!.map((a) => [`${a.d}|${a.s}|${a.pk}`, a]));
  const ms = await all<any>("iptv_nielsen_match", "broadcast_date,start_minute,program_key,nielsen_rating", (q) => q.eq("channel_name", ch).eq("target_kind", tk).gte("broadcast_date", "2026-07-01").order("broadcast_date").order("start_minute").order("program_key"));
  const xs = ms.filter((m) => m.nielsen_rating != null).map((m) => ({ a: am.get(`${m.broadcast_date}|${m.start_minute}|${m.program_key}`), n: Number(m.nielsen_rating) })).filter((x): x is { a: A; n: number } => !!x.a);
  const f = (a: string, b: string) => { const z = xs.filter((x) => x.a.d >= a && x.a.d <= b); const w = z.reduce((s, x) => s + x.a.dur, 0); return { iptv: w ? z.reduce((s, x) => s + x.a.r * x.a.dur, 0) / w : null, nielsen: w ? z.reduce((s, x) => s + x.n * x.a.dur, 0) / w : null, n: z.length }; };
  const pre = f(...W.전8주), post = f(...W.후전체);
  nratio.push({ 채널: ch, 타깃: tk, IPTV전: r(pre.iptv), IPTV후: r(post.iptv), IPTV변화: pct(post.iptv, pre.iptv), 닐슨전: r(pre.nielsen), 닐슨후: r(post.nielsen), 닐슨변화: pct(post.nielsen, pre.nielsen), 비율전: pre.iptv && pre.nielsen ? r(pre.iptv / pre.nielsen, 3) : null, 비율후: post.iptv && post.nielsen ? r(post.iptv / post.nielsen, 3) : null, 회차: [pre.n, post.n] });
}

// 4. KBS Joy(41→999) 주간 추이 — TV INDEX 일별 자료에 KBS Joy가 없어 방영 단위(IPTV 3사 합산, 가구)로 본다. 2025년 같은 주와 나란히 둔다.
const joyWeekly: Record<string, unknown>[] = [];
{ const xs = AIR.get("KBS Joy|household")!, ep = AIR.get("ENA Play|household")!;
  for (let t = new Date("2026-07-08T00:00:00Z"); t <= new Date("2026-11-10T00:00:00Z"); t = new Date(t.getTime() + 7 * 864e5)) {
    const a = t.toISOString().slice(0, 10), b = new Date(t.getTime() + 6 * 864e5).toISOString().slice(0, 10);
    joyWeekly.push({ 주시작: a, KBS_Joy: r(wm(inW(xs, a, b))), KBS_Joy_2025: r(wm(inW(xs, y25(a), y25(b)))), ENA_Play: r(wm(inW(ep, a, b))) }); } }

const out = { 이동일: MOVE, 구간: W, platform, p2049, air, bands, same, nratio, weekly, joyWeekly };
fs.writeFileSync("docs/iptv/ENA_Play_channel_number_move.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ platform, p2049, air, nratio, same: same.map((s: any) => ({ ...s, 작품: s.작품.slice(0, 8) })) }, null, 0));
