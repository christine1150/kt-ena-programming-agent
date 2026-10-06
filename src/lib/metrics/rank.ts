// 순위의 종류를 분리한다(단계 02, 지표 계약 초안 §3 R1~R5). "주간 순위"라는 한 단어가 화면마다 다른 값을 뜻하던 문제(F01)를
// 막기 위해, 순위 값은 항상 종류·타깃·기간을 함께 들고 다니고 표시도 한 함수(formatRank)가 만든다.
import type { DailyValue } from "./aggregate";
import { datesIn } from "./period";

export type RankKind =
  | "official_period" // 공급자(닐슨) 주간·월간 파일의 공식 No.
  | "official_daily" // 공급자 일간 파일의 공식 No.
  | "daily_mean" // 일별 공식 순위의 평균(공식 기간 순위가 아님)
  | "peer_group" // 서비스 안 비교집단(등록 경쟁채널 등) 내부 순위
  | "goal" // 목표 순위
  | "estimated"; // 과거 분포로 추정한 기대 순위

export interface RankValue {
  kind: RankKind;
  /** official_*·peer_group·goal은 정수, daily_mean·estimated는 계산용 소수(표시는 항상 정수로 반올림) */
  value: number;
  targetLabel: string;
  /** 순위를 매긴 모집단(예: "시장 전체 채널", "등록 경쟁군 8곳") */
  universe: string;
  period: { from: string; to: string };
  /** daily_mean일 때 평균에 쓴 일수 */
  basedOnDays?: number;
  expectedDays?: number;
}

export const RANK_KIND_LABEL: Record<RankKind, string> = {
  official_period: "닐슨 기간 순위",
  official_daily: "닐슨 일간 순위",
  daily_mean: "일별 순위 평균",
  peer_group: "경쟁군 내 순위",
  goal: "목표 순위",
  estimated: "기대 순위(추정)",
};

/** 순위 표시. 순위는 항상 정수다(평균·추정 순위도 반올림). 공식 순위와 혼동되지 않도록 종류는 이름(일별 순위 평균 등)으로 구분한다. */
export function formatRank(r: RankValue, opts: { withKind?: boolean } = {}): string {
  const body = `${Math.round(r.value)}위`;
  if (r.kind === "daily_mean") {
    const cover = r.basedOnDays !== undefined && r.expectedDays !== undefined && r.basedOnDays < r.expectedDays ? ` · ${r.basedOnDays}/${r.expectedDays}일` : "";
    return `${RANK_KIND_LABEL.daily_mean} ${body}${cover}`;
  }
  return opts.withKind ? `${RANK_KIND_LABEL[r.kind]} ${body}` : body;
}

/** "(18/6)" 같은 모호한 표기 대신: 시장 순위와 목표 순위를 이름 붙여 함께 표시. */
export function formatRankVsGoal(market: number | null, goal: number | null): string {
  if (market === null && goal === null) return "—";
  if (goal === null) return `시장 ${market}위`;
  if (market === null) return `목표 ${goal}위`;
  return `시장 ${market}위 · 목표 ${goal}위`;
}

/** 순위 변동: 숫자가 작아질수록 상승. "▲3단계"처럼 방향과 단계를 분리해 표시. */
export function formatRankChange(before: number | null, after: number | null): string {
  if (before === null || after === null) return "비교 불가";
  const d = before - after;
  if (d === 0) return "유지";
  return `${d > 0 ? "▲" : "▼"}${Math.abs(d)}단계`;
}

/** 일별 순위 평균(R3). 결측일은 제외하고 수신 일수를 함께 돌려준다. */
export function dailyMeanRank(daily: DailyValue[], range: { from: string; to: string }, targetLabel: string, universe: string): RankValue | null {
  const byDate = new Map(daily.map((d) => [d.date, d.value]));
  const dates = datesIn(range);
  const vals = dates.map((d) => byDate.get(d)).filter((v): v is number => v !== null && v !== undefined);
  if (vals.length === 0) return null;
  return {
    kind: "daily_mean",
    value: vals.reduce((a, b) => a + b, 0) / vals.length,
    targetLabel,
    universe,
    period: range,
    basedOnDays: vals.length,
    expectedDays: dates.length,
  };
}

export interface WeeklyStat {
  rating: number | null;
  rank: RankValue | null;
  /** rating·rank의 출처 */
  source: "official" | "provisional_daily" | "none";
  /** 공식 값과 함께 계산한 일간 기반 잠정 시청률(대조용) */
  provisionalRating: number | null;
  note: string | null;
}

/** 한 주의 시청률·순위를 고른다. 같은 타깃의 공식 주간 값이 있으면 그것(순위는 official_period), 없을 때만 일간 기반 잠정값(일별 순위 평균)이다. */
export function selectWeeklyStat(args: {
  official: { rank: number | null; rating: number | null } | null;
  daily: { date: string; rating: number | null; rank: number | null }[];
  week: { from: string; to: string };
  targetLabel: string;
  universe: string;
}): WeeklyStat {
  const { official, daily, week, targetLabel, universe } = args;
  const ratings = daily.map((d) => ({ date: d.date, value: d.rating }));
  const present = ratings.filter((d) => d.value !== null) as { date: string; value: number }[];
  const provisionalRating = present.length > 0 ? present.reduce((a, d) => a + d.value, 0) / present.length : null;
  if (official && (official.rating !== null || official.rank !== null)) {
    return {
      rating: official.rating,
      rank: official.rank !== null ? { kind: "official_period", value: official.rank, targetLabel, universe, period: week } : null,
      source: "official",
      provisionalRating,
      note: null,
    };
  }
  const mean = dailyMeanRank(daily.map((d) => ({ date: d.date, value: d.rank })), week, targetLabel, universe);
  if (provisionalRating === null && !mean) return { rating: null, rank: null, source: "none", provisionalRating: null, note: null };
  return {
    rating: provisionalRating,
    rank: mean,
    source: "provisional_daily",
    provisionalRating,
    note: "공식 주간 값이 아직 없어 일간 값으로 계산한 잠정값입니다(순위는 일별 순위의 평균).",
  };
}
