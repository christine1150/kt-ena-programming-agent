// Phase 8(2026-08-28, Audience Intelligence Report 계획서 J절 §07) — 종합(포트폴리오) 리포트
// 데이터 모델. 채널별 리포트를 이어붙이면 종합이 되지 않는다는 설계서 원칙대로, 여기 있는 모든
// 필드는 "채널 사이의 관계"만 다룬다. Group A/B를 타입 레벨에서부터 분리해(같은 배열에 담지
// 않음) 렌더러가 실수로 두 그룹을 한 표·차트에 섞을 수 없게 한다(§09-3 자체 검산 원칙을 타입으로
// 강제).
import type { ResolvedAudiencePeriod } from "./periodResolver";
import type { SkyUhdSubstituteSection } from "./reportModel";
import type { HourlyPatternRow, DailyTrendPoint } from "./dataCollector";

export interface PeerRow {
  channelCode: string;
  channelName: string;
  level: number | null; // periodReport.avg_rating
  formattedLevel: string;
  trend: number | null; // periodReport.baseline_change_pct(최근 12주 평균 대비 — 그룹 내 채널을 같은 기준으로 비교하기 위해 prior_period_change_pct보다 이걸 우선 사용)
  reach: number | null; // periodReport.avg_reach — 스캐터 원 크기
  targetRating: number | null;
  // 시각화 보조(채널×시간대 히트맵, 추이 스몰 멀티플) — Phase 1이 이미 채널별로 모은 것을 그대로 병기.
  hourlyPattern: HourlyPatternRow[];
  trendSeries: DailyTrendPoint[];
}

export interface PipelineEdge {
  canonicalName: string;
  relation: "simulcast" | "rerun";
  fromChannelCode: string;
  fromChannelName: string;
  fromRating: number | null;
  toChannelCode: string;
  toChannelName: string;
  toRating: number | null;
  retentionPct: number | null; // toRating ÷ fromRating × 100
}

export interface CommonPatternResult {
  direction: "up" | "down" | null; // null이면 공통 패턴 없음
  channelCodes: string[];
  label: string;
}

export interface ChannelOpportunity {
  channelCode: string;
  channelName: string;
  label: string;
}

// Phase 12(2026-08-28, 계획서 J절 Phase 12) — dow 추가: 화·목요일에 같은 시간대·같은 프로그램이면
// 요일이 달라도 "중복"으로 잡히던 허점을 사용자가 지적해, 요일까지 일치할 때만 중복으로 판정한다.
export interface SlotOverlapRow {
  dow: number; // ISO 요일(1=월~7=일)
  dowLabel: string;
  hour: number;
  canonicalName: string;
  channelCodes: string[];
}

export interface ChannelActionItem {
  channelCode: string;
  channelName: string;
  basis: string; // [근거]
  suggestion: string; // [제안]
  verification: string; // [확인]
}

export interface GroupPeerSection {
  code: "A" | "B";
  label: string;
  oneLiner: string;
  peers: PeerRow[];
  commonPattern: CommonPatternResult;
  opportunities: ChannelOpportunity[];
}

export interface ChannelActions {
  channelCode: string;
  channelName: string;
  items: ChannelActionItem[]; // 최대 3개(신호가 부족하면 그보다 적게 — 지어내지 않음). 채널 자체는
  // 신호가 0개여도 항상 이 배열에 나타난다(flatMap으로 만들면 신호 0개 채널이 통째로 누락되는
  // 버그가 있었음 — 실 서버 검증 중 발견·수정).
}

/**
 * W절(2026-09-10) — 종합 리포트의 채널 간 심층 비교.
 *
 * 채널별 리포트가 "이 채널 안에서 무엇이 잘됐나"를 본다면, 여기는 **같은 잣대로 7채널을
 * 나란히 놓는다**. 재료는 요일×시간대 프로파일 하나뿐이라(채널당 최대 221행, 단일 group-by)
 * 7채널 동시 집계에도 부담이 없다 — 무거운 프로그램 단위 조회를 켜지 않고도 만들 수 있는
 * 비교만 담는다는 것이 이 섹션의 설계 전제다.
 */
export interface ChannelPrimeUsageRow {
  channelCode: string;
  channelName: string;
  groupCode: "A" | "B";
  /** 주요시간에 편성된 방영시간의 비중(%) — 주요시간을 얼마나 쓰고 있는가. */
  primeAirtimePct: number | null;
  primeAvgRating: number | null;
  offPrimeAvgRating: number | null;
  /** 주요시간 평균 ÷ 그 외 평균 — 주요시간을 얼마나 잘 살렸는가. */
  primeRatio: number | null;
  weekdayAvgRating: number | null;
  weekendAvgRating: number | null;
  avgReach: number | null;
  avgTimeSpentShare: number | null;
}

export interface PortfolioDeepCompare {
  primeLabel: string;
  holidays: { date: string; name: string }[];
  rows: ChannelPrimeUsageRow[];
  /** 그룹 안에서만 비교한 관찰 — 그룹 간 비교는 측정 유니버스가 달라 하지 않는다. */
  observations: string[];
}

export interface PortfolioReportDocument {
  period: ResolvedAudiencePeriod;
  /** 채널 간 주요시간 활용도·요일 균형 비교(W절). */
  deepCompare: PortfolioDeepCompare;
  groupA: GroupPeerSection & { pipeline: PipelineEdge[] };
  groupB: GroupPeerSection & { skyUhd: SkyUhdSubstituteSection | null };
  slotOverlap: SlotOverlapRow[];
  actionsByChannel: ChannelActions[]; // 7개 채널 전부, 신호 없어도 빈 items로 포함
  isolationOk: boolean; // checkGroupIsolation 결과(항상 true여야 정상 — 방어적 확인용)
  aiSummary: string | null; // Phase 10(§12) — reportModel.ts의 AudienceReportDocument.aiSummary와 같은 원칙
}
