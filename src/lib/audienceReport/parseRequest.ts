// N절 Phase 2a(2026-09-01) — 리포트 쿼리 파라미터 → AudienceReportRequest 공용 파서.
//
// 이 프로젝트에서 반복적으로 관찰된 회귀 패턴("같은 규칙이 여러 곳에 복사돼 있다가 한쪽만
// 고쳐져 조용히 갈라짐")을 처음부터 막기 위해, JSON·Word·PPT 세 라우트가 기간 해석 규칙을
// 각자 갖지 않고 이 함수 하나만 쓴다. 규칙이 바뀌면 세 포맷이 동시에 바뀐다.
//
// 쿼리 파라미터(설계서 §06 4개 모드에 그대로 대응):
// - date                                          → MODE A(하루)
// - dateFrom + dateTo                             → MODE B(시작~끝)
// - dateFrom + dateTo + compareFrom + compareTo   → MODE C(기간A vs 기간B)
// - preset(+customFrom/customTo)                  → MODE D(누적·트레일링·주기비교)
import type { AudienceReportRequest } from "./reportBuilder";
import type { PeriodPreset } from "./periodPresets";

export function parseAudienceReportRequest(searchParams: URLSearchParams): AudienceReportRequest | null {
  const date = searchParams.get("date");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const compareFrom = searchParams.get("compareFrom");
  const compareTo = searchParams.get("compareTo");
  const preset = searchParams.get("preset");
  const customFrom = searchParams.get("customFrom") ?? undefined;
  const customTo = searchParams.get("customTo") ?? undefined;

  if (preset) {
    return { mode: "cumulative", latest: dateTo ?? date ?? new Date().toISOString().slice(0, 10), preset: preset as PeriodPreset, customFrom, customTo };
  }
  if (dateFrom && dateTo && compareFrom && compareTo) {
    return { mode: "compare", dateFrom, dateTo, priorDateFrom: compareFrom, priorDateTo: compareTo };
  }
  if (dateFrom && dateTo) return { mode: "range", dateFrom, dateTo };
  if (date) return { mode: "single_day", date };
  return null;
}

export const AUDIENCE_REPORT_PARAM_ERROR = "date, 또는 dateFrom/dateTo, 또는 preset 파라미터가 필요합니다.";

/** 다운로드 파일명 — 채널코드·기간을 담되 OS에서 문제되는 문자는 제거한다. */
export function reportFileName(channelCode: string, periodLabel: string, ext: "docx" | "pptx"): string {
  const safe = periodLabel.replace(/[^0-9A-Za-z가-힣~_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `${channelCode}_${safe || "report"}.${ext}`;
}
