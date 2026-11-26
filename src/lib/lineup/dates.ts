// 라인업 날짜 계산 — 순수 함수(서버에서 계산해 화면은 그리기만 한다. docs/lineup/LINEUP_DESIGN.md §3·§4).
// 날짜는 모두 'YYYY-MM-DD' 문자열(KST 방송일 기준)로 다룬다. 시각 계산을 하지 않으므로 UTC 자정으로 고정해 더하고 뺀다.
import type { DrawSpan, EndPrecision, GapDto, RunDto, RunKind, SlotDto, StartPrecision } from "./types";

const DAY = 86400000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
/** isodow 1=월 … 7=일 */
export const isoDow = (d: string) => {
  const x = new Date(toMs(d)).getUTCDay();
  return x === 0 ? 7 : x;
};
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const monthEnd = (d: string) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return fromMs(Date.UTC(y, m, 0));
};
export const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return fromMs(Date.UTC(y, m, 1)).slice(0, 7);
};
/** 'YYYY-MM-DD' 형식이면서 달력에 실제로 있는 날짜인지(2027-02-29·2026-11-31은 거짓, 2028-02-29는 참). P0-08(2026-11-26 외부 검토). */
export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toMs(v)) && fromMs(toMs(v)) === v;
/** 날짜가 휴방·결방 구간 안인지 */
export const inRanges = (d: string, ranges: { from: string; to: string }[] | undefined) => !!ranges && ranges.some((h) => d >= h.from && d <= h.to);

/** 마지막 방송일 다음의 정규 방송 요일 전날 — "자리 점유" 끝(이어지는 작품끼리 붙고 정말 빈 주만 빈다). */
export function occupancyEnd(lastAir: string, days: number[]): string {
  if (days.length === 0 || days.length >= 7) return lastAir;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(lastAir, i);
    if (days.includes(isoDow(d))) return addDays(d, -1);
  }
  return lastAir;
}

/** start 이상인 첫 방송 요일(자리 요일 기준). 주 단위 자료의 대표일이 방송 요일이 아닐 때 맞춘다. */
export function firstAirOnOrAfter(start: string, days: number[]): string {
  if (days.length === 0) return start;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (days.includes(isoDow(d))) return d;
  }
  return start;
}

/** 회차 수와 주당 방송 횟수로 끝(마지막 방송일)을 추정한다. 저장하지 않고 그릴 때만 쓴다. 등록된 휴방·결방(skip)은 건너뛴다. */
export function estimateEnd(start: string, days: number[], episodes: number, episodesPerAiring = 1, skip?: { from: string; to: string }[]): string {
  const airings = Math.min(400, Math.max(1, Math.ceil(episodes / Math.max(1, episodesPerAiring))));
  const isAir = (x: string) => (days.length === 0 || days.includes(isoDow(x))) && !inRanges(x, skip);
  let d = firstAirOnOrAfter(start, days);
  for (let guard = 0; !isAir(d) && guard < 400; guard++) d = addDays(d, 1);
  for (let count = 1; count < airings; ) {
    d = addDays(d, 1);
    if (isAir(d)) count++;
  }
  return d;
}

/** 매달 마지막(또는 첫·N번째) 방송 요일 — '월1회·마지막주' 같은 규칙을 날짜로 펼친다. */
export function monthlyDates(start: string, end: string, dow: number, rule: "last" | "first" | number = "last"): string[] {
  const out: string[] = [];
  let ym = start.slice(0, 7);
  const endYm = end.slice(0, 7);
  for (let guard = 0; ym <= endYm && guard < 60; guard++, ym = addMonths(ym, 1)) {
    const first = `${ym}-01`;
    const last = monthEnd(first);
    const hits: string[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) if (isoDow(d) === dow) hits.push(d);
    const pick = rule === "last" ? hits[hits.length - 1] : rule === "first" ? hits[0] : hits[rule - 1];
    if (pick && pick >= start && pick <= end) out.push(pick);
  }
  return out;
}

/** 원문 반복 규칙에서 몇째 주인지 읽는다('마지막주' → last, '첫째주' → first, '2째주' → 2). 모르면 null. */
export function parseMonthlyRule(text: string | null | undefined): "last" | "first" | number | null {
  if (!text) return null;
  if (/마지막/.test(text)) return "last";
  if (/첫/.test(text)) return "first";
  const m = text.match(/(\d)\s*(?:째|번째)?\s*주/);
  return m ? Number(m[1]) : null;
}

