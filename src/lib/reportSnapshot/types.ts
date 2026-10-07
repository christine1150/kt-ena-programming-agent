// ReportSnapshot(단계 14) — 웹·Word·PPT·PDF 보고서가 함께 쓰는 공통 원본.
//
// 문제: 이전에는 웹·Word·PPT 라우트가 각자 buildAudienceReport()를 다시 불러, 같은 보고서인데도 만들어진 시점·
// AI 문장·수치가 형식마다 갈라질 수 있었다(25~30초 걸리는 빌드가 형식마다 한 번씩 돌았다).
// 해결: 보고서를 **한 번 만들어 불변 ID로 저장**하고, 모든 형식은 그 스냅샷에서만 그린다. AI 문장도 스냅샷에 들어 있는
// 한 번의 결과이며 어떤 형식도 새로 생성하지 않는다.
//
// 이 파일은 순수 타입·상수만 가진다(클라이언트 화면에서도 import 가능).
import type { AudienceReportDocument } from "@/lib/audienceReport/reportModel";
import type { PortfolioReportDocument } from "@/lib/audienceReport/portfolioModel";
import type { RightsHomeSummary } from "@/lib/avail/homeSummary";

/** 스냅샷 구조가 바뀌면 올린다 — 저장된 옛 스냅샷은 읽을 수 있어도 새 렌더러가 기대하는 모양과 다를 수 있다. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** 계산·문장 규칙 버전 — 보고서 계산 규칙(템플릿·판정 문구·캡션)이 바뀌면 올린다. */
export const REPORT_CALC_VERSION = "report-calc-2026-10-14";

/**
 * 보고서의 용도. 같은 날짜라도 일간(하루)과 주간(그 날이 속한 한 주)은 다른 문서이고 이름도 다르다.
 * period는 일간·주간·월간에 해당하지 않는 기간·비교 보고서(분기 누적, 직접 지정 등).
 */
export type ReportCadence = "daily" | "weekly" | "monthly" | "period";

export const CADENCE_LABEL: Record<ReportCadence, string> = { daily: "일간", weekly: "주간", monthly: "월간", period: "기간" };

export type ReportSubject = "channel" | "portfolio";

/** 문서 어디에서나 같은 값으로 나와야 하는 핵심 수치 — 형식 간 일치 검사의 기준이다. */
export interface SnapshotFact {
  id: string;
  label: string;
  /** 화면에 나가는 값 그대로("0.512", "▲ 12.3%") */
  value: string;
  unit: string;
  /** 어느 섹션에 있는가(SectionKey 또는 자유 라벨) */
  where: string;
}

/** 편성 판단(Action). id는 같은 입력이면 같은 값이라 형식·재생성과 무관하게 같은 판단을 가리킨다. */
export interface SnapshotAction {
  id: string;
  channelCode: string | null;
  title: string;
  basis: string;
  suggestion: string;
  confirm: string;
  urgent: boolean;
  /** 권리(Avail) 확인 상태 — 이 보고서는 권리를 조회하지 않으므로 실행 가능 여부를 단정하지 않는다 */
  rights: "unconfirmed";
}

export type AssumptionKind = "provisional" | "coverage" | "rights_unconfirmed" | "policy_unset" | "rank_average" | "ai_absent" | "reference_window" | "stale_recommendation";

/** 값을 읽을 때 알아야 하는 전제·한계(잠정값, 수신 미완료, 권리 미확인 등). 본문 끝 "전제·한계"와 해당 위치 표시에 같이 쓴다. */
export interface SnapshotAssumption {
  id: string;
  kind: AssumptionKind;
  text: string;
}

