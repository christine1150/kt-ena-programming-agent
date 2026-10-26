// 시청률 지도(베타) 데이터 — 서버에서 DB의 닐슨 시청률(OLIFE 걸어서 세계속으로·세계테마기행)과
// 나라·도시·테마 분류(geoClassification.json)를 결합해, 방송 한 건마다 시청률·지수·나라·장소·테마를 붙여 내려 준다.
// 화면은 이 방송 목록을 프로그램·테마·나라 필터에 따라 다시 묶어 국가·권역·회차 순위를 그린다.
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
  { id: "13a8a251-d8dc-4313-98fa-18b126aaaf0a", name: "걸어서 세계속으로", short: "걸세" },
  { id: "137c7a67-8c35-4d3f-8f0b-a1bd7dd1f2c2", name: "세계테마기행", short: "세테기" },
];
const START = "2026-07-01"; // 닐슨 부제(EPG 매칭)가 채워지는 시점
const BANDS = ["02-05", "05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];

// 화면 우측 상단에서 고를 수 있는 타깃(기본 = 채널 기본 타깃인 전국 유료가구)
export const GEO_MAP_TARGETS = [
  "전국 유료가구", "수도권 2049", "전국 5064",
  "전국 여20대", "전국 여30대", "전국 여40대", "전국 여50대", "전국 여60대+",
  "전국 남20대", "전국 남30대", "전국 남40대", "전국 남50대", "전국 남60대+",
];

type Air = { program: string; short: string; date: string; start: string; rating: number; sub: string | null; ep: number | null };

function slotOf(date: string, start: string) {
  const [y, m, d] = date.split("-").map(Number);
  let h = Number(start.slice(0, 2));
  let wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (h < 2) { h += 24; wd = (wd + 6) % 7; } // 00~02시는 전날 편성일 기준(02:00~26:00)
  return { wd: WD[wd], band: BANDS[Math.min(7, Math.max(0, Math.floor((h - 2) / 3)))], ym: `${y}-${String(m).padStart(2, "0")}` };
}

// 방송 한 건(화면 집계 단위). 필드명은 내려보내는 JSON 크기를 줄이려고 짧게 둔다.
export interface GeoBroadcast {
  p: string;        // 프로그램 약칭(걸세·세테기)
  ep: number | null; // OLIFE 회차 번호(닐슨)
  sub: string;      // 부제(닐슨 원문)
  d: string;        // 방송일
  t: string;        // 시작 시각 HH:MM
  wd: string;       // 편성 요일
  band: string;     // 시간대
  r: number;        // 시청률(%)
  m: number;        // 월보정지수
  i: number;        // 슬롯지수
  k: string;        // 회차 묶음 키(같은 회차의 재방송을 하나로 묶는다)
  lv: "회차" | "기획"; // 분류표와 맞은 단위(기획은 여러 회차 중 하나로만 특정됨)
  rg: string[];     // 권역
  cs: string[];     // 나라
  nat: string[];    // 자연 테마
  cul: string[];    // 문화 테마
  pl: [string, string, number | null, number | null][]; // 도시·장소 [이름, 귀속 나라, 경도, 위도]
}

export interface GeoMapData {
  period: string;
  target: string;
  targets: string[];
  bcs: GeoBroadcast[];
}

export async function buildGeoMapData(targetLabel?: string): Promise<GeoMapData> {
  const { data: channel } = await supabase.from("channels").select("id, primary_target").eq("code", "OLIFE").maybeSingle();
  if (!channel) throw new Error("OLIFE 채널을 찾을 수 없습니다.");
  const label = targetLabel && GEO_MAP_TARGETS.includes(targetLabel) ? targetLabel : resolveProgramLevelTargetLabel(channel.primary_target);
  const { data: tg } = await supabase.from("targets").select("id").eq("label", label).maybeSingle();
  if (!tg) throw new Error(`타깃 "${label}"을 찾을 수 없습니다.`);

  const airs: Air[] = [];
  for (const p of PROGRAMS) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("ratings")
        .select("broadcast_date,start_time,rating,episode_subtitle,episode_number")
        .eq("program_id", p.id).eq("channel_id", channel.id).eq("target_id", tg.id)
        .eq("source_type", "nielsen_daily").gte("broadcast_date", START).not("rating", "is", null)
        .order("broadcast_date").order("start_time").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) airs.push({ program: p.name, short: p.short, date: r.broadcast_date, start: r.start_time, rating: r.rating, sub: r.episode_subtitle, ep: r.episode_number });
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
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const bcs: GeoBroadcast[] = [];
  for (const a of airs) {
    if (!a.sub || a.sub === "(없음)") continue;
    const norm = normalizeSubtitle(a.sub);
    let cls: Cls[] | null = null;
    let lv: "회차" | "기획" = "회차";
    const hit = byEp.get(norm);
    if (hit) cls = [hit];
    else {
      const sk = seriesKeys.find((k) => k.length >= 4 && norm.startsWith(k));
      if (sk) { cls = bySeries.get(sk)!; lv = "기획"; }
    }
    if (!cls) continue;
    const sl = slotOf(a.date, a.start);
    const b = base.get(`${a.program}|${sl.wd}|${sl.band}`)!;
    const bm = baseM.get(`${a.program}|${sl.wd}|${sl.band}|${sl.ym}`)!;
    const i = b.s > 0 ? a.rating / (b.s / b.n) : NaN;
    const m = bm.s > 0 ? a.rating / (bm.s / bm.n) : NaN;
    if (!Number.isFinite(i) || !Number.isFinite(m)) continue;

    // 도시·장소를 나라에 귀속(회차 단위 매칭만): 좌표표의 나라가 그 회차의 나라 목록에 있으면 그 나라,
    // 없고 회차가 한 나라뿐이면 그 나라(좌표 없음), 여러 나라인데 못 정하면 버린다.
    const pl: GeoBroadcast["pl"] = [];
    if (lv === "회차") {
      const c = cls[0];
      for (const name of new Set(c.places)) {
        const e = PLACES[name]?.find((x) => c.countries.includes(x[0]));
        const country = e ? e[0] : c.countries.length === 1 ? c.countries[0] : null;
        if (country) pl.push([name, country, e?.[1] ?? null, e?.[2] ?? null]);
      }
    }
    bcs.push({
      p: a.short, ep: a.ep, sub: a.sub, d: a.date, t: a.start.slice(0, 5), wd: sl.wd, band: sl.band,
      r: a.rating, m, i, k: `${a.short}|${norm}`, lv,
      rg: uniq(cls.flatMap((c) => c.region)), cs: uniq(cls.flatMap((c) => c.countries)),
      nat: uniq(cls.flatMap((c) => c.nature)), cul: uniq(cls.flatMap((c) => c.culture)), pl,
    });
  }

  return { period: `${START} ~ ${airs[airs.length - 1]?.date ?? START}`, target: label, targets: GEO_MAP_TARGETS, bcs };
}
