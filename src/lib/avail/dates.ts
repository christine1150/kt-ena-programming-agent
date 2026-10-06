// Avail 날짜 처리(단계 06) — 순수 함수, 시계·난수 접근 없음. 시간대는 Asia/Seoul(DST 없음)로 고정이다.
// 방송일 2026-10-04의 25:30은 달력시각 2026-10-05 01:30이다(명세 4절). 권리 검사가 달력 기준인지 방송일 기준인지는
// 계약이 정하므로, 확인되지 않았으면 두 가지로 모두 평가해 결과가 갈리면 조건부로 돌린다(evaluate.ts).
import type { Tri } from "./types";

/** 엑셀에서 "종료일 없음(영구)"을 나타내는 관례적 날짜 일련번호. 보유 파일은 2958434(9999-11-30)와 2958465(9999-12-31)를 모두 쓴다. */
export const EXCEL_UNBOUNDED_FROM = 2958434;
export const EXCEL_MAX_SERIAL = 2958465;

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** 날짜 문자열 → 1970-01-01 기준 일수 */
export function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}
export function dayToIso(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
export function addDaysIso(date: string, n: number): string {
  return dayToIso(dayNumber(date) + n);
}

/** 엑셀 일련번호 → YYYY-MM-DD. 정수가 아니거나 범위 밖이면 null. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > EXCEL_MAX_SERIAL) return null;
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * 셀 값 → 날짜 Tri. 숫자(엑셀 일련번호)·ISO 문자열·"2026.10.01"·"2026/10/1" 형태를 읽는다.
 * 일련번호 2958434는 종료일 "무제한"이다. 빈칸은 unknown(무제한으로 가정하지 않는다).
 */
export function parseDateCell(v: unknown, role: "start" | "end"): { value: Tri<string>; issue: string | null } {
  if (v === null || v === undefined || v === "") return { value: { state: "unknown", raw: null }, issue: null };
  if (typeof v === "number") {
    if (role === "end" && v >= EXCEL_UNBOUNDED_FROM && v <= EXCEL_MAX_SERIAL) return { value: { state: "unbounded" }, issue: null };
    const iso = excelSerialToIso(v);
    return iso ? { value: { state: "value", value: iso }, issue: null } : { value: { state: "unknown", raw: String(v) }, issue: `날짜로 읽을 수 없는 숫자입니다: ${v}` };
  }
  const s = String(v).trim();
  if (role === "end" && /^(무기한|영구|제한\s*없음)$/.test(s)) return { value: { state: "unbounded" }, issue: null };
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (isIsoDate(iso)) return { value: { state: "value", value: iso }, issue: null };
  }
  return { value: { state: "unknown", raw: s }, issue: `날짜로 읽을 수 없는 값입니다: "${s}" (예: 2026-10-01)` };
}

/** 시작일에 N개월을 더한 같은 날(말일 보정). */
export function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * 시작일과 기간(개월)으로 종료일(포함)을 계산한다: 종료일 = 시작일 + 기간 − 1일.
 * 근거: 보유 Avail 파일(260930) 종료일이 있는 행 중 이 규칙과 일치한 비율이 약 97%였다(단계 06 조사). 계약별 예외는 원본이 우선한다.
 */
export function inclusiveEndFromTerm(startIso: string, months: number): string {
  return addDaysIso(addMonthsIso(startIso, months), -1);
}

/** "2년", "1년 6개월", "7개월", "30일" → 개월/일. 영구·종료일까지·알 수 없음은 별도 종류. */
export type Term = { kind: "months"; months: number } | { kind: "days"; days: number } | { kind: "perpetual" } | { kind: "until_end" } | { kind: "unknown"; raw: string | null };
export function parseTerm(raw: unknown): Term {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { kind: "unknown", raw: null };
  const s = String(raw).trim();
  if (s === "영구") return { kind: "perpetual" };
  if (s === "종료일까지") return { kind: "until_end" };
  const y = /(\d+)\s*년/.exec(s);
  const mo = /(\d+)\s*개월/.exec(s);
  const d = /^(\d+)\s*일$/.exec(s);
  if (d) return { kind: "days", days: Number(d[1]) };
  if (y || mo) {
    const rest = s.replace(/(\d+)\s*년/, "").replace(/(\d+)\s*개월/, "").trim();
    if (rest) return { kind: "unknown", raw: s };
    return { kind: "months", months: (y ? Number(y[1]) * 12 : 0) + (mo ? Number(mo[1]) : 0) };
  }
  return { kind: "unknown", raw: s };
}

/** 방송일 + 방송일 분 → 달력 일시(KST)를 "분" 단위 정수로. 25:30 → 다음 날 01:30. */
export function calendarMinute(broadcastDate: string, broadcastMin: number): number {
  return dayNumber(broadcastDate) * 1440 + broadcastMin;
}
export function calendarDateOf(broadcastDate: string, broadcastMin: number): string {
  return dayToIso(Math.floor(calendarMinute(broadcastDate, broadcastMin) / 1440));
}
/** 달력 분 → "YYYY-MM-DD HH:mm" (표시용) */
export function calendarLabel(minute: number): string {
  const day = Math.floor(minute / 1440);
  const m = minute - day * 1440;
  return `${dayToIso(day)} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 권리 기간의 한쪽 끝 해석 조합 */
export interface BoundaryConvention {
  /** calendar = 달력 시각 기준, broadcast_day = 닐슨 방송일 기준 */
  basis: "calendar" | "broadcast_day";
  /** 종료일 당일을 포함하는가 */
  endInclusive: boolean;
}

export type WindowPosition = "in" | "before_start" | "after_end" | "straddles_end" | "straddles_start";

/**
 * 슬롯 [시작, 종료)이 권리 기간에 어떻게 놓이는지 한 가지 해석으로 판정한다.
 * - broadcast_day 기준: 슬롯의 방송일이 [start, end] 안이면 in(시작만 보든 끝까지 보든 같다).
 * - calendar 기준: 슬롯 시작·종료 달력 시각을 [start 00:00, end 다음날 00:00(포함)/end 00:00(제외)) 와 비교한다.
 * 시작일은 항상 포함이다(계약이 시작일 이전 방영을 허용하는 경우는 없다고 보지 않고, 시작 전은 항상 제외).
 */
export function positionInWindow(slot: { broadcastDate: string; startMin: number; endMin: number }, start: string | null, end: string | "unbounded" | null, conv: BoundaryConvention): WindowPosition {
  if (conv.basis === "broadcast_day") {
    if (start && slot.broadcastDate < start) return "before_start";
    if (end && end !== "unbounded" && (conv.endInclusive ? slot.broadcastDate > end : slot.broadcastDate >= end)) return "after_end";
    return "in";
  }
  const s = calendarMinute(slot.broadcastDate, slot.startMin);
  const e = calendarMinute(slot.broadcastDate, slot.endMin); // 배타 끝
  const lo = start ? dayNumber(start) * 1440 : -Infinity;
  const hi = !end || end === "unbounded" ? Infinity : (dayNumber(end) + (conv.endInclusive ? 1 : 0)) * 1440; // 배타 끝
  if (e <= lo) return "before_start";
  if (s < lo) return "straddles_start";
  if (s >= hi) return "after_end";
  if (e > hi) return "straddles_end";
  return "in";
}
