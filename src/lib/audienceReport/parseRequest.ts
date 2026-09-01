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

/**
 * 다운로드용 Content-Disposition 헤더 값.
 *
 * 버그 수정(2026-09-01, 배포 직후 실측): 파일명에 기간 라벨을 그대로 넣었더니 MODE D에서만
 * 500이 났다 — MODE A/B/C의 라벨은 날짜(ASCII)지만 MODE D는 프리셋 이름("이번 분기 누적(QTD)")
 * 이라 한글이 들어가고, HTTP 헤더는 ByteString(Latin-1)만 허용해 인코딩 에러가 난다.
 * RFC 5987대로 ASCII 폴백(filename)과 UTF-8 원본(filename*)을 함께 보낸다 — 한글 파일명을
 * 포기하지 않으면서 모든 브라우저에서 안전하다.
 */
export function reportContentDisposition(channelCode: string, periodLabel: string, ext: "docx" | "pptx"): string {
  const cleaned = periodLabel.replace(/[^0-9A-Za-z가-힣~_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const utf8Name = `${channelCode}_${cleaned || "report"}.${ext}`;
  // ASCII 폴백: 한글 등 비ASCII를 지우고 남은 것이 없으면 채널코드만 쓴다.
  const asciiBase = `${channelCode}_${cleaned}`.replace(/[^\x20-\x7E]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const asciiName = `${asciiBase || channelCode}.${ext}`;
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
}
