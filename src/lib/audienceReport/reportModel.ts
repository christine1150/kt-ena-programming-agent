// Phase 6(2026-08-28, Audience Intelligence Report 계획서 J절 §11-6) — 리포트 데이터 모델.
// 설계서 §06의 원칙("모드마다 답해야 하는 질문이 다르므로 섹션 순서를 공유하지 않는다")을 그대로
// 타입에 반영한다 — 하나의 범용 스키마에 모든 필드를 옵셔널로 두지 않고, 모드별 유니온 타입으로
// 나눠 렌더러가 실수로 없는 섹션을 그리지 않게 한다. 필드 이름 자체가 곧 §06의 섹션 순서다.
import type { QualityIssue } from "./validate";
import type { ChannelMasterInfo } from "./masterData";
import type { ResolvedAudiencePeriod } from "./periodResolver";
import type { CoverageInfo, GenreHourRow, GenrePerformanceRow, ProgramContributionRow } from "./skyUhdCross";
import type { DailyOutlierVerdict, StructuralVerdict, TurningPoint } from "./analyzer";

/** 값이 원래 없는(구조적으로 해당 없음) 경우와 "0건"을 구분한다 — §10 "빈 상태를 설계한다" 원칙.
 *  reason은 화면에 그대로 노출되는 사유 문장이다("skyUHD는 프로그램 단위 자료가 제한적입니다" 등). */
export type Maybe<T> = { available: true; data: T } | { available: false; reason: string };

// 모든 차트가 강제로 붙여야 하는 3종 표기(§10 공통 원칙: 분석 기간·Target Universe·측정 기준).
export interface ChartCaptionInfo {
  periodLabel: string;
  targetUniverse: string;
  measure: string;
}

export interface KpiCard {
  label: string; // "Rating" | "Share" | "Reach" | "시청시간" | "순위"
  formatted: string;
  priorDeltaPct: number | null; // 전일(MODE A) / 직전 동일 길이 기간(MODE B/D) / 기간B(MODE C)
  baselineDeltaPct: number | null; // 최근 12주 평균 대비(§06 MODE A "최근 4주 평균" 요구를 이미 있는
  // 12주 기준선으로 대체했다 — 정직한 v1 단순화, "정직하게 밝히는 한계" 참고)
  sameWeekdayDeltaPct?: number | null; // MODE A 전용 3번째 비교축(전주 동일요일) — 다른 모드는 undefined
}

export interface HourlyProfilePoint {
  hour: number;
  todayRating: number | null;
  baselineRating: number | null; // 최근 12주 같은 시간대 평균(보강 조회)
  programNames: string | null;
}

export interface SlotDeviationRow {
  hour: number;
  programNames: string;
  todayRating: number | null;
  baselineRating: number | null;
  deviationPct: number | null; // (오늘-기준선)/기준선 — "그 슬롯의 평소 수준 대비"를 시간대 단위로 근사
}

export interface AudienceReactionRow {
  targetLabel: string;
  value: number | null;
  deltaPct: number | null;
}

export interface CompetitorInsightRow {
  competitorName: string;
  todayRank: number | null;
  todayRating: number | null;
  baselineAvgRating: number | null;
  deltaPct: number | null;
  topProgramName: string | null;
  topProgramStartTime: string | null;
  topProgramRating: number | null;
}

// 오리지널/독점 리뷰 — originalContent.ts의 원본 행을 그대로 실어 렌더러가 §03 삽입 규칙대로 쓴다.
export interface OriginalReviewSection {
  works: import("./originalContent").FeaturedContentWork[];
  dailyReview: import("./originalContent").DailyOriginalReviewRow[]; // MODE A만 채워짐
  episodeTrends: { canonicalName: string; points: import("./originalContent").EpisodePoint[] }[]; // MODE B/C/D
}

export interface EnaLiveAiringSection {
  matchedRating: number | null;
  matchedShare: number | null;
  matchedHouseholdRating: number | null;
  ageBreakdown: unknown;
  programName: string | null;
}

// skyUHD 전용 대체 섹션 블록(§05) — 프로그램/타깃 축이 비는 자리에 대신 끼워 넣는다.
export interface SkyUhdSubstituteSection {
  genrePerformance: GenrePerformanceRow[];
  genreHourCrossing: GenreHourRow[];
  programContribution: ProgramContributionRow[];
  coverage: CoverageInfo;
}

