// ENA Play(41)·ENA Drama(42) 지니TV 인접 배치(2026-09-02) 후 같은 타이틀 편성의 잠식(카니발라이제이션) 점검 — 사용자 질문 2026-11-11.
// 수치는 모두 여기서 계산한다(원칙 1). 자료: iptv_airing_metrics(IPTV 3사 합산) + TV INDEX 일별 플랫폼별 시청률.
// 방영 건을 ① 같은 시각 같은 타이틀(시간 겹침) ② 같은 날 같은 타이틀(시간 안 겹침) ③ 단독 으로 나누고,
// 각 방영의 지수(같은 채널·같은 구간 요일×시간대 평균=1)와 겹친 시각의 두 채널 합산 시청률을 이동 전후로 비교한다.
// 실행: node --env-file=.env --import tsx scripts/iptv-research/play-drama-overlap.mts → docs/iptv/ENA_Play_Drama_overlap.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PRE = ["2026-07-08", "2026-09-01"] as const, POST = ["2026-09-02", "2026-11-10"] as const;
const r = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const pct = (a: number | null, b: number | null) => (a == null || b == null || !b ? null : r((a / b - 1) * 100, 1));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// 회차 태그·부제 차이를 줄인 비교용 이름(공백·문장부호 제거)
const canon = (s: string) => s.replace(/\s*<[^>]+>/g, "").replace(/[\s,.:·!?'"()\-]/g, "").toLowerCase();
type A = { ch: string; d: string; s: number; e: number; pn: string; cn: string; r: number; dur: number; band: string; dow: number; rerun: boolean; kind?: string; idx?: number };
async function all<T>(t: string, sel: string, f: (q: any) => any): Promise<T[]> { const out: T[] = []; for (let i = 0; ; i += 1000) { const { data, error } = await f(sb.from(t).select(sel)).range(i, i + 999); if (error) throw new Error(`${t}: ${error.message}`); out.push(...(data as T[])); if (!data || data.length < 1000) break; } return out; }
async function load(ch: string, tk: string): Promise<A[]> {
  const xs = await all<any>("iptv_airing_metrics", "broadcast_date,start_minute,end_minute,program_key,program_name,rating,duration_min,slot_band,dow,is_rerun_tag", (q) => q.eq("channel_name", ch).eq("target_kind", tk).gte("broadcast_date", PRE[0]).lte("broadcast_date", POST[1]).order("broadcast_date").order("start_minute").order("program_key"));
  return xs.filter((x) => x.rating != null && Number(x.duration_min) > 0).map((x) => ({ ch, d: x.broadcast_date, s: x.start_minute, e: x.end_minute, pn: String(x.program_name).replace(/\s*<[^>]+>/g, "").trim(), cn: canon(String(x.program_name)), r: Number(x.rating), dur: Number(x.duration_min), band: x.slot_band, dow: x.dow, rerun: x.is_rerun_tag }));
}
const wm = (xs: A[], f: (a: A) => number = (a) => a.r) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + f(a) * a.dur, 0) / w : null; };
const per = (a: A) => (a.d <= PRE[1] ? "전" : "후");

