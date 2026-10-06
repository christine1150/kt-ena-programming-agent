// 방송 구간 계산(단계 03) — 모든 시간대·프라임·경쟁 겹침 계산이 같은 구간 정의를 쓰도록 한 곳에서 만든다.
// 닐슨 방송일은 02:00~다음 날 02:00이다. 저장된 시각(start_time/end_time)은 시계 시각(00:25 등)이므로, 2시 미만은 +24시간으로 올려
// 24·25시를 "다음 날"로 재분류하지 않고 같은 방송일 안의 시각으로 다룬다. 구간은 항상 반개구간 [start, end)다.

export const BROADCAST_DAY_START_HOUR = 2;
export const TIMEZONE = "Asia/Seoul";
const DAY = 86400;

/** 공급자(닐슨)가 종료 시각을 방송에 포함하는지는 확인되지 않았다 — 종료 시각 자체는 포함하지 않는(반개구간) 것으로 가정하고,
 *  이 가정과 미확인 상태를 계산 결과(메타데이터)에 그대로 싣는다. 공급자 정의가 확인되면 이 상수 한 곳만 바꾼다. */
export const END_CONVENTION = { kind: "exclusive_assumed", verified: false, note: "종료 시각은 방송에 포함되지 않는 반개구간 [시작, 종료)으로 정규화(공급자 정의 미확인)" } as const;

/** "HH:MM:SS"(시 0~29) → 하루 안의 초. 형식이 다르면 null. */
export function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (mi > 59 || s > 59 || h > 29) return null;
  return h * 3600 + mi * 60 + s;
}

