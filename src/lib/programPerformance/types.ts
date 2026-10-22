// 프로그램 성과(작품 × 채널 비교) — 입출력 타입. 순수 데이터 구조(서버·클라이언트 공용).
// 설계·지표 정의: docs/ena-features-plan.md §3·§4
import type { BaselineLevel } from "@/lib/contentFit/types";

// v1.1(2026-10-22): 계산식은 v1 그대로, 응답에 월간 추이(monthly) 추가
// v1.2(2026-10-22): 두 타깃 모드(both)·채널별 첫 줄(lines, 그룹 요약 headlines 대체) — 계산식 무변경, 캐시가 섞이지 않게 버전만 올림
// v1.3(2026-10-22): 행마다 점유율 평균·분석(analysis: 회차 추이·최고/최저·시간대별 비교·종합 문구) 추가 — 기존 값의 계산식 무변경
// v1.4(2026-10-22): 첫 줄을 채널당 한 줄(2049·가구 함께)로, 경쟁 채널 성과(competitors) 추가 — 자사 값 계산식 무변경
// v1.5(2026-10-22): 첫 줄 형식(지수 %)·pieces, 본방 추이(firstRuns), 기간 preset — 자사 값 계산식 무변경
// v1.6(2026-10-22): 편성 비교 문구를 본방 시간 기준 한 문장(slotParts)으로, 종합 평가를 겹치지 않는 인사이트(insights)로 — 자사 값 계산식 무변경
// v1.7(2026-10-22): 본방 여부·회차가 비어 있는 방영을 업로드 편성표([본]·[재])로 보완
export const PROGRAM_PERFORMANCE_VERSION = "program-performance-v1.7";

/** 작품 분류(승인 메타데이터 = 관리자 업로드 "KT ENA 오리지널" 시트 → featured_content). 미확인은 비오리지널로 확정하지 않는다. */
export type WorkClass = "ORIGINAL_DRAMA" | "ORIGINAL_VARIETY" | "OTHER_FEATURED" | "UNCONFIRMED" | "CONFLICT";

export interface WorkClassification {
  cls: WorkClass;
  /** 원문 분류값(featured_content.category) 목록 */
  categories: string[];
  source: string;
  note: string;
}

/** all=전체, first=<본> 표시 방영, rerun=<본> 표시가 없는 방영(재방·태그 없음) */
export type AiringFilter = "all" | "first" | "rerun";
/** kpi=채널 KPI 타깃만, both=채널마다 KPI 타깃+다른 그룹 타깃(수도권 2049·전국 유료가구 둘 다), common*=전 채널 같은 타깃 */
export type TargetMode = "kpi" | "both" | "common2049" | "commonHH";

export interface PerformanceQuery {
  groupKey: string;
  channels: string[] | null; // null = 전체
  from: string | null; // null = 보유 자료 전체(작품 첫 관측일부터)
  to: string | null; // null = 최신 자료일
  /** from이 없을 때 최신 자료일 기준 최근 4주(28일)·12주(84일) — 화면이 최신 자료일을 몰라도 첫 조회부터 기간을 맞춘다 */
  preset?: "4w" | "12w" | null;
  airing: AiringFilter;
  targetMode: TargetMode;
}

/** 채널 행 상태 — 기록이 없다는 이유로 미방영·0을 확정하지 않는다. */
export type ChannelStatus =
  | "OBSERVED" // 실적 확인
  | "NO_OBSERVATION" // 해당 기간 관측 없음
  | "NO_PROGRAM_DATA" // 그 채널 프로그램 단위 자료 없음(ENA Story 일부 기간 등)
  | "UNSUPPORTED" // 이번 범위에서 계산하지 않음(skyUHD 수기 자료·타깃 없음)
  | "NO_TARGET"; // 선택 타깃의 프로그램 행이 없음

export type Direction = "HIGHER" | "SIMILAR" | "LOWER" | "NA";

export interface RatioValue {
  /** 분자(작품 방영별 평균 또는 ΣR) */
  value: number | null;
  /** 분모(기준값) */
  base: number | null;
  ratio: number | null;
  /** (ratio − 1) × 100 */
  pct: number | null;
  /** value − base (%p) */
  diff: number | null;
  direction: Direction;
  /** 산출 불가 사유(기준값 0/NULL·자료 없음 등). 정상이면 null */
  naReason: string | null;
}

export interface ChannelDailyBase {
  mean: number | null;
  validDays: number;
  /** 조회 기간의 일수(미래·최신 자료일 이후 제외) */
  periodDays: number;
  /** 같은 날 값이 서로 다른 행이 있었던 날(최근 적재 값 사용) */
  conflictDays: number;
  firstDate: string | null;
  lastDate: string | null;
  targetLabel: string;
}

