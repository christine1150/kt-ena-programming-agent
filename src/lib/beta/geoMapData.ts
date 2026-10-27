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
import schedule from "./geoSchedule.json";
import extra from "./geoExtra.json";
import timeTags from "./geoTimeTags.json";
import placeOverrides from "./geoPlaceOverrides.json";
import { alignDay, type SchedBlock } from "./geoScheduleMatch";

// 도시·장소 좌표표(scripts/olife-geo/places.txt에서 내보냄): 이름 → [[나라, 경도, 위도], ...]
const PLACES = geoPlaces as unknown as Record<string, [string, number, number][]>;

type Cls = { no?: number; auto?: boolean; p: string; oe: number | null; ti: string; ek: string; sk: string; region: string[]; countries: string[]; places: string[]; nature: string[]; culture: string[]; tm?: string[] };
const CLS = [...(classification as Cls[]), ...(extra as unknown as Cls[])]; // 수기 분류표 + 제목 기반 자동 분류(schedule-classify.mts, 분류표에 없는 회차만)
// 편성표 칸 조회표(scripts/olife-geo/schedule-parse.mts): "프로그램|달력날짜" → [[시작 분, 시작 회차, 끝 회차, 길이], ...]
// 편성표 회차 제목에서 뽑은 시기 태그("프로그램|회차" → 태그): 수기 분류표에 이미 있는 회차에 보탠다
// 사용자가 회차별로 지정한 장소(place-overrides.txt): "프로그램|회차" → [[이름, 나라, 경도, 위도], ...]
const PO = placeOverrides as unknown as Record<string, [string, string, number, number][]>;
const COUNTRY_REGION_APP: Record<string, string> = { 캐나다: "북미", 미국: "북미", 호주: "오세아니아" };
const TT = timeTags as unknown as Record<string, string[]>;
const SCHED = schedule as unknown as Record<string, SchedBlock[]>;

const PROGRAMS = [
  { id: "13a8a251-d8dc-4313-98fa-18b126aaaf0a", name: "걸어서 세계속으로", short: "걸세" },
  { id: "137c7a67-8c35-4d3f-8f0b-a1bd7dd1f2c2", name: "세계테마기행", short: "세테기" },
];
const START = "2025-01-01"; // 편성표(2025-02~)로 회차를 잇는다. 닐슨 부제(EPG)는 2026-07부터 채워진다
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
  tm: string[];     // 시기 태그(봄·여름·가을·겨울, 크리스마스·새해·부처님오신날 등 명절)
  pl: [string, string, number | null, number | null][]; // 도시·장소 [이름, 귀속 나라, 경도, 위도]
}

// 회차(k)마다 같은 값(부제·나라·테마·장소)은 한 번만 실어 JSON 크기를 줄인다. 화면이 방송 줄에 다시 합친다.
export type GeoEpisodeInfo = Pick<GeoBroadcast, "sub" | "lv" | "rg" | "cs" | "nat" | "cul" | "tm" | "pl">;
export type GeoBroadcastSlim = Omit<GeoBroadcast, keyof GeoEpisodeInfo>;
export interface GeoMapData {
  period: string;
  target: string;
  targets: string[];
  eps: Record<string, GeoEpisodeInfo>;
  bcs: GeoBroadcastSlim[];
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

  // 매칭 ① 편성표: 닐슨 행을 같은 날 편성표 '칸'(여러 회차 묶음 포함)과 짝지어 회차 번호를 얻고, 분류표의 OLIFE 회차로 잇는다(2025-02~).
  //      닐슨 부제(2026-07~)는 칸의 마지막 회차만 담기므로 편성표가 있으면 편성표를 우선한다.
  // 매칭 ② 닐슨 부제: 회차 키 → 기획 키(앞부분 일치, 4자 이상) — 편성표에 없는 날의 보완.
  const byEp = new Map<string, Cls>();
  const byNo = new Map<string, Cls>();
  const bySeries = new Map<string, Cls[]>();
  for (const c of CLS) {
    if (c.ek && !byEp.has(c.ek)) byEp.set(c.ek, c);
    if (c.oe != null && !byNo.has(`${c.p}|${c.oe}`)) byNo.set(`${c.p}|${c.oe}`, c);
    if (c.sk) { if (!bySeries.has(c.sk)) bySeries.set(c.sk, []); bySeries.get(c.sk)!.push(c); }
  }
  const seriesKeys = [...bySeries.keys()].sort((a, b) => b.length - a.length);
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

