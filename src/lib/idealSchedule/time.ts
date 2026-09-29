// 닐슨 방송일(02:00 ~ 익일 01:59) 기준 시간 계산 — 기존 편성표 그리드(ScheduleWeekGrid.tsx의
// GRID_START_MIN=2*60, GRID_END_MIN=26*60)·mart_slot_score(시작 시각 02시 미만이면 +24)와 같은 규칙.
// 자정 이후 방송을 다른 방송일로 분리하지 않고, 실제 방영 길이를 그대로 보존한다.

export const BROADCAST_DAY_START_MIN = 2 * 60;
export const BROADCAST_DAY_END_MIN = 26 * 60;
const DAY_MIN = 24 * 60;

/** "HH:MM" 또는 "HH:MM:SS" → 달력 기준 분(초는 소수로 보존). 형식이 아니면 null. */
export function clockToMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clock.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
}

/** 달력 분 → 방송일 분. 00:00~01:59는 전날 방송일의 24:00~25:59로 본다. */
export function toBroadcastMin(calendarMin: number): number {
  return calendarMin < BROADCAST_DAY_START_MIN ? calendarMin + DAY_MIN : calendarMin;
}

/** 방영 시작·종료 시각 → 방송일 분 구간. 종료가 시작 이하이면 다음 날로 넘어간 것으로 보고 +24시간
 *  (예: 01:30~03:00 → 1530~1620, 방송일 경계를 넘어도 쪼개지 않는다). 종료 시각이 없으면 null. */
export function airingSpan(
  startClock: string,
  endClock: string | null | undefined
): { startMin: number; endMin: number | null; durationMin: number | null } | null {
  const s = clockToMinutes(startClock);
  if (s === null) return null;
  const startMin = toBroadcastMin(s);
  const e = clockToMinutes(endClock ?? null);
  if (e === null) return { startMin, endMin: null, durationMin: null };
  let endMin = toBroadcastMin(e);
  if (endMin <= startMin) endMin += DAY_MIN;
  return { startMin, endMin, durationMin: endMin - startMin };
}

/** 방송일 분 → 시 버킷(2~25). 시작 시각 기준(mart_slot_score와 동일). */
export function hourBucket(broadcastMin: number): number {
  return Math.floor(broadcastMin / 60);
}

/** ISO 요일(1=월 ... 7=일). 날짜 문자열을 UTC로 해석해 실행 환경 시간대 영향을 받지 않는다. */
export function isoDow(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** "YYYY-MM-DD" + n일. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 방송일 분 → "HH:MM"(24시 이후는 25:30처럼 표기). */
export function broadcastMinToLabel(min: number): string {
  const whole = Math.round(min);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** 시 버킷 → 편성 구간(기존 Fit Score MART의 4구간과 동일 경계). */
export function daypartOfHour(hour: number): "새벽" | "오전" | "오후" | "저녁_심야" {
  if (hour >= 2 && hour <= 8) return "새벽";
  if (hour >= 9 && hour <= 13) return "오전";
  if (hour >= 14 && hour <= 18) return "오후";
  return "저녁_심야";
}
