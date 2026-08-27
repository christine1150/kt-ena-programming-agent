// Phase 2(2026-08-28, Audience Intelligence Report 계획서 J절) — "판정·순위·라벨링"만 담당한다.
// dataCollector.ts가 모아온 원본(전부 DB가 이미 계산한 값)에서 max/min을 고르거나 정렬만 할 뿐,
// 시청률·점유율 등 어떤 지표도 다시 계산하지 않는다 — channelReport.ts의 computeWinWeakness()/
// computeTurningPoints()와 같은 설계 원칙("이미 검증된 값을 TS에서 라벨링만"). 이 두 함수와
// 이름·모양이 비슷한 이유가 그것이다 — 다만 Phase 1의 결정대로 channelReport.ts는 건드리지 않고
// 이 새 시스템 안에 독립적으로(작은 순수 함수라 중복 비용보다 시스템 분리 이득이 크다는 판단)
// 다시 작성했다.
import type { DailyTrendPoint, HourlyPatternRow, HourlyProgramTitleRow, ProgramMoverRow } from "./dataCollector";

// channelReport.ts의 DAYPART_LABEL과 같은 고정 구간(get_channel_daypart_opportunity가 쓰는 것과
// 동일) — 새 구간 정의 없이 그대로 재사용(문자열만 이 파일 안에 다시 적음, 로직 재사용 아님).
const DAYPART_LABEL: Record<string, string> = {
  새벽: "새벽(02~08시)",
  오전: "오전(09~13시)",
  오후: "오후(14~18시)",
  저녁_심야: "저녁·심야(19~25시)",
};

export interface DaypartVerdict {
  daypartLabel: string;
  gapChange: number;
}
/** 1. daypart별 경쟁채널 대비 격차 변화(gap_change) 중 최대/최소를 WIN/WEAKNESS로 고른다. */
export function computeDaypartWinWeakness(daypartOpportunity: { daypart: string; gap_change: number | null }[]): {
  win: DaypartVerdict | null;
  weakness: DaypartVerdict | null;
} {
  const valid = daypartOpportunity.filter((d): d is { daypart: string; gap_change: number } => d.gap_change !== null);
  if (valid.length === 0) return { win: null, weakness: null };
  const winRow = valid.reduce((a, b) => (b.gap_change > a.gap_change ? b : a));
  const weaknessRow = valid.reduce((a, b) => (b.gap_change < a.gap_change ? b : a));
  return {
    win: { daypartLabel: DAYPART_LABEL[winRow.daypart] ?? winRow.daypart, gapChange: winRow.gap_change },
    weakness: { daypartLabel: DAYPART_LABEL[weaknessRow.daypart] ?? weaknessRow.daypart, gapChange: weaknessRow.gap_change },
  };
}

export interface PeakSlot {
  broadcastHour: number;
  avgRating: number | null;
  programNames: string | null;
}
/** 2. 시간대별 평균 시청률(hourlyPattern)이 가장 높은 시간을 고르고, 그 시간에 편성된 프로그램명을 붙인다. */
export function computePeakSlot(hourlyPattern: HourlyPatternRow[], hourlyProgramTitles: HourlyProgramTitleRow[]): PeakSlot | null {
  const valid = hourlyPattern.filter((h): h is HourlyPatternRow & { avgRating: number } => h.avgRating !== null);
  if (valid.length === 0) return null;
  const peak = valid.reduce((a, b) => (b.avgRating > a.avgRating ? b : a));
  const titleRow = hourlyProgramTitles.find((t) => t.broadcastHour === peak.broadcastHour);
  return { broadcastHour: peak.broadcastHour, avgRating: peak.avgRating, programNames: titleRow?.programNames ?? null };
}

/** 3. programMovers를 ratingDelta 기준으로 상승/하락 상위 N개씩 나눈다(기본 3 — 설계서 §03/§06의
 *  "성장/약세 동력" 개수). null delta는 판정 대상에서 제외. */
