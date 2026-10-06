// 프라임(주요시간) 계산(단계 03) — 채널·적용기간별 규칙표와 [시작,끝) 교집합 길이 계산. 프라임 시간대 자체의 단일 소스는
// audienceReport/primeTime.ts의 PRIME(평일 19~23, 토·일·공휴일 18~23)이고, 여기서는 그 값을 규칙표의 기본 행으로 쓰고 경계를 가로지르는
// 방송을 겹침 초로 처리한다. 공휴일 달력은 버전·시간대와 함께 관리한다.
import { PRIME, dayTypeOf, type DayType } from "@/lib/audienceReport/primeTime";
import { TIMEZONE, overlapWithWindow, type BroadcastInterval } from "./interval";

export interface PrimeWindow {
  fromHour: number;
  toHour: number;
}

export interface PrimeRule {
  /** 채널 코드 또는 "*"(전체) */
  channelCode: string;
  /** 적용 시작일(포함). null = 처음부터 */
  validFrom: string | null;
  /** 적용 종료일(포함). null = 현재까지 */
  validTo: string | null;
  weekday: PrimeWindow;
  weekend: PrimeWindow;
  source: string;
}

/** 프라임 규칙표 — 채널·기간별 예외는 여기에 행을 추가한다(구체적인 채널 행이 "*" 행보다 우선, 같으면 나중 시작일 우선). */
export const PRIME_RULES: PrimeRule[] = [
  {
    channelCode: "*",
    validFrom: null,
    validTo: null,
    weekday: { fromHour: PRIME.weekdayFrom, toHour: PRIME.weekdayTo },
    weekend: { fromHour: PRIME.weekendFrom, toHour: PRIME.weekendTo },
    source: "사용자 확정 2026-09-09(평일 19~23시, 토·일·공휴일 18~23시, 반열림)",
  },
];

export function primeRuleFor(channelCode: string, date: string, rules: PrimeRule[] = PRIME_RULES): PrimeRule | null {
  const hits = rules.filter((r) => (r.channelCode === "*" || r.channelCode === channelCode) && (r.validFrom === null || date >= r.validFrom) && (r.validTo === null || date <= r.validTo));
  if (hits.length === 0) return null;
  hits.sort((a, b) => Number(b.channelCode === channelCode) - Number(a.channelCode === channelCode) || (b.validFrom ?? "").localeCompare(a.validFrom ?? ""));
  return hits[0];
}

export interface PrimeOverlap {
  dayType: DayType;
  primeSeconds: number;
  totalSeconds: number;
  /** 방송 길이 중 프라임에 걸친 비율 */
  primeShare: number;
}

/** 방송 한 건이 그 방송일의 프라임 창과 겹친 초. 18:30~19:30 방송은 평일 프라임(19~23)과 30분만 겹친다. */
export function primeOverlap(interval: BroadcastInterval, rule: PrimeRule, holidays: ReadonlySet<string>): PrimeOverlap {
  const dayType = dayTypeOf(interval.broadcastDate, holidays);
  const w = dayType === "weekend" ? rule.weekend : rule.weekday;
  const sec = overlapWithWindow(interval, w.fromHour * 3600, w.toHour * 3600);
  return { dayType, primeSeconds: sec, totalSeconds: interval.durationSec, primeShare: interval.durationSec > 0 ? sec / interval.durationSec : 0 };
}

export interface HolidayCalendarMeta {
  /** 날짜 집합의 지문 — 달력이 바뀌면 달라진다 */
  version: string;
  timezone: typeof TIMEZONE;
  count: number;
  /** 가장 이른·늦은 날짜(달력 범위) */
  range: { from: string; to: string } | null;
}

export function describeHolidayCalendar(dates: Iterable<string>): HolidayCalendarMeta {
  const sorted = [...new Set(dates)].sort();
  let h = 0x811c9dc5;
  for (const ch of sorted.join(",")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { version: `hc-${h.toString(16).padStart(8, "0")}`, timezone: TIMEZONE, count: sorted.length, range: sorted.length ? { from: sorted[0], to: sorted[sorted.length - 1] } : null };
}
