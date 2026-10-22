// 프로그램 성과(작품 × 채널 비교) — 입출력 타입. 순수 데이터 구조(서버·클라이언트 공용).
// 설계·지표 정의: docs/ena-features-plan.md §3·§4
import type { BaselineLevel } from "@/lib/contentFit/types";

export const PROGRAM_PERFORMANCE_VERSION = "program-performance-v1";

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
export type TargetMode = "kpi" | "common2049" | "commonHH";

export interface PerformanceQuery {
  groupKey: string;
  channels: string[] | null; // null = 전체
  from: string | null; // null = 보유 자료 전체(작품 첫 관측일부터)
  to: string | null; // null = 최신 자료일
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

export interface PerformanceResult {
  version: string;
  query: PerformanceQuery;
  work: { groupKey: string; displayName: string; memberKeys: string[]; candidateKeys: string[] };
  classification: WorkClassification;
  period: { from: string; to: string; dbFirstDate: string | null; latestDataDate: string | null; workFirstObserved: string | null; workFirstFirstRun: string | null };
  totals: { channels: number; airings: number; days: number; episodes: number };
  groups: { kpiGroup: "2049" | "HH"; rows: ChannelRow[] }[];
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
