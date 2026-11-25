// 시즌 비교(사용자 지시 2026-11-25): "<크래시2: 분노의 도로> 설명 시 <크래시1> 성과도 함께 고려해 코멘트. 2049나 가구에서
// 지난 시즌보다 더 좋은 성과이거나 최고 성과면 반드시 코멘트." — 주요 콘텐츠 리뷰에 붙는 순수 계산(DB·LLM 없음).
// 지난 시즌 값은 DB 자료 첫날(2025-01-01) 이전 방영이라 DB에 없어, 사용자가 제공한 값을 아래 기준표에 둔다(출처 명시).
// 기준표에 없는 값(회차별·가구 등)은 만들거나 추정하지 않고, 그 비교는 생략한다.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { formatRatingValue } from "@/lib/ui/metricFormat";

export interface SeasonStats {
  avg: number;
  max: number;
  maxEp: number;
  min?: number;
  minEp?: number;
  /** 1~6회 평균·7~12회 평균처럼 구간 평균(전체 회차를 반으로 나눈 값) */
  firstHalfAvg?: number;
  lastHalfAvg?: number;
  /** 알려진 회차별 값(전부 있을 필요 없음) */
  byEpisode?: Record<number, number>;
}

export interface SeasonReference {
  channelCode: string;
  /** 이번 시즌 제목의 앞부분(부제 제외, 정규화해서 비교) */
  currentBase: string;
  prevLabel: string;
  aired: string;
  episodes: number;
  source: string;
  p2049: SeasonStats;
  /** 가구 값은 제공받으면 채운다(없으면 가구 비교는 하지 않는다) */
  household?: SeasonStats;
}

export const SEASON_REFERENCES: SeasonReference[] = [
  {
    channelCode: "ENA",
    currentBase: "크래시2",
    prevLabel: "크래시 시즌1",
    aired: "2024-05-13~2024-06-18",
    episodes: 12,
    source: "사용자 제공 콘텐츠 편성센터 화면(수도권 개인2049, 2026-11-25)",
    p2049: { avg: 1.244, max: 1.88, maxEp: 12, min: 0.683, minEp: 1, firstHalfAvg: 0.971, lastHalfAvg: 1.517, byEpisode: { 1: 0.683, 12: 1.88 } },
  },
];

export function findSeasonReference(channelCode: string, programName: string): SeasonReference | null {
  const n = normalizeProgramCanonicalName(programName);
  for (const r of SEASON_REFERENCES) {
    if (r.channelCode !== channelCode) continue;
    const b = normalizeProgramCanonicalName(r.currentBase);
    if (n === b || (n.startsWith(b) && !/\d/.test(n.charAt(b.length)))) return r;
  }
  return null;
}

/** 이번 시즌 회차별 값(방송 순서, 오늘 회차가 마지막) */
export interface SeasonCurrent {
  p2049: number[];
  household: number[];
}

export interface SeasonCompareResult {
  /** 화면에 그대로 보이는 문장(여러 줄이면 줄바꿈) */
  lines: string[];
  /** 지난 시즌보다 높거나 최고 기록이면 true — 반드시 코멘트해야 하는 경우 */
  notable: boolean;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function compareOne(label: string, code: string, ref: SeasonReference, s: SeasonStats, cur: number[], prefix: string): { lines: string[]; flags: string[] } {
  const f = (v: number | null | undefined) => formatRatingValue(v ?? null, code, { unit: true });
  const k = cur.length;
  const lines: string[] = [];
  const flags: string[] = [];
  if (k === 0) return { lines, flags };
  const today = cur[k - 1];
  const curAvg = mean(cur) as number;
  const curMaxBefore = k >= 2 ? Math.max(...cur.slice(0, k - 1)) : null;

  // ① 같은 회차 값이 기준표에 있으면 그 회차끼리 — 없으면 구간 평균·전체 평균 중 비교 가능한 것
  const sameEp = s.byEpisode?.[k];
  let basisText = "";
  let basisAvg: number | null = null;
  if (k === 1 && sameEp !== undefined) {
    basisAvg = sameEp;
    basisText = `${prefix}1회 ${f(sameEp)}`;
  } else if (k <= Math.floor(ref.episodes / 2) && s.firstHalfAvg !== undefined) {
    basisAvg = s.firstHalfAvg;
    basisText = `${prefix}1~${Math.floor(ref.episodes / 2)}회 평균 ${f(s.firstHalfAvg)}`;
  } else {
    basisAvg = s.avg;
    basisText = `${prefix}전체 평균 ${f(s.avg)}`;
  }
  const ratio = basisAvg > 0 ? Math.round((curAvg / basisAvg) * 100) : null;
  const curText = k === 1 ? `1회 ${f(today)}` : `${k}회까지 평균 ${f(curAvg)}`;
  lines.push(`${label} ${curText}는 ${basisText}${ratio !== null ? `의 ${ratio}%` : ""}${curAvg > basisAvg ? " — 지난 시즌보다 높음" : curAvg < basisAvg ? " 수준에는 못 미침" : "와 같음"}`);
  if (curAvg > basisAvg) flags.push(`${label} ${curText}로 ${basisText}를 웃돌아 지난 시즌보다 좋은 성과`);

  // ② 같은 회차 값이 있는 회차(2회 이상 비교)는 따로
  if (k >= 2 && sameEp !== undefined) {
    if (today > sameEp) flags.push(`${label} ${k}회 ${f(today)}가 ${prefix}${k}회 ${f(sameEp)}보다 높음`);
    else lines.push(`${label} ${k}회 ${f(today)}는 ${prefix}${k}회 ${f(sameEp)}에 못 미침`);
  }

  // ③ 최고 기록 — 시리즈(지난 시즌 포함) 최고 / 이번 시즌 자체 최고
  if (today > s.max) flags.push(`${label} ${f(today)}로 ${prefix}최고(${f(s.max)}, ${s.maxEp}회)를 넘어선 시리즈 최고 시청률`);
  else if (curMaxBefore !== null && today > curMaxBefore) flags.push(`${label} ${f(today)}로 이번 시즌 자체 최고(${prefix}최고는 ${f(s.max)})`);
  return { lines, flags };
}

/** 기준표 + 이번 시즌 값 → 코멘트. 이번 시즌 값이 없으면 null. */
export function buildSeasonCompare(ref: SeasonReference, channelCode: string, cur: SeasonCurrent): SeasonCompareResult | null {
  if (cur.p2049.length === 0 && cur.household.length === 0) return null;
  const head = `<${ref.prevLabel}>(${ref.aired.replace(/-/g, ".")},${ref.episodes}회)`;
  const a = compareOne("수도권 2049", channelCode, ref, ref.p2049, cur.p2049, `시즌1 `);
  const b = ref.household ? compareOne("가구", channelCode, ref, ref.household, cur.household, `시즌1 `) : { lines: [], flags: [] };
  const lines: string[] = [];
  const base = [...a.lines, ...b.lines];
  if (base.length > 0) lines.push(`${head} 대비: ${base.join(" / ")}.`);
  const flags = [...a.flags, ...b.flags];
  if (flags.length > 0) lines.push(`${flags.map((x) => `▲ ${x}`).join(" · ")}.`);
  if (lines.length === 0) return null;
  return { lines, notable: flags.length > 0 };
}