export function computeGrowthWeaknessMovers(programMovers: ProgramMoverRow[], limit = 3): { growth: ProgramMoverRow[]; weakness: ProgramMoverRow[] } {
  const valid = programMovers.filter((m): m is ProgramMoverRow & { ratingDelta: number } => m.ratingDelta !== null);
  const growth = valid
    .filter((m) => m.ratingDelta > 0)
    .sort((a, b) => b.ratingDelta - a.ratingDelta)
    .slice(0, limit);
  const weakness = valid
    .filter((m) => m.ratingDelta < 0)
    .sort((a, b) => a.ratingDelta - b.ratingDelta)
    .slice(0, limit);
  return { growth, weakness };
}

export interface AudienceHighlight {
  targetLabel: string;
  periodAvgRating: number | null;
  deltaPct: number | null;
  kind: "most_watched" | "most_moved";
}
/** 4. 가장 많이 본 연령대 2개 + 등락폭이 가장 큰 연령대 2개(mostWatched와 중복되면 제외) —
 *  channelReport.ts의 audienceHighlights와 같은 선정 방식. */
export function computeAudienceHighlights(
  demographics: { target_label: string; period_avg_rating: number | null; prior_avg_rating: number | null; delta_pct: number | null }[]
): AudienceHighlight[] {
  const mostWatched = [...demographics].sort((a, b) => (b.period_avg_rating ?? -Infinity) - (a.period_avg_rating ?? -Infinity)).slice(0, 2);
  const mostMoved = [...demographics]
    .filter((d) => !mostWatched.some((m) => m.target_label === d.target_label))
    .sort((a, b) => Math.abs(b.delta_pct ?? 0) - Math.abs(a.delta_pct ?? 0))
    .slice(0, 2);
  return [
    ...mostWatched.map((d) => ({ targetLabel: d.target_label, periodAvgRating: d.period_avg_rating, deltaPct: d.delta_pct, kind: "most_watched" as const })),
    ...mostMoved.map((d) => ({ targetLabel: d.target_label, periodAvgRating: d.period_avg_rating, deltaPct: d.delta_pct, kind: "most_moved" as const })),
  ];
}

// buildChannelNarrative(Dashboard.tsx)/channelHealthScore.ts가 이미 쓰는 것과 같은 임계값(±15%) —
// 새 기준을 발명하지 않고 이 프로젝트 전반의 "뚜렷한 변화" 기준을 그대로 재사용한다.
const OUTLIER_THRESHOLD_PCT = 15;

export interface DailyOutlierVerdict {
  isOutlier: boolean;
  direction: "up" | "down" | null;
  changePct: number | null;
  label: string; // "최근 12주 평균 대비 ▲84.4%로 이상치" / "평소와 비슷한 수준" 같은 짧은 문구
}
/** 5. MODE A "한 줄 판정" — 오늘 시청률이 baseline(최근 12주 평균 등) 대비 임계값 이상 벗어났는지. */
export function computeDailyOutlierVerdict(todayRating: number | null, baselineAvgRating: number | null, thresholdPct = OUTLIER_THRESHOLD_PCT): DailyOutlierVerdict {
  if (todayRating === null || baselineAvgRating === null || baselineAvgRating === 0) {
    return { isOutlier: false, direction: null, changePct: null, label: "비교 가능한 데이터 없음" };
  }
  const changePct = ((todayRating - baselineAvgRating) / baselineAvgRating) * 100;
  const isOutlier = Math.abs(changePct) >= thresholdPct;
  const direction = changePct >= 0 ? "up" : "down";
  const label = isOutlier
    ? `최근 평균 대비 ${direction === "up" ? "▲" : "▼"}${Math.abs(changePct).toFixed(1)}%로 평소와 다른 하루`
    : `최근 평균과 비슷한 수준(${direction === "up" ? "▲" : "▼"}${Math.abs(changePct).toFixed(1)}%)`;
  return { isOutlier, direction, changePct, label };
}

export interface StructuralVerdict {
  verdict: "structural" | "temporary" | "insufficient_data";
  label: string;
}
/** 6. MODE B "일시적 vs 구조적" — v1 휴리스틱(Health Score/Turning Point와 같은 설계 원칙, 추후
 *  조정 가능). 정의: 기간 전체를 앞/뒤 절반으로 나눠 평균을 비교해 방향을 구한다. 그 다음 평균에서
 *  가장 크게 벗어난(=가장 극단적인) 포인트 1개를 빼고 같은 방식으로 방향을 다시 구한다 — 두
 *  방향이 같으면 "구조적"(단일 이벤트 하나로 뒤집히지 않는 추세), 다르면 "일시적"(그 하루가
 *  추세 자체를 만듦)으로 라벨링한다. 포인트 3개 미만이면 판정하지 않는다. */
