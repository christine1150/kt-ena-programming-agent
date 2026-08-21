// 날짜 문자열(YYYY-MM-DD)에 요일을 괄호로 붙이는 공통 유틸.
// 사용자 지시(2026-08-20): "좌상단 YYYY-MM-DD 옆에 괄호로 요일을 (수) 형태로 적어줘. 앞으로도 요일은 적어줘"
// new Date(dateStr)로 파싱하면 브라우저 타임존에 따라 UTC 자정으로 해석되어 하루가 밀리는 문제가
// 있었던 전례(ChannelDeepDive.tsx 기간 프리셋 버그)가 있어, "YYYY-MM-DD"를 연/월/일로 직접 쪼개
// new Date(year, month, day)로 로컬 날짜를 만든다(타임존 영향 없음).
const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

export function formatDateWithDow(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map((p) => Number(p));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateStr;
  const dow = new Date(y, m - 1, d).getDay();
  return `${dateStr} (${DOW_LABEL[dow]})`;
}

// 사용자 지시(2026-08-21, Page 1 매거진 개편): Page 1 헤더 제목 전용 — "2026. 8. 20. (목)"처럼
// 점으로 구분하는 한국식 날짜 표기(월/일은 0 없이). 다른 화면(Page 2 등)은 기존 formatDateWithDow
// (YYYY-MM-DD)를 그대로 쓰므로, 영향 범위를 좁히기 위해 별도 함수로 분리했다.
export function formatDateWithDowDots(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map((p) => Number(p));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateStr;
  const dow = new Date(y, m - 1, d).getDay();
  return `${y}. ${m}. ${d}. (${DOW_LABEL[dow]})`;
}
