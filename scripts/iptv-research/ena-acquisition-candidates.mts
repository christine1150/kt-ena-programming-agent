// ENA 구매(재방송 판권) 후보: 지상파·tvN·JTBC의 예능·드라마 중 원 채널에서 본방송·재방송 효율이 모두 좋은 작품(2026-11-11 사용자 지시).
// 생방송(뉴스·시사·스포츠·중계·생방송 표기)은 제외하고 장르 표의 예능·드라마만 본다. 수치는 모두 여기서 계산한다(원칙 1).
// 효율 = 같은 채널 같은 요일×시간대 평균 시청률 대비(최근 15개월, IPTV 수도권 2049).
// 실행: node --env-file=.env --import tsx scripts/iptv-research/ena-acquisition-candidates.mts [자사채널=ENA] [타깃=p2049] → docs/iptv/<채널>_acquisition_candidates.json
// ENA Story(가구)·ENA Play(2049) 보고서에도 같은 기준을 쓰도록 채널·타깃 인자를 받음(2026-11-11).
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const OWN = process.argv[2] ?? "ENA", TK = process.argv[3] ?? "p2049";
const FROM = "2025-08-01", TO = "2026-11-10";
const SRC = ["KBS1", "KBS2", "MBC", "SBS", "tvN", "JTBC"];
const LIVE = /뉴스|생방송|생생정보|라이브|중계|월드컵|올림픽|하이라이트|아시안게임|시사|토론|날씨|특보|아침마당|모닝와이드|가요무대|뮤직뱅크|인기가요|음악중심/;
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
type A = { d: string; s: number; pk: string; pn: string; rerun: boolean; r: number; dur: number; dow: number; band: string };

async function load(ch: string): Promise<A[]> {
  const out: A[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("iptv_airing_metrics").select("broadcast_date,start_minute,program_key,program_name,is_rerun_tag,rating,duration_min,dow,slot_band")
      .eq("channel_name", ch).eq("target_kind", TK).gte("broadcast_date", FROM).lte("broadcast_date", TO)
      .order("broadcast_date").order("start_minute").order("program_key").range(f, f + 999);
    if (error) throw error;
    for (const x of data ?? []) if (x.rating != null && Number(x.duration_min) > 0) out.push({ d: x.broadcast_date, s: x.start_minute, pk: x.program_key, pn: String(x.program_name).replace(/\s*<[^>]+>/g, "").trim(), rerun: x.is_rerun_tag, r: Number(x.rating), dur: Number(x.duration_min), dow: x.dow, band: x.slot_band });
    if (!data || data.length < 1000) break;
  }
  return out;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const wmean = (xs: A[]) => { const w = xs.reduce((s, a) => s + a.dur, 0); return w ? xs.reduce((s, a) => s + a.r * a.dur, 0) / w : null; };
const r = (v: number | null, d = 2) => (v == null ? null : Number(v.toFixed(d)));
function cells(rows: A[]) { const m = new Map<string, A[]>(); rows.forEach((a) => (m.get(`${a.dow}|${a.band}`) ?? m.set(`${a.dow}|${a.band}`, []).get(`${a.dow}|${a.band}`)!).push(a)); return new Map([...m].map(([k, v]) => [k, wmean(v)!])); }

const ena = await load(OWN);
const enaCm = cells(ena);
const enaBy = new Map<string, A[]>(); ena.forEach((a) => (enaBy.get(a.pk) ?? enaBy.set(a.pk, []).get(a.pk)!).push(a));
const out: Record<string, unknown>[] = [];
for (const ch of SRC) {
  const rows = await load(ch);
  const cm = cells(rows);
  const idx = (a: A) => { const m = cm.get(`${a.dow}|${a.band}`); return m && m > 0 ? a.r / m : null; };
  const keys = [...new Set(rows.map((a) => a.pk))];
  const genre = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 80) { const { data } = await sb.from("iptv_program_genre").select("program_key,genre").in("program_key", keys.slice(i, i + 80)); for (const x of data ?? []) genre.set(x.program_key, x.genre); }
  const by = new Map<string, A[]>(); rows.forEach((a) => (by.get(a.pk) ?? by.set(a.pk, []).get(a.pk)!).push(a));
  for (const [pk, as] of by) {
    const g = genre.get(pk) ?? "";
    if (!/^(예능|드라마)$/.test(g) || LIVE.test(as[0].pn)) continue;
    const first = as.filter((a) => !a.rerun), re = as.filter((a) => a.rerun);
    if (first.length < 4 || re.length < 4) continue;
    const fi = mean(first.map(idx).filter((v): v is number => v != null)), ri = mean(re.map(idx).filter((v): v is number => v != null));
    if (fi == null || ri == null || fi < 1.1 || ri < 1.0) continue;
    const slots = new Map<string, number>(); first.forEach((a) => slots.set(`${DOW[a.dow]} ${a.band}`, (slots.get(`${DOW[a.dow]} ${a.band}`) ?? 0) + 1));
    const e = enaBy.get(pk) ?? [];
    const eIdx = mean(e.map((a) => { const m = enaCm.get(`${a.dow}|${a.band}`); return m && m > 0 ? a.r / m : null; }).filter((v): v is number => v != null));
    out.push({ 채널: ch, 작품: as[0].pn, 장르: g, 본방송횟수: first.length, 본방송_평균시청률: r(wmean(first), 3), 본방송_효율: r(fi), 재방송횟수: re.length, 재방송_평균시청률: r(wmean(re), 3), 재방송_효율: r(ri), 본방송_주력: [...slots].sort((p, q) => q[1] - p[1])[0][0], 마지막방영: as[as.length - 1].d, 자사_방영: e.length, 자사_효율: r(eIdx) });
  }
}
out.sort((p, q) => (q.재방송_효율 as number) + (q.본방송_효율 as number) - ((p.재방송_효율 as number) + (p.본방송_효율 as number)));
fs.writeFileSync(OWN === "ENA" && TK === "p2049" ? "docs/iptv/ena_acquisition_candidates.json" : `docs/iptv/${OWN.replace(/\s+/g, "_")}_${TK}_acquisition_candidates.json`, JSON.stringify(out, null, 1));
console.log(out.length);
console.log(out.map((x) => Object.values(x).join(" | ")).join("\n"));
