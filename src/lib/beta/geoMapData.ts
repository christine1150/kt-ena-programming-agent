// 시청률 지도(베타) 데이터 — 서버에서 DB의 닐슨 시청률(OLIFE 걸어서 세계속으로·세계테마기행)과
// 나라·도시·테마 분류(geoClassification.json)를 결합해 권역·국가별 성과 지수를 계산한다.
// 새 방송이 DB에 들어오면 다음 갱신(1시간 캐시)부터 자동으로 반영된다. 분류표에 없는 회차는 매칭되지 않아 빠진다.
// 계산 기준은 scripts/olife-geo/analyze-performance.mts(엑셀 분석)와 같다:
//  슬롯지수 = 시청률 ÷ 같은 프로그램·요일·시간대 평균, 월보정지수 = 시청률 ÷ 같은 프로그램·요일·시간대·월 평균.
import { supabase } from "@/lib/supabase";
import { normalizeSubtitle } from "@/lib/olifeEpisodeParsing";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";
import classification from "./geoClassification.json";
import geoPlaces from "./geoPlaces.json";

// 도시·장소 좌표표(scripts/olife-geo/places.txt에서 내보냄): 이름 → [[나라, 경도, 위도], ...]
const PLACES = geoPlaces as unknown as Record<string, [string, number, number][]>;

type Cls = { no: number; ek: string; sk: string; region: string[]; countries: string[]; places: string[]; nature: string[]; culture: string[] };
const CLS = classification as Cls[];