/** 구매 검토 요약(월간) — 구매 시뮬레이터의 사전 계산 추천을 읽기만 한다. 권리 소진·구매 요청은 일어나지 않는다. */
export interface PurchaseReviewBrief {
  /** 추천이 계산된 데이터 기준일 */
  asOf: string | null;
  modelVersion: string | null;
  /** 추천 기준일과 보고서 분석 종료일의 차이(일) */
  lagDays: number | null;
  /** 추천 기준일이 오래돼 현재 값과 다를 수 있음 */
  stale: boolean;
  items: {
    channelCode: string;
    channelName: string;
    target: "A2049" | "HH";
    rank: number;
    name: string;
    prediction: number;
    low: number | null;
    high: number | null;
    /** 예측 범위가 예측값 대비 넓음(상하한 폭이 예측값 이상) */
    wide: boolean;
    confidence: string | null;
    /** 항상 "보유 예정(권리 획득 가정)" — Avail 연결은 구매 검토 화면에서 확인 */
    stage: string;
  }[];
  note: string;
}

/** 월간 템플릿이 쓰는 추가 자료. 스냅샷 생성 시점에 한 번 읽어 저장한다(형식마다 다시 읽지 않는다). */
export interface SnapshotExtras {
  /** 채널 보고서: 해당 채널의 권리 현황 / 종합: 전체. null = 읽지 못함(문제 없음이 아님) */
  rights?: RightsHomeSummary | null;
  /** 월간 채널 보고서: 해당 채널의 운영정책 한 줄 */
  channelPolicy?: { channelName: string; coreTarget: string; state: string; role: string | null; goal: string | null; direction: string | null; validText: string } | null;
  purchaseReview?: PurchaseReviewBrief | null;
}

export interface SnapshotMeta {
  schema: number;
  /** 불변 ID — 내용(문서·추가 자료·용도)의 지문이라 같은 내용이면 같은 ID이고, 한 번 만들어진 스냅샷은 바뀌지 않는다 */
  id: string;
  subject: ReportSubject;
  cadence: ReportCadence;
  channelCode: string | null;
  channelName: string;
  /** 사람이 읽는 이름: "일간 보고서 · ENA · 2026-10-04(일)" */
  name: string;
  /** 파일명 줄기(확장자 제외) */
  fileStem: string;
  analysis: { from: string; to: string; label: string };
  comparison: { from: string; to: string; label: string } | null;
  /** 측정 대상(타깃) 표기 */
  target: string;
  /** 이 보고서가 알 수 있는 가장 최근 방송일(데이터 기준일) */
  dataCutoff: string;
  coverage: { expectedDays: number; presentDays: number; complete: boolean } | null;
  versions: { snapshotSchema: number; calc: string; metricSnapshotId: string | null; aggregation: string | null };
  /** 문서를 만든 시각(ISO). 분석일(analysis.to)과 다르다 — 표지·머리말에 둘을 따로 적는다 */
  generatedAt: string;
  aiSummaryPresent: boolean;
}

export interface ReportSnapshot extends SnapshotMeta {
  facts: SnapshotFact[];
  actions: SnapshotAction[];
  assumptions: SnapshotAssumption[];
  extras: SnapshotExtras;
  document: AudienceReportDocument | PortfolioReportDocument;
}

export function isChannelSnapshot(s: ReportSnapshot): s is ReportSnapshot & { subject: "channel"; document: AudienceReportDocument } {
  return s.subject === "channel";
}
export function isPortfolioSnapshot(s: ReportSnapshot): s is ReportSnapshot & { subject: "portfolio"; document: PortfolioReportDocument } {
  return s.subject === "portfolio";
}

/** 목록·헤더에 쓰는 가벼운 메타만 뽑는다(문서 본문 제외). */
export function metaOf(s: ReportSnapshot): SnapshotMeta {
  const { facts, actions, assumptions, extras, document, ...meta } = s;
  void facts; void actions; void assumptions; void extras; void document;
  return meta;
}

/** API가 화면에 주는 스냅샷 요약(문서 본문 제외) — 저장 여부와 재사용 여부 포함 */
export type PublicSnapshot = SnapshotMeta & {
  assumptions: SnapshotAssumption[];
  actions: SnapshotAction[];
  persisted: boolean;
  reused: boolean;
  persistError: string | null;
};