export interface SlotBase {
  ratio: RatioValue;
  /** 수축 전 배율(상세용) */
  rawIndex: number | null;
  reliability: number;
  airingsUsed: number;
  comparisonAirings: number;
  levels: Record<BaselineLevel, number>;
  windowFrom: string;
  windowTo: string;
  note: string;
}

export interface FitTagInfo {
  tag: string | null;
  tier: string;
  asOf: string;
  windowFrom: string;
  sampleDays: number;
  /** 같은 채널에 이 작품의 program_id가 여러 개면 가장 방영 많은 것 기준 */
  note: string;
}

export interface SplitStat {
  airings: number;
  days: number;
  avg: number | null;
}

/** 월간 추이 한 칸 — 작품 평균과 같은 달(조회 기간 안)의 채널 일평균. 방영이 없는 달은 programAvg=null(0으로 잇지 않음). */
export interface MonthlyPoint {
  month: string; // YYYY-MM
  /** 이 달 중 조회 기간에 들어가는 구간(분자·분모 같은 구간) */
  from: string;
  to: string;
  /** 조회 기간 때문에 달의 일부만 들어간 경우 */
  partial: boolean;
  airings: number;
  days: number;
  programAvg: number | null;
  channelAvg: number | null;
  channelValidDays: number;
  periodDays: number;
  vsChannel: RatioValue;
}

/** 채널별 첫 줄 — 서버가 확정 수치·방향·표본 상태로만 만든 고정 템플릿 문장(LLM 아님). 채널당 한 줄(2049·가구 함께, 판단은 KPI 타깃 기준). */
export interface ChannelLine {
  /** 자사는 채널 코드, 경쟁 채널은 채널명 */
  channelCode: string;
  name: string;
  direction: Direction;
  sampleState: "OK" | "SMALL" | "NONE";
  /** 타깃별 값과 지수(채널 평균=100) — 화면이 색을 입힐 때 쓴다(다시 계산하지 않음) */
  pieces: { target: string; value: number | null; index: number | null; direction: Direction }[];
  /** "각각 95%·84% 낮음" 같은 차이 요약 */
  summary: string;
  airings: number;
  days: number;
  /** 같은 내용의 평문 한 줄 */
  text: string;
}

export interface ChannelRow {
  channelCode: string;
  channelName: string;
  kpiGroup: "2049" | "HH";
  targetLabel: string;
  status: ChannelStatus;
  statusNote: string;
  programIds: string[];
  airings: number;
  days: number;
  episodes: number;
  firstRun: SplitStat;
  rerun: SplitStat;
  unknownRun: SplitStat;
  /** 선택한 본재 조건의 방영별 산술평균 */
  programAvg: number | null;
  observedFrom: string | null;
  observedTo: string | null;
  channelDaily: ChannelDailyBase | null;
  vsChannel: RatioValue;
  slot: SlotBase | null;
  fit: FitTagInfo | null;
  /** 판단 보류 등 표본 상태 */
  sampleState: "OK" | "SMALL" | "NONE";
  summary: string;
  /** 선택한 본재 조건의 월별 작품 평균 vs 같은 달 채널 일평균 */
  monthly: MonthlyPoint[];
  /** 채널 KPI 타깃 행이면 true(두 타깃 모드에서 다른 그룹 타깃 행은 false) */
  primary: boolean;
  /** 선택한 본재 조건의 방영별 닐슨 점유율 산술평균(채널 공식 기간 점유율 아님). 점유율 값이 있는 방영이 없으면 null */
  shareAvg: number | null;
  shareAirings: number;
  /** 선택 채널 분석(2×2) — 방영이 있을 때만 */
  analysis: RowAnalysis | null;
}

/** 회차별 추이 한 점 — <본> 표시가 있는 방영만, 회차 번호 기준(재방을 다음 회차처럼 잇지 않음). 같은 회차 본방이 여럿이면 평균. */
export interface EpisodePoint {
  episode: number;
  date: string;
  airings: number;
  avg: number | null;
}

/** 개별 방영 하나(최고·최저·최근 표시용) */
export interface AiringRef {
  date: string;
  startTime: string | null;
  episode: number | null;
  firstRun: boolean | null;
  rating: number;
}

