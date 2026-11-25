// 라인업 날짜 계산 — 순수 함수(서버에서 계산해 화면은 그리기만 한다. docs/lineup/LINEUP_DESIGN.md §3·§4).
// 날짜는 모두 'YYYY-MM-DD' 문자열(KST 방송일 기준)로 다룬다. 시각 계산을 하지 않으므로 UTC 자정으로 고정해 더하고 뺀다.
import type { DrawSpan, EndPrecision, GapDto, RunKind, StartPrecision } from "./types";

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
export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toMs(v));

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

/** 회차 수와 주당 방송 횟수로 끝(마지막 방송일)을 추정한다. 저장하지 않고 그릴 때만 쓴다. */
export function estimateEnd(start: string, days: number[], episodes: number, episodesPerAiring = 1): string {
  const airings = Math.min(400, Math.max(1, Math.ceil(episodes / Math.max(1, episodesPerAiring))));
  let d = firstAirOnOrAfter(start, days);
  // 방송 요일만 세어 앞으로 간다(결방은 모른다 — 추정이므로 흐리게 그린다).
  for (let count = 1; count < airings; ) {
    d = addDays(d, 1);
    if (days.length === 0 || days.includes(isoDow(d))) count++;
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

/** 실제(또는 추정) 마지막 방송일 — 맞대결 계산용. 끝을 모르면 회차로 추정, 회차도 모르면 시작 후 4주로 본다. */
export function effectiveEnd(run: DrawInput, days: number[], horizon: string): { end: string | null; estimated: boolean } {
  if (!run.startDate) return { end: null, estimated: false };
  if (run.endPrecision === "open") return { end: horizon, estimated: false };
  if (run.endDate) return { end: run.endDate, estimated: false };
  if (run.episodes) return { end: estimateEnd(run.startDate, days, run.episodes), estimated: true };
  return { end: addDays(run.startDate, 27), estimated: true };
}

/**
 * 그리기 구간 — 모양과 그릴 시작·끝. 실제 날짜는 바꾸지 않는다(글자·패널·목록은 실제 날짜).
 * - 월 단위 정밀도 → 범위 괄호(bracket): 시작 달 1일 ~ 끝 달 말일
 * - 월 1회 → 방송일 점(dots), 단발·이틀 행사 → 마름모(diamond)
 * - 미정·결방·수급 → 상자(box), 그 밖 → 막대(bar). 막대·상자의 끝은 자리 점유 규칙으로 늘린다.
 */
export function drawSpan(run: DrawInput, days: number[], horizon: string): DrawSpan | null {
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
  const { end, estimated } = effectiveEnd(run, days, horizon);
  if (!end) return null;
  const to = run.endPrecision === "open" ? end : occupancyEnd(end, days);
  // 추정 끝은 마지막 1주만 흐리게(앞은 회차로 꽤 믿을 만하다).
  const estimatedFrom = estimated ? (daysBetween(run.startDate, to) > 7 ? addDays(to, -6) : run.startDate) : null;
  return { shape, from: run.startDate, to, estimatedFrom, dates: null };
}

/** 두 자리·구간이 맞대결인지: 같은 요일이 하나라도 겹치고, 시작 시각 차이 ±60분 이내, 실제 방송 기간이 겹친다.
 *  처음엔 ±90분이었으나 실제 자료에서 앞뒤 시간대(19:55 ↔ 21:20) 작품까지 잡혀 60분으로 좁혔다(드라마 한 회 ≈ 60~70분, 2026-11-25). */
export function isHeadToHead(
  a: { days: number[]; startMinute: number | null; from: string; to: string },
  b: { days: number[]; startMinute: number | null; from: string; to: string },
  windowMinutes = 60
): boolean {
  if (!a.days.some((d) => b.days.includes(d))) return false;
  if (a.startMinute === null || b.startMinute === null) return false;
  if (Math.abs(a.startMinute - b.startMinute) > windowMinutes) return false;
  return a.from <= b.to && b.from <= a.to;
}

/** 한 자리의 연속 편성 구간 사이 빈 주(그리기 끝 다음 날 ~ 다음 시작 전날)가 7일 이상이면 빈 주로 낸다. */
export function findGaps(slotId: string, spans: { from: string; to: string }[], rangeFrom: string, rangeTo: string): GapDto[] {
  const sorted = [...spans].sort((a, b) => (a.from < b.from ? -1 : 1));
  const out: GapDto[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const gapFrom = addDays(sorted[i].to, 1);
    const gapTo = addDays(sorted[i + 1].from, -1);
    // 앞 구간이 뒤 구간보다 늦게 끝나면(겹침) 빈 주가 아니다.
    if (sorted.slice(0, i + 1).some((s) => s.to >= sorted[i + 1].from)) continue;
    const len = daysBetween(gapFrom, gapTo) + 1;
    if (len < 7) continue;
    if (gapTo < rangeFrom || gapFrom > rangeTo) continue;
    out.push({ slotId, from: gapFrom, to: gapTo, weeks: Math.round(len / 7) });
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
