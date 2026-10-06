// 날짜 도우미(단계 07) — 문자열 YYYY-MM-DD 기준으로만 계산한다(시간대 변환은 kstToday 한 곳).

/** 한국 표준시 기준 오늘(YYYY-MM-DD). */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** to − from (일). 같은 날이면 0. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/** 주어진 날짜(포함) 이전의 가장 최근 일요일 — 주간 리뷰는 기준일이 일요일일 때 계산된다. */
export function lastSundayOnOrBefore(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -dow);
}

/** 주어진 날짜(포함) 이전의 가장 최근 월말 — 월간 리뷰는 기준일이 월말일 때 계산된다. */
export function lastMonthEndOnOrBefore(iso: string): string {
  const isMonthEnd = addDays(iso, 1).slice(8, 10) === "01";
  if (isMonthEnd) return iso;
  return addDays(`${iso.slice(0, 7)}-01`, -1);
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** "10/4(일)" */
export function shortDateKo(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}(${DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()]})`;
}

/** 방송일 기준 시(02시 이전 시작은 24~25시로 이어서 쓴다 — 닐슨 방송일 [02:00, 26:00)). */
export function broadcastHour(startTime: string): number {
  const h = parseInt(startTime.slice(0, 2), 10);
  return h < 2 ? h + 24 : h;
}