  // 닐슨 행 ↔ 편성표 칸
  const blockOf = new Map<Air, SchedBlock>();
  const byDay = new Map<string, Air[]>();
  for (const a of airs) { const k = `${a.short}|${a.date}`; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(a); }
  for (const [k, rows] of byDay) {
    const blocks = SCHED[k]; if (!blocks) continue;
    rows.sort((x, y) => x.start.localeCompare(y.start));
    const m = alignDay(rows.map((r) => Number(r.start.slice(0, 2)) * 60 + Number(r.start.slice(3, 5))), blocks);
    rows.forEach((r, i) => { if (m[i]) blockOf.set(r, m[i]!); });
  }

  const bcs: GeoBroadcast[] = [];
  for (const a of airs) {
    const sl = slotOf(a.date, a.start);
    const b = base.get(`${a.program}|${sl.wd}|${sl.band}`)!;
    const bm = baseM.get(`${a.program}|${sl.wd}|${sl.band}|${sl.ym}`)!;
    const i = b.s > 0 ? a.rating / (b.s / b.n) : NaN;
    const m = bm.s > 0 ? a.rating / (bm.s / bm.n) : NaN;
    if (!Number.isFinite(i) || !Number.isFinite(m)) continue;

    // (분류, 회차 번호, 표시 부제, 회차 묶음 키) 후보
    const cands: { cls: Cls[]; lv: "회차" | "기획"; ep: number | null; sub: string; k: string }[] = [];
    const blk = blockOf.get(a);
    if (blk) {
      for (let ep = blk[1]; ep <= blk[2]; ep++) {
        const c = byNo.get(`${a.short}|${ep}`);
        if (c) cands.push({ cls: [c], lv: c.auto ? "기획" : "회차", ep, sub: c.ti || c.ek, k: `${a.short}|${c.ek}` });
      }
    }
    if (!cands.length && a.sub && a.sub !== "(없음)") {
      const norm = normalizeSubtitle(a.sub);
      const hit = byEp.get(norm);
      if (hit) cands.push({ cls: [hit], lv: "회차", ep: a.ep, sub: a.sub, k: `${a.short}|${norm}` });
      else {
        const sk = seriesKeys.find((k) => k.length >= 4 && norm.startsWith(k));
        if (sk) cands.push({ cls: bySeries.get(sk)!, lv: "기획", ep: a.ep, sub: a.sub, k: `${a.short}|${norm}` });
      }
    }
    for (const cd of cands) {
      const cls = cd.cls;
      // 도시·장소를 나라에 귀속(회차 단위 매칭만): 좌표표의 나라가 그 회차의 나라 목록에 있으면 그 나라,
      // 없고 회차가 한 나라뿐이면 그 나라(좌표 없음), 여러 나라인데 못 정하면 버린다.
      const pl: GeoBroadcast["pl"] = [];
      if (cd.lv === "회차") {
        const c = cls[0];
        for (const name of new Set(c.places)) {
          const e = PLACES[name]?.find((x) => c.countries.includes(x[0]));
          const country = e ? e[0] : c.countries.length === 1 ? c.countries[0] : null;
          if (country) pl.push([name, country, e?.[1] ?? null, e?.[2] ?? null]);
        }
      }
      const po = cd.ep != null ? PO[`${a.short}|${cd.ep}`] : undefined;
      if (po) for (const [name, country, lon, lat] of po) if (!pl.some((x) => x[0] === name)) pl.push([name, country, lon, lat]);
      // 지정한 장소의 나라가 회차의 나라 목록에 없으면(예: 제목에 알래스카만 있는 로키 회차의 캐나다) 나라에도 보탠다
      const cs = uniq(cls.flatMap((c) => c.countries)), rg = uniq(cls.flatMap((c) => c.region));
      if (po) for (const [, country] of po) if (!cs.includes(country)) { cs.push(country); const r = COUNTRY_REGION_APP[country]; if (r && !rg.includes(r)) rg.push(r); }
      bcs.push({
        p: a.short, ep: cd.ep, sub: cd.sub, d: a.date, t: a.start.slice(0, 5), wd: sl.wd, band: sl.band,
        r: a.rating, m, i, k: cd.k, lv: cd.lv,
        rg, cs,
        nat: uniq(cls.flatMap((c) => c.nature)), cul: uniq(cls.flatMap((c) => c.culture)), tm: uniq([...cls.flatMap((c) => c.tm ?? []), ...(cd.ep != null ? TT[`${a.short}|${cd.ep}`] ?? [] : [])]), pl,
      });
    }
  }

  const eps: Record<string, GeoEpisodeInfo> = {};
  const slim: GeoBroadcastSlim[] = bcs.map(({ sub, lv, rg, cs, nat, cul, tm, pl, ...rest }) => { eps[rest.k] ??= { sub, lv, rg, cs, nat, cul, tm, pl }; return rest; });
  return { period: `${START} ~ ${airs[airs.length - 1]?.date ?? START}`, target: label, targets: GEO_MAP_TARGETS, eps, bcs: slim };
}
