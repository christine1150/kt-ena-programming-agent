// 보고서 스냅샷 요청 모양과 재사용 키(단계 14) — 순수 모듈(서버 의존 없음).
import type { AudienceReportRequest } from "@/lib/audienceReport/reportBuilder";

export interface SnapshotRequest {
  subject: "channel" | "portfolio";
  channelCode?: string;
  request: AudienceReportRequest;
  /** true면 재사용하지 않고 새로 만든다("다시 생성") */
  refresh?: boolean;
}

export function requestKey(r: SnapshotRequest): string {
  return JSON.stringify([r.subject, r.subject === "channel" ? r.channelCode : null, r.request]);
}
