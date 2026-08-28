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

export interface PortfolioReportDocument {
  period: ResolvedAudiencePeriod;
  groupA: GroupPeerSection & { pipeline: PipelineEdge[] };
  groupB: GroupPeerSection & { skyUhd: SkyUhdSubstituteSection | null };
  slotOverlap: SlotOverlapRow[];
  actionsByChannel: ChannelActions[]; // 7개 채널 전부, 신호 없어도 빈 items로 포함
  isolationOk: boolean; // checkGroupIsolation 결과(항상 true여야 정상 — 방어적 확인용)
  aiSummary: string | null; // Phase 10(§12) — reportModel.ts의 AudienceReportDocument.aiSummary와 같은 원칙
}
