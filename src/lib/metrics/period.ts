// 공통 기간 정의(단계 02) — 모든 화면·보고서가 같은 이름의 기간과 비교 기준을 쓰도록 한 곳에서 정의한다.
// 이미 여러 세션에 걸쳐 검증된 audienceReport/periodPresets.ts의 날짜 수학을 새로 만들지 않고 그대로 호출하고,
// 거기에 없던 "완결주 WoW"·"완결월 MoM"·동요일 기준만 더한다. 날짜는 모두 방송일(YYYY-MM-DD, 02:00~다음 날 02:00)이다.
import {
  addDaysStr,
  addMonthsClampedStr,
  computeComparisonRange,
  startOfWeekStr,
  toDateStr,
} from "@/lib/audienceReport/periodPresets";

export type PeriodKind =
  | "day" // 일 vs 전일(DoD)
  | "same_dow" // 일 vs 최근 N주 같은 요일
  | "week_completed" // 완결 월~일 주 vs 직전 완결주(WoW)
  | "wtd" // 이번 주 월요일~기준일 vs 직전 주 같은 경과 일수
  | "mtd_same_days" // 월누계 vs 전월 같은 일수(기존 "MoM" 동작)
  | "month_completed" // 완결 달력월 vs 직전 완결월(MoM)
  | "rolling7" // 최근 7일 vs 직전 7일(기존 "WoW" 동작)
  | "rolling30" // 최근 30일 vs 직전 30일
  | "qtd" // 분기누계 vs 전분기 같은 경과 일수
  | "ytd_yoy"; // 연누계 vs 전년 같은 기간(YoY)

export interface DateRange {
  from: string;
  to: string;
  days: number;
}

export interface PeriodSpec {
  kind: PeriodKind;
  period: DateRange;
  /** 비교 기준 범위. same_dow는 아래 baselineDates의 최소~최대 */
  comparison: DateRange;
  /** same_dow처럼 비교 기준이 연속 구간이 아닌 날짜 집합일 때 */
  baselineDates?: string[];
  label: string;
  comparisonLabel: string;
  /** 비교 기준 일수가 이번 기간과 다르면 true(월말 클램프 등) — 일수가 다른 비교임을 표시해야 한다 */
  comparisonLengthDiffers: boolean;
  notes: string[];
}

export const PERIOD_KIND_LABEL: Record<PeriodKind, { label: string; comparisonLabel: string }> = {
  day: { label: "일간", comparisonLabel: "전일" },
  same_dow: { label: "일간", comparisonLabel: "같은 요일 평균" },
  week_completed: { label: "완결주(월~일)", comparisonLabel: "직전 완결주" },
  wtd: { label: "주 누계(WTD)", comparisonLabel: "직전 주 같은 경과 일수" },
  mtd_same_days: { label: "월 누계(MTD)", comparisonLabel: "전월 같은 일수" },
  month_completed: { label: "완결월", comparisonLabel: "직전 완결월" },
  rolling7: { label: "최근 7일", comparisonLabel: "직전 7일" },
  rolling30: { label: "최근 30일", comparisonLabel: "직전 30일" },
  qtd: { label: "분기 누계(QTD)", comparisonLabel: "전분기 같은 경과 일수" },
  ytd_yoy: { label: "연 누계(YTD)", comparisonLabel: "전년 같은 기간" },
};

/** 기존 PeriodPreset(audienceReport/periodPresets.ts)과 공통 기간 종류의 대응. 이름만 명료화했고 날짜 계산은 같은 함수를 쓴다. */
export const PRESET_TO_KIND = {
  dod: "day",
  wow: "rolling7",
  mom: "mtd_same_days",
  qoq: "qtd",
  yoy: "ytd_yoy",
  wtd: "wtd",
  last30: "rolling30",
} as const satisfies Record<string, PeriodKind>;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const rangeOf = (from: string, to: string): DateRange => ({ from, to, days: dayDiff(from, to) + 1 });
const lastDayOfMonth = (y: number, m1: number) => new Date(y, m1, 0).getDate(); // m1: 1~12

/** 방송일 02:00~다음 날 02:00 — 달력 시각(날짜+HH:mm)이 속한 방송일. 01:30은 전날 방송일의 25:30이다. */
export function broadcastDateOfCalendar(date: string, hhmm: string): string {
  const hour = Number(hhmm.split(":")[0]);
  return hour < 2 ? addDaysStr(date, -1) : date;
}

/** 기준일(최신 수신일)까지 지난 마지막 완결 월~일 주. 기준일이 일요일이면 그 주가 완결이다. */
export function completedWeekOnOrBefore(latest: string): DateRange {
  const monday = startOfWeekStr(latest);
  const sunday = addDaysStr(monday, 6);
  if (sunday <= latest) return rangeOf(monday, sunday);
  const prevMonday = addDaysStr(monday, -7);
  return rangeOf(prevMonday, addDaysStr(prevMonday, 6));
}