export interface DrawInput {
  runKind: RunKind;
  startDate: string | null;
  startPrecision: StartPrecision;
  endDate: string | null;
  endPrecision: EndPrecision;
  episodes: number | null;
  recurrence: string | null;
  airDates: string[] | null;
}

/**
 * 실제(또는 회차로 추정한) 마지막 방송일. 끝도 편수도 모르면 null — 임의 기간(예전: 시작 후 4주)을 지어내지 않는다(P0-05, 2026-11-26).
 * 상시(open)는 horizon까지 이어진다고 보되 '확정'이 아니다(openEnded).
 */
export function effectiveEnd(run: DrawInput, days: number[], horizon: string, skip?: { from: string; to: string }[]): { end: string | null; estimated: boolean; openEnded?: boolean } {
  if (!run.startDate) return { end: null, estimated: false };
  if (run.endPrecision === "open") return { end: horizon, estimated: false, openEnded: true };
  if (run.endDate) return { end: run.endDate, estimated: run.endPrecision !== "day" };
  if (run.episodes) return { end: estimateEnd(run.startDate, days, run.episodes, 1, skip), estimated: true };
  return { end: null, estimated: false };
}
/** 첫방일만 아는 막대의 화면 배치 폭(일) — 줄 배정용일 뿐 편성 기간이 아니다(draw.placeholder). */
export const PLACEHOLDER_DAYS = 27;

/**
 * 그리기 구간 — 모양과 그릴 시작·끝. 실제 날짜는 바꾸지 않는다(글자·패널·목록은 실제 날짜).
 * - 월 단위 정밀도 → 범위 괄호(bracket): 시작 달 1일 ~ 끝 달 말일
 * - 월 1회 → 방송일 점(dots), 단발·이틀 행사 → 마름모(diamond)
 * - 미정·결방·수급 → 상자(box), 그 밖 → 막대(bar). 막대·상자의 끝은 자리 점유 규칙으로 늘린다.
 */
export function drawSpan(run: DrawInput, days: number[], horizon: string, skip?: { from: string; to: string }[]): DrawSpan | null {
  if (!run.startDate) return null;
  if (run.runKind === "monthly") {
    let dates = run.airDates && run.airDates.length > 0 ? [...run.airDates].sort() : [];
    if (dates.length === 0 && run.endDate && days.length > 0) {
      const rule = parseMonthlyRule(run.recurrence) ?? "last";
      dates = monthlyDates(run.startDate, run.endDate, days[0], rule);
    }
    if (dates.length === 0) dates = [run.startDate];
    return { shape: "dots", from: dates[0], to: dates[dates.length - 1], estimatedFrom: null, dates };
  }
  if (run.runKind === "single" || run.runKind === "multi_day") {
    const dates =
      run.airDates && run.airDates.length > 0
        ? [...run.airDates].sort()
        : run.endDate && run.endDate > run.startDate
          ? Array.from({ length: Math.min(14, daysBetween(run.startDate, run.endDate) + 1) }, (_, i) => addDays(run.startDate as string, i))
          : [run.startDate];
    return { shape: "diamond", from: dates[0], to: dates[dates.length - 1], estimatedFrom: null, dates };
  }
  if (run.startPrecision === "month") {
    const to = run.endDate ? monthEnd(run.endDate) : monthEnd(run.startDate);
    return { shape: "bracket", from: monthStart(run.startDate), to, estimatedFrom: null, dates: null };
  }
  const shape: DrawSpan["shape"] = run.runKind === "series" ? "bar" : "box";
  const { end, estimated } = effectiveEnd(run, days, horizon, skip);
  if (!end) {
    // 첫방일만 확인: 줄 배정용 배치 폭만 두고 placeholder로 표시한다(화면은 시작 표식 + '기간 미정', 회차·빈 주·맞대결 계산에 쓰지 않음).
    const to = occupancyEnd(addDays(run.startDate, PLACEHOLDER_DAYS), days);
    return { shape, from: run.startDate, to, estimatedFrom: null, dates: null, placeholder: true };
  }
  const to = run.endPrecision === "open" ? end : occupancyEnd(end, days);
  // 추정 끝은 마지막 1주만 흐리게(앞은 회차로 꽤 믿을 만하다).
  const estimatedFrom = estimated ? (daysBetween(run.startDate, to) > 7 ? addDays(to, -6) : run.startDate) : null;
  return { shape, from: run.startDate, to, estimatedFrom, dates: null };
}