/** 실제 방영한 요일·시간대 한 칸 — 작품 평균 vs 같은 채널·타깃·기간·같은 요일·시의 다른 프로그램 단순 평균(수축 없음) */
export interface SlotLine {
  dow: number;
  hourBlock: number;
  airings: number;
  days: number;
  avg: number | null;
  compAvg: number | null;
  compAirings: number;
  /** 비교 기준 — 같은 요일·시 / (부족하면) 같은 시·모든 요일 / 산출 불가 */
  basis: "DOW_HOUR" | "HOUR" | "NONE";
  vs: RatioValue;
  sampleState: "OK" | "SMALL" | "NONE";
  /** 이 구간 방영 중 본방(<본>)인 건수 — 본방 시간대 판정에 쓴다 */
  firstRunAirings?: number;
}

/** 문장 조각 — d가 있으면 화면이 방향 색(높음 푸른색·낮음 붉은색)을 입힌다. 문장은 서버가 확정 수치로만 만든다. */
export interface TextPart {
  t: string;
  d?: Direction;
}

export interface RowAnalysis {
  /** 회차별(본방·회차 확인분, 2회차 이상일 때만). 없으면 월별(row.monthly)만 */
  episodes: EpisodePoint[];
  /** 본방(<본> 표시) 방영 — 방영 순서대로, 시청률 값이 있는 것만. 그래프 기본 축(회차 번호가 있으면 회차로 표기) */
  firstRuns: AiringRef[];
  /** 같은 기간·타깃의 채널 평균(그래프 기준선) */
  channelAvg: number | null;
  /** 흐름 한 줄 — 전반/후반(회차 4개 이상) · 첫/최근 회차 · 첫/마지막 방영 달의 채널 평균 대비. 근거가 없으면 '추이 자료 부족' */
  trendText: string;
  extremes: { best: AiringRef; worst: AiringRef; recent: AiringRef } | null;
  extremesText: string;
  slots: SlotLine[];
  slotText: string;
  /** 편성 비교 한 문장(본방 시간 기준) — 비교 가능한 구간이 둘 이상일 때. 없으면 slotText를 그대로 쓴다 */
  slotParts: TextPart[] | null;
  /** 종합 평가 — 검증된 지표(채널 평균 대비·같은 시간대 대비·구간·본방 외)의 관계를 고정 문구로. 새 점수·가중치 없음 */
  verdict: string;
  reasons: string[];
  /** 종합 평가 — 다른 칸에 이미 보이는 내용과 겹치지 않는 인사이트 줄(최대 3). 없으면 verdict를 쓴다 */
  insights: TextPart[][];
}

export interface AiringEvidence {
  channelCode: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  programId: string;
  name: string;
  firstRun: boolean | null;
  episode: number | null;
  rating: number | null;
}

export interface SlotCell {
  channelCode: string;
  dow: number; // 0=일
  hourBlock: number; // 2~25
  airings: number;
  avg: number | null;
}

/**
 * 경쟁 채널에서의 이 작품 성과 — 닐슨 일일 파일 'OOO경쟁채널시청률' 시트(등록 경쟁채널만, competitor_program_target_ratings)의 방영별 값.
 * 시트 타깃 '개인2049'=수도권 2049, '유료방송가구'=전국 유료가구(자사 블록 실측으로 같은 지표 확인, nielsenDaily.ts).
 * 채널 평균은 같은 경쟁채널의 랭킹 시트 채널 하루 시청률(competitor_ratings, 순위 있는 행) 일평균 — 자사 채널 평균과 같은 정의.
 */
export interface CompetitorRow {
  competitorName: string;
  targetLabel: string;
  airings: number;
  days: number;
  firstRunAirings: number;
  rerunAirings: number;
  programAvg: number | null;
  shareAvg: number | null;
  channelDaily: ChannelDailyBase | null;
  vsChannel: RatioValue;
  sampleState: "OK" | "SMALL" | "NONE";
}

export interface PerformanceResult {
  version: string;
  query: PerformanceQuery;
  work: { groupKey: string; displayName: string; memberKeys: string[]; candidateKeys: string[] };
  classification: WorkClassification;
  period: { from: string; to: string; dbFirstDate: string | null; latestDataDate: string | null; workFirstObserved: string | null; workFirstFirstRun: string | null };
  totals: { channels: number; airings: number; days: number; episodes: number };
  groups: { kpiGroup: "2049" | "HH"; rows: ChannelRow[] }[];
  lines: ChannelLine[];
  /** 경쟁 채널 성과(방영 기록이 있는 경쟁채널만, 채널마다 2049·가구) — 화면에서 선택해 연다 */
  competitors: CompetitorRow[];
  competitorLines: ChannelLine[];
  airings: AiringEvidence[];
  airingsTruncated: boolean;
  slotCells: SlotCell[];
  notes: string[];
}

export interface SearchItem {
  groupKey: string;
  displayName: string;
  ownChannels: string[];
  airingsTotal: number;
  lastDate: string | null;
  classification: WorkClass;
}