const out: Record<string, unknown> = { 구간: { 전: PRE, 후: POST } };
for (const tk of ["p2049", "household"]) {
  const P = await load("ENA Play", tk), D = await load("ENA Drama", tk);
  // 지수: 같은 채널·같은 구간(전/후) 요일×시간대 평균=1
  for (const xs of [P, D]) { const m = new Map<string, A[]>(); xs.forEach((a) => { const k = `${per(a)}|${a.dow}|${a.band}`; (m.get(k) ?? m.set(k, []).get(k)!).push(a); });
    const mm = new Map([...m].map(([k, v]) => [k, wm(v)!])); xs.forEach((a) => { const b = mm.get(`${per(a)}|${a.dow}|${a.band}`); a.idx = b ? a.r / b : undefined; }); }
  // 분류
  const byDay = (xs: A[]) => { const m = new Map<string, A[]>(); xs.forEach((a) => (m.get(a.d) ?? m.set(a.d, []).get(a.d)!).push(a)); return m; };
  const pd = byDay(P), dd = byDay(D);
  const classify = (xs: A[], other: Map<string, A[]>) => xs.forEach((a) => { const o = (other.get(a.d) ?? []).filter((b) => b.cn === a.cn); a.kind = o.some((b) => b.s < a.e && a.s < b.e) ? "동시" : o.length ? "같은날" : "단독"; });
  classify(P, dd); classify(D, pd);
  const sec: Record<string, unknown> = {};
  for (const [name, xs] of [["ENA Play", P], ["ENA Drama", D]] as const) {
    const rows: Record<string, unknown>[] = [];
    for (const k of ["동시", "같은날", "단독"]) for (const p of ["전", "후"]) { const z = xs.filter((a) => a.kind === k && per(a) === p); const tot = xs.filter((a) => per(a) === p).reduce((s, a) => s + a.dur, 0);
      rows.push({ 유형: k, 구간: p, 방영: z.length, 분비중: r(z.reduce((s, a) => s + a.dur, 0) / tot, 3), 시청률: r(wm(z)), 지수: r(wm(z.filter((a) => a.idx != null), (a) => a.idx!), 3) }); }
    sec[name] = rows;
  }
  // 동시 편성 시각의 두 채널 합산: 실제 합 ÷ 두 채널 그 칸 평소 값의 합 (1보다 작으면 함께 틀어 손해)
  const pair: Record<string, unknown>[] = [];
  for (const p of ["전", "후"]) {
    const prs: { a: A; b: A; ov: number }[] = [];
    for (const a of P.filter((x) => x.kind === "동시" && per(x) === p)) for (const b of (dd.get(a.d) ?? []).filter((y) => y.cn === a.cn && y.s < a.e && a.s < y.e)) prs.push({ a, b, ov: Math.min(a.e, b.e) - Math.max(a.s, b.s) });
    const w = prs.reduce((s, x) => s + x.ov, 0);
    const act = w ? prs.reduce((s, x) => s + (x.a.r + x.b.r) * x.ov, 0) / w : null;
    const exp = w ? prs.reduce((s, x) => s + (x.a.r / (x.a.idx ?? 1) + x.b.r / (x.b.idx ?? 1)) * x.ov, 0) / w : null;
    pair.push({ 구간: p, 쌍: prs.length, 겹친분: w, 합산시청률: r(act), 평소합: r(exp), 비: act && exp ? r(act / exp, 3) : null, Play지수: r(w ? prs.reduce((s, x) => s + (x.a.idx ?? 1) * x.ov, 0) / w : null, 3), Drama지수: r(w ? prs.reduce((s, x) => s + (x.b.idx ?? 1) * x.ov, 0) / w : null, 3) });
  }
  // 타이틀별: 동시 편성이 많은 작품의 동시 vs 단독 지수(전/후)
  const titles: Record<string, unknown>[] = [];
  { const names = new Map<string, string>(); P.forEach((a) => names.set(a.cn, a.pn));
    for (const [cn, pn] of names) { const z = P.filter((a) => a.cn === cn); const ov = z.filter((a) => a.kind === "동시"); if (ov.length < 8) continue;
      const g = (k: string, p: string) => { const y = z.filter((a) => (k === "동시" ? a.kind === "동시" : a.kind !== "동시") && per(a) === p && a.idx != null); return y.length ? `${r(wm(y))}(${r(wm(y, (a) => a.idx!), 2)},${y.length})` : "-"; };
      const dz = D.filter((a) => a.cn === cn);
      titles.push({ 작품: pn, Play동시방영: ov.length, Drama방영: dz.length, Play_동시_전: g("동시", "전"), Play_동시_후: g("동시", "후"), Play_그외_전: g("그외", "전"), Play_그외_후: g("그외", "후") }); }
    titles.sort((a, b) => (b.Play동시방영 as number) - (a.Play동시방영 as number)); }
  out[tk] = { 유형별: sec, 동시합산: pair, 작품별: titles.slice(0, 15) };
}

// 지니TV에서 ENA Drama로 옮겨 갔는가: ENA Drama의 지니TV ÷ (Btv·U+tv 평균) 전후(번호 그대로인 42번 옆에 41번이 붙음)
{ const xs = await all<any>("iptv_tvindex_channel_daily", "channel_name,stat_date,metric,value", (q) => q.in("channel_name", ["ENA Drama", "ENA Play", "ENA", "OLIFE"]).eq("target_kind", "household").in("metric", ["rating_genie_tv", "rating_btv", "rating_uplus_tv", "share_rating_genie_tv", "share_rating_btv", "share_rating_uplus_tv"]).gte("stat_date", "2025-07-01").order("stat_date").order("channel_name").order("metric"));
  const v = (ch: string, m: string, a: string, b: string) => mean(xs.filter((x) => x.channel_name === ch && x.metric === m && x.stat_date >= a && x.stat_date <= b && x.value != null).map((x) => Number(x.value)));
  const ratio = (ch: string, kind: string, a: string, b: string) => { const g = v(ch, `${kind}_genie_tv`, a, b), bt = v(ch, `${kind}_btv`, a, b), u = v(ch, `${kind}_uplus_tv`, a, b); return g != null && bt != null && u != null ? g / ((bt + u) / 2) : null; };
  const y = (d: string) => d.replace("2026-", "2025-");
  out.genie = ["ENA Drama", "ENA Play", "ENA", "OLIFE"].flatMap((ch) => ["rating", "share_rating"].map((k) => ({ 채널: ch, 지표: k, 전: r(ratio(ch, k, ...PRE), 3), 후: r(ratio(ch, k, ...POST), 3), 변화: pct(ratio(ch, k, ...POST), ratio(ch, k, ...PRE)), "2025변화": pct(ratio(ch, k, y(POST[0]), y(POST[1])), ratio(ch, k, y(PRE[0]), y(PRE[1]))), 후1_4주: pct(ratio(ch, k, "2026-09-02", "2026-09-29"), ratio(ch, k, ...PRE)) })));
  // 두 채널 합산(지니TV): Play+Drama 지니 시청률 합의 전후 변화 vs Btv·U+tv
  out.combined = ["genie_tv", "btv", "uplus_tv"].map((p) => { const s = (a: string, b: string) => (v("ENA Play", `rating_${p}`, a, b) ?? 0) + (v("ENA Drama", `rating_${p}`, a, b) ?? 0); return { 플랫폼: p, 전: r(s(...PRE)), 후: r(s(...POST)), 변화: pct(s(...POST), s(...PRE)), "2025변화": pct(s(y(POST[0]), y(POST[1])), s(y(PRE[0]), y(PRE[1]))) }; });
}

fs.writeFileSync("docs/iptv/ENA_Play_Drama_overlap.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