/** 시계 시각 → 방송일 기준 초(02:00=7200 … 25:59:59=93599). 2시 미만은 +24시간. */
export function clockToBroadcastSeconds(clock: string | null | undefined): number | null {
  const c = parseClock(clock);
  if (c === null) return null;
  return c < BROADCAST_DAY_START_HOUR * 3600 ? c + DAY : c;
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
const pad = (n: number) => String(n).padStart(2, "0");

/** 방송일+방송 초 → 달력 날짜시각(ISO, +09:00). 25:30은 다음 달력일 01:30으로 표기하되 방송일은 따로 보존한다. */
export function calendarDateTime(broadcastDate: string, sec: number): string {
  const days = Math.floor(sec / DAY);
  const rem = sec - days * DAY;
  const d = new Date((dayNumber(broadcastDate) + days) * 86400000).toISOString().slice(0, 10);
  return `${d}T${pad(Math.floor(rem / 3600))}:${pad(Math.floor((rem % 3600) / 60))}:${pad(rem % 60)}+09:00`;
}

export interface BroadcastInterval {
  broadcastDate: string;
  /** 방송일 시작(00:00) 기준 초. 25:30 = 91800 */
  startSec: number;
  endSec: number;
  durationSec: number;
  /** 날짜가 다른 구간끼리 비교하기 위한 절대 초(방송일 일수 × 86400 + 방송 초) */
  absStart: number;
  absEnd: number;
  calendarStart: string;
  calendarEnd: string;
  timezone: typeof TIMEZONE;
  endConvention: typeof END_CONVENTION;
}

export interface IntervalResult {
  interval: BroadcastInterval | null;
  /** 구간을 만들 수 없을 때(시각 없음·형식 오류·길이 0)의 이유 */
  issue: string | null;
}

/** 방송 한 건의 구간. 종료가 시작보다 이르면 자정을 넘긴 것으로 보고 +24시간한다(01:30~03:00은 25:30~27:00). */
export function airingInterval(broadcastDate: string, startClock: string | null | undefined, endClock: string | null | undefined): IntervalResult {
  const s = clockToBroadcastSeconds(startClock);
  if (s === null) return { interval: null, issue: "시작 시각이 없거나 형식이 올바르지 않습니다" };
  const rawEnd = clockToBroadcastSeconds(endClock);
  if (rawEnd === null) return { interval: null, issue: "종료 시각이 없어 구간을 만들 수 없습니다(종료를 추정하지 않음)" };
  if (rawEnd === s) return { interval: null, issue: "방송 길이가 0초입니다(시작과 종료가 같음)" };
  const e = rawEnd < s ? rawEnd + DAY : rawEnd;
  const base = dayNumber(broadcastDate) * DAY;
  return {
    interval: {
      broadcastDate,
      startSec: s,
      endSec: e,
      durationSec: e - s,
      absStart: base + s,
      absEnd: base + e,
      calendarStart: calendarDateTime(broadcastDate, s),
      calendarEnd: calendarDateTime(broadcastDate, e),
      timezone: TIMEZONE,
      endConvention: END_CONVENTION,
    },
    issue: null,
  };
}

/** 두 구간의 교집합 길이(초, 반개구간). 38초 겹침은 38. 맞닿기만 하면 0. */
export function overlapSeconds(a: Pick<BroadcastInterval, "absStart" | "absEnd">, b: Pick<BroadcastInterval, "absStart" | "absEnd">): number {
  return Math.max(0, Math.min(a.absEnd, b.absEnd) - Math.max(a.absStart, b.absStart));
}

/** 방송일 안의 [fromSec, toSec) 구간과의 교집합 길이. */
export function overlapWithWindow(i: Pick<BroadcastInterval, "startSec" | "endSec">, fromSec: number, toSec: number): number {
  return Math.max(0, Math.min(i.endSec, toSec) - Math.max(i.startSec, fromSec));
}

/** 방송 한 건을 시(2~25) 버킷에 실제 겹친 초로 나눈다. 26시 이후(다음 방송일 새벽)는 같은 시계 시각 버킷(h−24)으로 접는다. */
export function allocateByHour(i: Pick<BroadcastInterval, "startSec" | "endSec">): Map<number, number> {
  const out = new Map<number, number>();
  const firstHour = Math.floor(i.startSec / 3600);
  const lastHour = Math.floor((i.endSec - 1) / 3600);
  for (let h = firstHour; h <= lastHour; h++) {
    const sec = overlapWithWindow(i, h * 3600, (h + 1) * 3600);
    if (sec <= 0) continue;
    const bucket = h >= 26 ? h - 24 : h;
    out.set(bucket, (out.get(bucket) ?? 0) + sec);
  }
  return out;
}

export type Adjacency = "gap" | "adjacent" | "overlap" | "duplicate";

export interface LayoutFinding {
  kind: Adjacency;
  a: number; // 정렬된 목록에서의 인덱스
  b: number;
  seconds: number; // gap이면 공백 길이, overlap이면 겹친 길이, adjacent·duplicate는 0 또는 길이
}

/** 하루(또는 연속된) 방송 목록의 배치 점검: 광고·프로모 공백(gap), 끝과 시작이 맞닿음(adjacent), 겹침(overlap), 같은 구간 중복(duplicate). */
export function analyzeLayout(items: Pick<BroadcastInterval, "absStart" | "absEnd">[]): LayoutFinding[] {
  const idx = items.map((_, i) => i).sort((x, y) => items[x].absStart - items[y].absStart || items[x].absEnd - items[y].absEnd);
  const out: LayoutFinding[] = [];
  for (let k = 1; k < idx.length; k++) {
    const prev = items[idx[k - 1]];
    const cur = items[idx[k]];
    if (prev.absStart === cur.absStart && prev.absEnd === cur.absEnd) out.push({ kind: "duplicate", a: idx[k - 1], b: idx[k], seconds: cur.absEnd - cur.absStart });
    else if (cur.absStart < prev.absEnd) out.push({ kind: "overlap", a: idx[k - 1], b: idx[k], seconds: Math.min(prev.absEnd, cur.absEnd) - cur.absStart });
    else if (cur.absStart === prev.absEnd) out.push({ kind: "adjacent", a: idx[k - 1], b: idx[k], seconds: 0 });
    else out.push({ kind: "gap", a: idx[k - 1], b: idx[k], seconds: cur.absStart - prev.absEnd });
  }
  return out;
}