// ---------------- MODE A(하루) — §06 01~09 순서 그대로 ----------------
export interface ModeASection {
  verdict: DailyOutlierVerdict; // 01 한 줄 판정
  kpiCards: KpiCard[]; // 02 그날의 숫자
  hourlyProfile: Maybe<{ points: HourlyProfilePoint[]; caption: ChartCaptionInfo }>; // 03 시간대 프로파일(차트 필수)
  programsBySlotDeviation: Maybe<{ top: SlotDeviationRow[]; bottom: SlotDeviationRow[] }>; // 04 그날의 프로그램
  originalReview: Maybe<OriginalReviewSection>; // 05 (Group A만)
  enaLiveAiring: Maybe<EnaLiveAiringSection>; // 06 (ENA 채널만)
  audienceReaction: Maybe<AudienceReactionRow[]>; // 07 타깃 반응
  competitorSameSlot: Maybe<CompetitorInsightRow[]>; // 08 동시간대 경쟁
  thingsToVerify: string[]; // 09 확인해야 할 것(단정 없는 관찰 목록)
  skyUhd: Maybe<SkyUhdSubstituteSection>; // skyUHD 대체 블록(해당 채널만)
}

// ---------------- MODE B(시작~끝) — §06 01~10 순서 그대로 ----------------
export interface DailyTrendChartPoint {
  date: string;
  rating: number | null;
  movingAvg: number | null;
}
export interface WeekdayHourCell {
  dow: number;
  dowLabel: string;
  hourBlock: number;
  avgRating: number | null;
  sampleCount: number;
}
export interface BestWorstDayDetail {
  date: string;
  rating: number | null;
  hourlyPoints: { hour: number; rating: number | null }[];
  programNames: string[];
}
export interface ModeBSection {
  summary: { avgRating: number | null; shape: "상승" | "하락" | "횡보" | "변동" }; // 01 기간 요약
  kpiCards: KpiCard[]; // 02 기간 스코어카드
  dailyTrend: { points: DailyTrendChartPoint[]; caption: ChartCaptionInfo }; // 03 일자별 추이(차트 필수)
  weekdayHourHeatmap: Maybe<{ cells: WeekdayHourCell[]; caption: ChartCaptionInfo }>; // 04 요일×시간대(차트 필수)
  originalReview: Maybe<OriginalReviewSection>; // 05
  enaLiveAiring: Maybe<EnaLiveAiringSection>; // 06
  programContribution: Maybe<{ growth: import("./dataCollector").ProgramMoverRow[]; weakness: import("./dataCollector").ProgramMoverRow[] }>; // 07 프로그램 기여도
  audienceComposition: Maybe<AudienceReactionRow[]>; // 08 타깃 구성
  bestWorstDay: Maybe<{ best: BestWorstDayDetail | null; worst: BestWorstDayDetail | null }>; // 09 최고일·최저일 해부
  structuralVerdict: StructuralVerdict; // 10 일시적 vs 구조적
  skyUhd: Maybe<SkyUhdSubstituteSection>;
}

// ---------------- MODE C(기간 A vs 기간 B) — §06 01~08 순서 그대로 ----------------
export interface KpiCompareRow {
  label: string;
  periodA: number | null;
  periodB: number | null;
  absoluteChange: number | null;
  pctChange: number | null;
  formattedA: string;
  formattedB: string;
}
export interface ProgramChangeRow {
  canonicalName: string;
  kind: "신규" | "종영" | "유지";
  periodAvgRating: number | null;
  priorAvgRating: number | null;
  ratingDelta: number | null;
}
export interface HourBlockDeltaRow {
  hourBlock: number;
  periodA: number | null;
  periodB: number | null;
  delta: number | null;
}
export interface ModeCSection {
  changeSummary: { direction: "up" | "down" | "flat"; magnitude: number | null; topContributor: string | null; lengthMismatchNote: string | null }; // 01
  kpiCompareTable: { rows: KpiCompareRow[]; caption: ChartCaptionInfo }; // 02(차트 필수 — Slope chart)
  changeBreakdown: ProgramChangeRow[]; // 03 변화 분해(신규/종영/유지)
  originalReviewCompare: Maybe<{ periodA: OriginalReviewSection; periodB: OriginalReviewSection }>; // 04
  hourBlockShift: { rows: HourBlockDeltaRow[]; caption: ChartCaptionInfo }; // 05(차트 필수)
  audienceShift: Maybe<{ label: string; periodA: number | null; periodB: number | null; delta: number | null }[]>; // 06 타깃 이동
  schedulingDifference: { newPrograms: string[]; endedPrograms: string[] }; // 07 편성 자체의 차이
  ratingShareSplit: { ratingDirection: "up" | "down" | "flat"; shareDirection: "up" | "down" | "flat"; note: string | null }; // 08
  skyUhd: Maybe<{ periodA: SkyUhdSubstituteSection; periodB: SkyUhdSubstituteSection }>;
}