export function computeStructuralVsTemporary(trend: DailyTrendPoint[]): StructuralVerdict {
  const valid = trend.filter((t): t is DailyTrendPoint & { avgRating: number } => t.avgRating !== null);
  if (valid.length < 3) return { verdict: "insufficient_data", label: "판정에 필요한 데이터(3개 이상 구간)가 부족합니다" };

  function halfDirection(points: { avgRating: number }[]): number {
    const mid = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, mid || 1);
    const secondHalf = points.slice(mid || 1);
    const avg = (arr: { avgRating: number }[]) => arr.reduce((s, p) => s + p.avgRating, 0) / arr.length;
    return avg(secondHalf) - avg(firstHalf);
  }

  const overallDirection = halfDirection(valid);
  const mean = valid.reduce((s, p) => s + p.avgRating, 0) / valid.length;
  const mostExtreme = valid.reduce((a, b) => (Math.abs(b.avgRating - mean) > Math.abs(a.avgRating - mean) ? b : a));
  const withoutExtreme = valid.filter((p) => p !== mostExtreme);
  if (withoutExtreme.length < 2) return { verdict: "insufficient_data", label: "판정에 필요한 데이터(3개 이상 구간)가 부족합니다" };
  const directionWithoutExtreme = halfDirection(withoutExtreme);

  const sameDirection = Math.sign(overallDirection) === Math.sign(directionWithoutExtreme) || (overallDirection === 0 && directionWithoutExtreme === 0);
  return sameDirection
    ? { verdict: "structural", label: "가장 튄 하루를 빼도 같은 방향 — 구조적인 추세로 보입니다" }
    : { verdict: "temporary", label: `가장 튄 하루(${mostExtreme.date})를 빼면 추세가 바뀝니다 — 그 하루가 만든 일시적 변화일 수 있습니다` };
}

export interface ProgramHourCrossingRow {
  broadcastHour: number;
  programs: string[];
}
/** 7. "시간대×프로그램" 표를 위한 순수 reshape — hourlyProgramTitles의 "/" 조인 문자열을 배열로. */
export function reshapeProgramHourCrossing(hourlyProgramTitles: HourlyProgramTitleRow[]): ProgramHourCrossingRow[] {
  return hourlyProgramTitles.map((row) => ({
    broadcastHour: row.broadcastHour,
    programs: row.programNames
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  }));
}

export interface TurningPoint {
  periodStart: string;
  direction: "up" | "down";
  changePct: number;
  fromRating: number;
  toRating: number;
}
// Phase 6(2026-08-28, 계획서 J절 §06 MODE D "변곡점") — channelReport.ts(구 시스템)의 동명 함수와
// 정확히 같은 v1 임계값 로직(연속 포인트 등락률 ±15% 이상만, 상위 5개)을 이 시스템 안에 작게
// 다시 작성했다(Phase 1의 "완전히 별개로 유지" 결정 그대로 — computeDaypartWinWeakness 등과 같은
// 패턴). 새 기준 발명 아님, OUTLIER_THRESHOLD_PCT(15)와 같은 값.
export function computeTurningPoints(trend: DailyTrendPoint[], thresholdPct = OUTLIER_THRESHOLD_PCT): TurningPoint[] {
  const points: TurningPoint[] = [];
  for (let i = 1; i < trend.length; i++) {
    const prev = trend[i - 1].avgRating;
    const curr = trend[i].avgRating;
    if (prev === null || curr === null || prev === 0) continue;
    const changePct = ((curr - prev) / prev) * 100;
    if (Math.abs(changePct) >= thresholdPct) {
      points.push({ periodStart: trend[i].date, direction: changePct >= 0 ? "up" : "down", changePct, fromRating: prev, toRating: curr });
    }
  }
  return points.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 5);
}