const PROGRAMS = [
  { id: "13a8a251-d8dc-4313-98fa-18b126aaaf0a", name: "걸어서 세계속으로" },
  { id: "137c7a67-8c35-4d3f-8f0b-a1bd7dd1f2c2", name: "세계테마기행" },
];
const START = "2026-07-01"; // 닐슨 부제(EPG 매칭)가 채워지는 시점
const MIN_N = 3;
const BANDS = ["02-05", "05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];

type Air = { program: string; date: string; start: string; rating: number; sub: string | null };
type Bc = Air & { cls: Cls[]; level: "회차" | "기획"; idx: number; idxM: number };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function slotOf(date: string, start: string) {
  const [y, m, d] = date.split("-").map(Number);
  let h = Number(start.slice(0, 2));
  let wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (h < 2) { h += 24; wd = (wd + 6) % 7; } // 00~02시는 전날 편성일 기준(02:00~26:00)
  return { wd: WD[wd], band: BANDS[Math.min(7, Math.max(0, Math.floor((h - 2) / 3)))], ym: `${y}-${String(m).padStart(2, "0")}` };
}

export interface GeoMapData {
  period: string;
  target: string;
  overallRating: number;
  regions: unknown[];
  countries: unknown[];
}

export async function buildGeoMapData(): Promise<GeoMapData> {
  const { data: channel } = await supabase.from("channels").select("id, primary_target").eq("code", "OLIFE").maybeSingle();
  if (!channel) throw new Error("OLIFE 채널을 찾을 수 없습니다.");
  const label = resolveProgramLevelTargetLabel(channel.primary_target);
  const { data: tg } = await supabase.from("targets").select("id").eq("label", label).maybeSingle();
  if (!tg) throw new Error(`타깃 "${label}"을 찾을 수 없습니다.`);

  const airs: Air[] = [];
  for (const p of PROGRAMS) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("ratings")
        .select("broadcast_date,start_time,rating,episode_subtitle")
        .eq("program_id", p.id).eq("channel_id", channel.id).eq("target_id", tg.id)
        .eq("source_type", "nielsen_daily").gte("broadcast_date", START).not("rating", "is", null)
        .order("broadcast_date").order("start_time").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) airs.push({ program: p.name, date: r.broadcast_date, start: r.start_time, rating: r.rating, sub: r.episode_subtitle });
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  // 기준선: 부제 유무와 관계없이 같은 프로그램의 모든 방송
  const base = new Map<string, { s: number; n: number }>();
  const baseM = new Map<string, { s: number; n: number }>();
  const bump = (m: Map<string, { s: number; n: number }>, k: string, v: number) => { const b = m.get(k) ?? { s: 0, n: 0 }; b.s += v; b.n++; m.set(k, b); };
  for (const a of airs) {
    const sl = slotOf(a.date, a.start);
    bump(base, `${a.program}|${sl.wd}|${sl.band}`, a.rating);
    bump(baseM, `${a.program}|${sl.wd}|${sl.band}|${sl.ym}`, a.rating);
  }

  // 매칭: 회차 키 → 기획 키(앞부분 일치, 4자 이상)
  const byEp = new Map<string, Cls>();
  const bySeries = new Map<string, Cls[]>();
  for (const c of CLS) {
    if (c.ek && !byEp.has(c.ek)) byEp.set(c.ek, c);
    if (c.sk) { if (!bySeries.has(c.sk)) bySeries.set(c.sk, []); bySeries.get(c.sk)!.push(c); }
  }
  const seriesKeys = [...bySeries.keys()].sort((a, b) => b.length - a.length);
  const bcs: Bc[] = [];
  for (const a of airs) {
    if (!a.sub || a.sub === "(없음)") continue;
    const norm = normalizeSubtitle(a.sub);
    let cls: Cls[] | null = null;
    let level: "회차" | "기획" = "회차";
    const ep = byEp.get(norm);
    if (ep) cls = [ep];
    else {
      const sk = seriesKeys.find((k) => k.length >= 4 && norm.startsWith(k));
      if (sk) { cls = bySeries.get(sk)!; level = "기획"; }
    }
    if (!cls) continue;
    const sl = slotOf(a.date, a.start);
    const b = base.get(`${a.program}|${sl.wd}|${sl.band}`)!;
    const bm = baseM.get(`${a.program}|${sl.wd}|${sl.band}|${sl.ym}`)!;
    const idx = b.s > 0 ? a.rating / (b.s / b.n) : NaN;
    const idxM = bm.s > 0 ? a.rating / (bm.s / bm.n) : NaN;
    if (Number.isFinite(idx) && Number.isFinite(idxM)) bcs.push({ ...a, cls, level, idx, idxM });
  }

  const episodesOf = (xs: Bc[]) => new Set(xs.flatMap((b) => b.cls.map((c) => c.no))).size;
  const group = (pick: (c: Cls) => string[]) => {
    const m = new Map<string, Bc[]>();
    for (const b of bcs) for (const name of new Set(b.cls.flatMap(pick))) { if (!name) continue; if (!m.has(name)) m.set(name, []); m.get(name)!.push(b); }
    return m;
  };
  const base2 = (name: string, xs: Bc[]) => ({
    name, n: xs.length, episodes: episodesOf(xs), rating: mean(xs.map((b) => b.rating)),
    idx: mean(xs.map((b) => b.idx)), idxM: mean(xs.map((b) => b.idxM)), sample: xs.length >= MIN_N && episodesOf(xs) >= 2,
  });
  const tally = (xs: Bc[], pick: (c: Cls) => string[]) => {
    const m = new Map<string, number>();
    for (const b of xs) for (const t of new Set(b.cls.flatMap(pick))) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };

  const countryGroups = group((c) => c.countries);
  const regions = [...group((c) => c.region).entries()].map(([name, xs]) => {
    const nat = xs.filter((b) => b.cls.some((c) => c.nature.length)).length;
    const cul = xs.filter((b) => b.cls.some((c) => c.culture.length)).length;
    const both = xs.filter((b) => b.cls.some((c) => c.nature.length) && b.cls.some((c) => c.culture.length)).length;
    const countries = [...countryGroups.entries()]
      .map(([cn, cxs]) => { const inR = cxs.filter((b) => xs.includes(b)); return { name: cn, n: inR.length, idxM: mean(inR.map((b) => b.idxM)), rating: mean(inR.map((b) => b.rating)) }; })
      .filter((c) => c.n > 0).sort((x, y) => y.n - x.n).slice(0, 8);
    return {
      ...base2(name, xs), natureOnly: nat - both, cultureOnly: cul - both, both, neither: xs.length - (nat + cul - both),
      topNature: tally(xs, (c) => c.nature).slice(0, 3), topCulture: tally(xs, (c) => c.culture).slice(0, 3), countries,
    };
  });

  // 도시·장소를 나라에 귀속: 좌표표의 나라가 그 회차의 나라 목록에 있으면 그 나라, 없고 회차가 한 나라뿐이면 그 나라(좌표 없음),
  // 여러 나라인데 못 정하면 버린다(예: 여러 나라를 도는 폭포 특집의 장소를 모든 나라에 붙이지 않는다).
  const placeMap = new Map<string, { country: string; name: string; lon?: number; lat?: number; bcs: Bc[] }>();
  for (const b of bcs) {
    if (b.level !== "회차") continue;
    const c = b.cls[0];
    for (const pl of new Set(c.places)) {
      const hit = PLACES[pl]?.find((e) => c.countries.includes(e[0]));
      const country = hit ? hit[0] : c.countries.length === 1 ? c.countries[0] : null;
      if (!country) continue;
      const k = `${country}|${pl}`;
      if (!placeMap.has(k)) placeMap.set(k, { country, name: pl, lon: hit?.[1], lat: hit?.[2], bcs: [] });
      placeMap.get(k)!.bcs.push(b);
    }
  }
  const countries = [...countryGroups.entries()].map(([name, xs]) => {
    const reg = new Map<string, number>();
    for (const b of xs) for (const c of b.cls) if (c.countries.includes(name)) for (const r of c.region) reg.set(r, (reg.get(r) ?? 0) + 1);
    return {
      ...base2(name, xs),
      region: [...reg.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "",
      places: [...placeMap.values()].filter((p) => p.country === name)
        .map((p) => ({ name: p.name, n: p.bcs.length, idxM: mean(p.bcs.map((b) => b.idxM)), idx: mean(p.bcs.map((b) => b.idx)), rating: mean(p.bcs.map((b) => b.rating)), episodes: episodesOf(p.bcs), lon: p.lon, lat: p.lat }))
        .sort((x, y) => y.n - x.n).slice(0, 40),
      themes: tally(xs, (c) => [...c.nature, ...c.culture]).slice(0, 4),
    };
  }).sort((x, y) => y.n - x.n);

  return { period: `${START} ~ ${airs[airs.length - 1]?.date ?? START}`, target: label, overallRating: mean(bcs.map((b) => b.rating)), regions, countries };
}