/**
 * 동시간대 경쟁 수준(P0-02, 2026-11-26) — 시작 시각 차이만으로 '맞대결'이라 하지 않는다.
 * - 공통 방송일(같은 요일 + 두 편성 기간 안 + 어느 쪽도 휴방이 아닌 날)이 하루도 없으면 null.
 * - exact: 두 편성 모두 확인된 종료 시각(endMinute)이 있고 방송 시간이 실제로 겹친다.
 * - estimated: 먼저 시작하는 편성의 검증된 방송 길이(실제 방송 기록 중간값)로 계산하면 겹친다.
 * - adjacent: 시작 시각 차이 ±60분 이내지만 겹침은 확인되지 않음(종료 시각·길이를 모른다).
 * 시각을 모르는 자리(startMinute null)는 판정하지 않는다. 자정 이후 방송은 방송일 기준 분(24:30 = 1470)으로 비교한다.
 */
export type HeadToHeadLevel = "exact" | "estimated" | "adjacent";
export interface AirWindow {
  days: number[];
  startMinute: number | null;
  /** 확인된 종료 분(방송일 기준) — 없으면 null */
  endMinute?: number | null;
  /** 검증된 방송 길이(분) — 실제 방송 기록이 있을 때만 */
  runtime?: number | null;
  from: string; // 첫 방송일
  to: string; // 마지막 방송일(모르면 첫 방송일 — 첫방만 확인된 편성)
  skip?: { from: string; to: string }[]; // 휴방·결방
}
export function headToHeadLevel(a: AirWindow, b: AirWindow, windowMinutes = 60): HeadToHeadLevel | null {
  if (a.startMinute === null || b.startMinute === null) return null;
  const shared = a.days.filter((d) => b.days.includes(d));
  if (shared.length === 0) return null;
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  if (from > to) return null;
  let common = false;
  for (let d = from, guard = 0; d <= to && guard < 800; d = addDays(d, 1), guard++) {
    if (shared.includes(isoDow(d)) && !inRanges(d, a.skip) && !inRanges(d, b.skip)) {
      common = true;
      break;
    }
  }
  if (!common) return null;
  const aEnd = a.endMinute ?? null;
  const bEnd = b.endMinute ?? null;
  if (aEnd !== null && bEnd !== null) return a.startMinute < bEnd && b.startMinute < aEnd ? "exact" : null;
  const [early, late] = a.startMinute <= b.startMinute ? [a, b] : [b, a];
  const earlyEnd = early.endMinute ?? (early.runtime ? (early.startMinute as number) + early.runtime : null);
  if (earlyEnd !== null && (late.startMinute as number) < earlyEnd) return "estimated";
  if (Math.abs(a.startMinute - b.startMinute) <= windowMinutes) return "adjacent";
  return null;
}
/** 예전 판정(같은 요일·시작 ±60분·기간 겹침) — 호환용. 새 코드는 headToHeadLevel을 쓴다. */
export function isHeadToHead(
  a: { days: number[]; startMinute: number | null; from: string; to: string },
  b: { days: number[]; startMinute: number | null; from: string; to: string },
  windowMinutes = 60
): boolean {
  return headToHeadLevel(a, b, windowMinutes) !== null;
}

/**
 * 한 자리의 빈 주(P0-01, 2026-11-26). 겹치거나 붙은 편성 구간을 먼저 합친 뒤 블록 사이 7일 이상을 낸다.
 * - 앞 블록의 끝을 모르면(첫방만 확인된 placeholder) 그 뒤 빈 주를 계산하지 않는다(자료 미확보).
 * - 앞 블록 끝이 추정(회차로 계산·월 단위)이거나 뒤 블록 시작이 하루 단위가 아니면 confirmed=false(추정 공백) — 화면은 붉은 경고 대신 회색.
 */