// ---------------- MODE D(누적·트레일링·주기비교) — §06 01~08 순서 그대로 ----------------
export interface ComparisonMatrixRow {
  preset: "dod" | "wow" | "mom" | "qoq" | "yoy";
  label: string;
  currentAvg: number | null;
  priorAvg: number | null;
  changePct: number | null;
}
export interface CumulativeConvergencePoint {
  date: string;
  cumulativeAvg: number | null;
  recentAvg: number | null;
}
export interface BreakdownRow {
  label: string; // 월/분기/주 라벨
  avgRating: number | null;
  daysWithData: number;
}
export interface ModeDSection {
  currentPosition: { cumulativeAvg: number | null; targetRating: number | null; gapToTarget: number | null; daysRemaining: number | null }; // 01
  kpiCards: KpiCard[]; // 02 누적 스코어카드(+ 누적 순위는 rankAvg로 kpiCards에 포함)
  convergence: { points: CumulativeConvergencePoint[]; caption: ChartCaptionInfo }; // 03(차트 필수)
  comparisonMatrix: { rows: ComparisonMatrixRow[]; caption: ChartCaptionInfo }; // 04(차트 필수)
  breakdown: { granularity: "week" | "month" | "quarter"; rows: BreakdownRow[] }; // 05 구간 분해
  originalLineup: Maybe<OriginalReviewSection>; // 06
  turningPoints: TurningPoint[]; // 07
  topContributors: import("./dataCollector").ProgramMoverRow[]; // 08 누적 기여 상위
  skyUhd: Maybe<SkyUhdSubstituteSection>;
}

export type AudienceReportBody =
  | { mode: "single_day"; sections: ModeASection }
  | { mode: "range"; sections: ModeBSection }
  | { mode: "compare"; sections: ModeCSection }
  | { mode: "cumulative"; sections: ModeDSection };

// ---------------- 편성 제언(§08) — 모든 모드에 항상 붙는 마무리 섹션, §06 번호 목록과는 별개 ----------------
export interface WeekdayFlowPoint {
  dowLabel: string; // "월"~"일"
  avgRating: number | null;
}
export interface SlotDiagnosisRow {
  hourBlock: number;
  diagnosis: import("./analyzer").HourBlockDiagnosis | null;
  gapChange: number | null;
}
export interface RecommendationItem {
  basis: string;
  suggestion: string;
  verification: string;
}
export interface RecommendationSection {
  title: string; // "지난주 → 이번주 편성 제언" | "지난달 → 이번달 편성 제언"
  referenceWindow: { dateFrom: string; dateTo: string };
  channelFlow: { trend: import("./dataCollector").DailyTrendPoint[]; weekdayFlow: WeekdayFlowPoint[] };
  programFlow: Maybe<{ growth: import("./dataCollector").ProgramMoverRow[]; weakness: import("./dataCollector").ProgramMoverRow[] }>;
  lineupTransitions: Maybe<import("./originalContent").LineupTransition[]>;
  slotDiagnosis: SlotDiagnosisRow[];
  recommendations: RecommendationItem[];
}

export interface AudienceReportDocument {
  channelCode: string;
  channelName: string;
  groupCode: "A" | "B";
  groupLabel: string;
  period: ResolvedAudiencePeriod;
  masterInfo: ChannelMasterInfo;
  qualityIssues: QualityIssue[];
  body: AudienceReportBody;
  recommendation: RecommendationSection;
}
