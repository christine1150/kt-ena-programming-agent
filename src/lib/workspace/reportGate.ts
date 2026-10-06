// 보고서 생성 가드(단계 07) — 최신 완료 snapshot이 아닌 상태에서 보고서를 만들지 않거나, 이전 snapshot임을 알린다.
// 판단은 두 가지다: ① 화면 값이 아직 현재 선택의 값이 아니면(로딩·stale·error) 막는다 ② 보고서가 계산한 데이터 시점(knowledgeCutoff)이
// 링크를 만든 화면의 시점과 다르면 안내한다. snapshot ID는 화면마다 grain·집계 정의가 달라 서로 비교할 수 없으므로
// 시점(knowledgeCutoff = 알 수 있는 가장 최근 방송일)으로 비교한다.
import type { FetchStatus } from "./requestState";

export type ReportGuardCode = "CONTEXT_NOT_READY" | "PERIOD_AFTER_LATEST" | "OLDER_SNAPSHOT" | "NEWER_DATA";

export interface ReportGuard {
  mode: "ok" | "notice" | "blocked";
  code: ReportGuardCode | null;
  message: string | null;
}

export interface ReportGuardInput {
  /** 링크를 만드는 화면의 데이터 상태 */
  status: FetchStatus;
  isCurrent: boolean;
  /** 보고서 기간 종료일 */
  requestedTo: string | null;
  /** 화면이 아는 최신 수신일 */
  latestAvailableDate: string | null;
  /** 링크에 실린 화면의 데이터 시점(cut 쿼리) */
  linkCutoff: string | null;
  /** 보고서가 계산한 데이터 시점(metricContext.knowledgeCutoff) */
  reportCutoff: string | null;
}

const OK: ReportGuard = { mode: "ok", code: null, message: null };

export function evaluateReportGuard(i: ReportGuardInput): ReportGuard {
  if (i.status !== "ready" || !i.isCurrent) {
    return { mode: "blocked", code: "CONTEXT_NOT_READY", message: "선택한 기간의 값을 아직 불러오지 못해 보고서를 만들 수 없습니다. 값이 표시된 뒤 다시 시도하세요." };
  }
  if (i.requestedTo && i.latestAvailableDate && i.requestedTo > i.latestAvailableDate) {
    return { mode: "blocked", code: "PERIOD_AFTER_LATEST", message: `선택한 종료일(${i.requestedTo})이 최신 수신일(${i.latestAvailableDate}) 이후라 아직 받지 못한 날을 포함합니다. 보고서를 만들 수 없습니다.` };
  }
  if (i.linkCutoff && i.reportCutoff) {
    if (i.reportCutoff < i.linkCutoff) {
      return { mode: "notice", code: "OLDER_SNAPSHOT", message: `이 보고서는 ${i.reportCutoff}까지의 자료 기준(이전 snapshot)입니다. 링크를 만든 화면은 ${i.linkCutoff}까지 반영된 값이라 숫자가 다를 수 있습니다.` };
    }
    if (i.reportCutoff > i.linkCutoff) {
      return { mode: "notice", code: "NEWER_DATA", message: `화면을 본 뒤 새 자료가 반영되어 이 보고서는 ${i.reportCutoff}까지의 자료 기준입니다(화면은 ${i.linkCutoff}). 화면의 숫자와 다를 수 있습니다.` };
    }
  }
  return OK;
}

/** 링크 쿼리에서 화면의 데이터 시점을 읽는다(`cut`). 날짜 형식이 아니면 무시. */
export function cutoffFromQuery(get: (k: string) => string | null): string | null {
  const v = get("cut");
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