export interface GapSpan {
  from: string;
  to: string;
  endKnown?: boolean; // 끝이 하루 단위로 확인됨(기본 true)
  startKnown?: boolean; // 시작이 하루 단위로 확인됨(기본 true)
  placeholder?: boolean; // 끝을 모름(배치 폭)
}
export function findGaps(slotId: string, spans: GapSpan[], rangeFrom: string, rangeTo: string): GapDto[] {
  const sorted = [...spans].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? 1 : -1));
  // 겹침·맞닿음 합치기 — 블록 끝은 가장 늦게 끝나는 구간, 그 구간의 끝 확실성을 따른다
  const blocks: { from: string; to: string; endKnown: boolean; open: boolean; startKnown: boolean }[] = [];
  for (const s of sorted) {
    const endKnown = !s.placeholder && s.endKnown !== false;
    const cur = blocks[blocks.length - 1];
    if (cur && s.from <= addDays(cur.to, 1)) {
      if (s.to > cur.to) {
        cur.to = s.to;
        cur.endKnown = endKnown;
        cur.open = !!s.placeholder;
      } else if (s.to === cur.to) {
        cur.endKnown = cur.endKnown || endKnown;
        cur.open = cur.open && !!s.placeholder;
      }
    } else blocks.push({ from: s.from, to: s.to, endKnown, open: !!s.placeholder, startKnown: s.startKnown !== false });
  }
  const out: GapDto[] = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    const prev = blocks[i];
    const next = blocks[i + 1];
    if (prev.open) continue; // 앞 편성의 끝을 모른다 — 공백으로 단정하지 않는다
    const gapFrom = addDays(prev.to, 1);
    const gapTo = addDays(next.from, -1);
    const len = daysBetween(gapFrom, gapTo) + 1;
    if (len < 7) continue;
    if (gapTo < rangeFrom || gapFrom > rangeTo) continue;
    out.push({ slotId, from: gapFrom, to: gapTo, weeks: Math.round(len / 7), confirmed: prev.endKnown && next.startKnown });
  }
  return out;
}

/** 방송 시각 문자열('22:00', '21시', '2250', '금23') → 방송일 기준 분. 새벽 0~5시는 24시 이후로 본다. */
export function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, "");
  let h: number | null = null;
  let m = 0;
  let mm = t.match(/(\d{1,2}):(\d{2})/);
  if (mm) {
    h = Number(mm[1]);
    m = Number(mm[2]);
  } else if ((mm = t.match(/(?:^|[^\d])(\d{1,2})시(?:(\d{1,2})분?)?/))) {
    h = Number(mm[1]);
    m = mm[2] ? Number(mm[2]) : 0;
  } else if ((mm = t.match(/(?:^|[^\d])(\d{2})(\d{2})(?:$|[^\d])/))) {
    h = Number(mm[1]);
    m = Number(mm[2]);
  } else if ((mm = t.match(/[월화수목금토일](\d{1,2})$/))) {
    h = Number(mm[1]);
  }
  if (h === null || h > 29 || m > 59) return null;
  if (h < 6) h += 24;
  return h * 60 + m;
}

export const clockLabel = (minute: number | null) => {
  if (minute === null) return "";
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const DOW_CHARS = ["월", "화", "수", "목", "금", "토", "일"];
/** 요일 글자('월화', '토일', '금토', '수')를 isodow 배열로. */
export function parseDays(text: string | null | undefined): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const ch of text) {
    const i = DOW_CHARS.indexOf(ch);
    if (i >= 0 && !out.includes(i + 1)) out.push(i + 1);
  }
  return out.sort((a, b) => a - b);
}
export const daysLabel = (days: number[]) => [...days].sort((a, b) => a - b).map((d) => DOW_CHARS[d - 1]).join("");

/** 요일 묶음 → 경쟁 비교 묶음(월화 · 수목 · 주말 · 그 밖). */
export function compareBlockOf(days: number[]): "mon_tue" | "wed_thu" | "weekend" | "other" {
  if (days.length === 0) return "other";
  if (days.every((d) => d === 1 || d === 2)) return "mon_tue";
  if (days.every((d) => d === 3 || d === 4)) return "wed_thu";
  if (days.every((d) => d >= 5)) return "weekend";
  return "other";
}

/** 마지막 방송일 — 적힌 끝(하루 단위)이면 확정, 그 밖은 회차로 추정(≈). 끝을 모르면 null. */
export function lastAirOf(run: RunDto, slot: SlotDto, skip?: { from: string; to: string }[]): { date: string | null; estimated: boolean } {
  if (!run.startDate || run.endPrecision === "open") return { date: null, estimated: false };
  if (run.endDate) return { date: run.endDate, estimated: run.endPrecision !== "day" };
  if (run.episodes) return { date: estimateEnd(run.startDate, slot.days, run.episodes, 1, skip), estimated: true };
  return { date: null, estimated: false };
}