/** 기준일까지 지난 마지막 완결 달력월. 기준일이 그 달 말일이면 그 달이 완결이다. */
export function completedMonthOnOrBefore(latest: string): DateRange {
  const y = Number(latest.slice(0, 4));
  const m = Number(latest.slice(5, 7));
  if (Number(latest.slice(8, 10)) === lastDayOfMonth(y, m)) return rangeOf(`${latest.slice(0, 7)}-01`, latest);
  const firstThis = `${latest.slice(0, 7)}-01`;
  const lastPrev = addDaysStr(firstThis, -1);
  return rangeOf(`${lastPrev.slice(0, 7)}-01`, lastPrev);
}

export function resolvePeriodSpec(kind: PeriodKind, latest: string, opts: { weeksBack?: number } = {}): PeriodSpec {
  const names = PERIOD_KIND_LABEL[kind];
  const notes: string[] = [];
  const done = (period: DateRange, comparison: DateRange, extra: Partial<PeriodSpec> = {}): PeriodSpec => ({
    kind,
    period,
    comparison,
    label: names.label,
    comparisonLabel: names.comparisonLabel,
    comparisonLengthDiffers: period.days !== comparison.days,
    notes,
    ...extra,
  });
  switch (kind) {
    case "day": {
      const c = computeComparisonRange(latest, "dod");
      return done(rangeOf(c.from, c.to), rangeOf(c.priorFrom, c.priorTo));
    }
    case "same_dow": {
      const n = Math.max(1, opts.weeksBack ?? 4);
      const baselineDates = Array.from({ length: n }, (_, i) => addDaysStr(latest, -7 * (i + 1))).reverse();
      return done(rangeOf(latest, latest), rangeOf(baselineDates[0], baselineDates[n - 1]), {
        baselineDates,
        comparisonLabel: n === 1 ? "전주 같은 요일" : `최근 ${n}주 같은 요일 평균`,
        comparisonLengthDiffers: false,
      });
    }
    case "week_completed": {
      const w = completedWeekOnOrBefore(latest);
      return done(w, rangeOf(addDaysStr(w.from, -7), addDaysStr(w.from, -1)));
    }
    case "wtd": {
      const from = startOfWeekStr(latest);
      const period = rangeOf(from, latest);
      const priorFrom = addDaysStr(from, -7);
      return done(period, rangeOf(priorFrom, addDaysStr(priorFrom, period.days - 1)));
    }
    case "mtd_same_days": {
      const c = computeComparisonRange(latest, "mom");
      const spec = done(rangeOf(c.from, c.to), rangeOf(c.priorFrom, c.priorTo));
      if (spec.comparisonLengthDiffers) notes.push(`전월은 ${spec.comparison.days}일뿐이라 같은 일수(${spec.period.days}일)로 맞출 수 없습니다 — 전월 말일까지로 비교합니다.`);
      return spec;
    }
    case "month_completed": {
      const m = completedMonthOnOrBefore(latest);
      const priorLast = addDaysStr(m.from, -1);
      return done(m, rangeOf(`${priorLast.slice(0, 7)}-01`, priorLast));
    }
    case "rolling7": {
      const c = computeComparisonRange(latest, "wow");
      return done(rangeOf(c.from, c.to), rangeOf(c.priorFrom, c.priorTo));
    }
    case "rolling30": {
      const from = addDaysStr(latest, -29);
      return done(rangeOf(from, latest), rangeOf(addDaysStr(from, -30), addDaysStr(from, -1)));
    }
    case "qtd": {
      const c = computeComparisonRange(latest, "qoq");
      const spec = done(rangeOf(c.from, c.to), rangeOf(c.priorFrom, c.priorTo));
      if (spec.comparisonLengthDiffers) notes.push(`전분기는 ${spec.comparison.days}일이라 같은 일수(${spec.period.days}일)로 맞출 수 없습니다.`);
      return spec;
    }
    case "ytd_yoy": {
      const c = computeComparisonRange(latest, "yoy");
      const spec = done(rangeOf(c.from, c.to), rangeOf(c.priorFrom, c.priorTo));
      if (spec.comparisonLengthDiffers) notes.push(`전년은 ${spec.comparison.days}일이라 같은 일수(${spec.period.days}일)가 아닙니다(윤년 영향).`);
      return spec;
    }
  }
}

export function datesIn(range: { from: string; to: string }): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

export interface Coverage {
  expectedDays: number;
  presentDays: number;
  missingDates: string[];
  complete: boolean;
}

/** 기간 안에서 실제로 수신된 날짜 수 — 부분 수신이면 complete=false(누락일을 0으로 채우지 않는다). */
export function coverageOf(range: { from: string; to: string }, datesWithData: Iterable<string>): Coverage {
  const have = new Set(datesWithData);
  const all = datesIn(range);
  const missingDates = all.filter((d) => !have.has(d));
  return { expectedDays: all.length, presentDays: all.length - missingDates.length, missingDates, complete: missingDates.length === 0 };
}

export { addMonthsClampedStr, toDateStr };
