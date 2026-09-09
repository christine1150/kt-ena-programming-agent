/**
 * 주요시간(프라임) 정의 — 이 프로젝트의 유일한 소스.
 *
 * 2026-09-09 사용자 확정: 평일은 19~23시, 토·일·공휴일은 18~23시.
 * 경계는 이 프로젝트의 기존 관례대로 반열림(`>= from && < to`)이므로
 * "19~23시"는 19·20·21·22시대를 뜻하고 23시대는 포함하지 않는다.
 *
 * 이 파일이 존재하는 이유: 그 전까지 프라임이 코드에 세 가지로 서로 다르게 박혀 있었다 —
 * 20~24시(1페이지 월간 리뷰·PPT 덱·월간 드라이버 SQL 기본값)와 17~23시(Fit Score 전이성 판정).
 * 사용자 지시로 전 시스템을 하나로 통일하면서, 정의가 다시 갈라지지 않도록 프라임을 쓰는 모든
 * 코드가 이 파일만 import하도록 한다. 시간 범위를 각 지점에서 다시 적지 말 것.
 */

/** 방송 시간대는 2시 미만을 +24로 밀어 2~25시로 다룬다(닐슨 관행, get_hourly_rating_pattern과 동일). */
export const PRIME = {
  weekdayFrom: 19,
  weekdayTo: 23,
  weekendFrom: 18,
  weekendTo: 23,
} as const;

export const PRIME_LABEL = "평일 19~23시 · 토·일·공휴일 18~23시";
export const PRIME_SHORT_LABEL = "주요시간";

/** 평일 / 주말·공휴일. 공휴일은 토·일과 동일하게 취급한다. */
export type DayType = "weekday" | "weekend";

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: "평일",
  weekend: "주말·공휴일",
};

/** RPC에 그대로 넘기는 프라임 파라미터 묶음 — 호출부마다 숫자를 다시 적지 않기 위함. */
export const PRIME_RPC_ARGS = {
  p_weekday_prime_from: PRIME.weekdayFrom,
  p_weekday_prime_to: PRIME.weekdayTo,
  p_weekend_prime_from: PRIME.weekendFrom,
  p_weekend_prime_to: PRIME.weekendTo,
} as const;

export function primeRangeFor(dayType: DayType): { from: number; to: number } {
  return dayType === "weekend"
    ? { from: PRIME.weekendFrom, to: PRIME.weekendTo }
    : { from: PRIME.weekdayFrom, to: PRIME.weekdayTo };
}

/** 정규화된 방송 시간(2~25)이 그 날짜 유형의 프라임에 드는지. */
export function isPrimeHour(dayType: DayType, broadcastHour: number): boolean {
  const { from, to } = primeRangeFor(dayType);
  return broadcastHour >= from && broadcastHour < to;
}

/**
 * "YYYY-MM-DD"가 토·일이거나 공휴일이면 weekend.
 * holidayDates는 공휴일 날짜 문자열 집합(public_holidays 테이블에서 조회한 것).
 * 집합에 없는 날짜는 추정하지 않고 평일로 본다 — 억지 추정 금지.
 */
export function dayTypeOf(dateStr: string, holidayDates: ReadonlySet<string>): DayType {
  if (holidayDates.has(dateStr)) return "weekend";
  const jsDow = new Date(`${dateStr}T00:00:00`).getDay(); // 0=일 … 6=토
  return jsDow === 0 || jsDow === 6 ? "weekend" : "weekday";
}

/** isodow(1=월 … 7=일) 기준. 공휴일 여부를 모르는 자리에서 요일만으로 판정할 때 쓴다. */
export function isWeekendIsoDow(isoDow: number): boolean {
  return isoDow >= 6;
}

/**
 * 평일·주말 프라임의 합집합(18~23시).
 *
 * 여러 날짜를 시각(hour) 하나로 이미 집계해 버려 요일 정보가 남아 있지 않은 자리 —
 * 시간대별 평균 차트, Fit Score 전이성 판정 등 — 에서만 쓴다. 그런 자리에서는
 * "평일 18시(비프라임)"와 "토요일 18시(프라임)"를 구분할 수 없으므로 합집합으로 판정한다.
 * 날짜가 살아 있는 계산에서는 반드시 dayTypeOf() + isPrimeHour()를 써야 한다.
 */
export const PRIME_UNION_FROM = Math.min(PRIME.weekdayFrom, PRIME.weekendFrom);
export const PRIME_UNION_TO = Math.max(PRIME.weekdayTo, PRIME.weekendTo);
export const PRIME_UNION_LABEL = `${PRIME_UNION_FROM}~${PRIME_UNION_TO}시`;

export const PRIME_HOURS_UNION: readonly number[] = range(PRIME_UNION_FROM, PRIME_UNION_TO);

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let h = from; h < to; h += 1) out.push(h);
  return out;
}
