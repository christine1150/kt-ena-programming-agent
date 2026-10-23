// 오래 낮은 자리(2026-10-23 약한 자리 확인 대기 5 — 사용자 승인) — 순수 함수(DB·네트워크 없음).
//
// 약한 자리 판정은 "평소(같은 자리 비교 회차)보다 낮아졌나"만 보므로, 8회 내내 낮은 자리는 '기준선 위'로 나온다.
// 그런 자리를 매일 경보와 섞지 않고 주간 점검 목록으로 따로 낸다.
// 정의: 자리 = 요일 × 방송 시(02시 기준). 최근 8주(기준일 포함 56일, 공휴일 제외) 방영이 4회 이상인 자리 중
//   ① 같은 시간대 구간(02-05 … 23-26, 3시간, 8대 슬롯) 자리들 중앙값의 하위 20% 안이고
//   ② 최근 8회(있는 만큼) 모두 그 구간 하위 20%선 아래이며
//   ③ 그 구간 하위 20%선이 0보다 클 때(새벽처럼 구간 전체가 0이면 측정 하한이라 뺀다).
// 2026-10-22 기준 채널별 걸린 자리(운영 계산): ENA 2 · ENA Drama 1 · ENA Story 1 · OLIFE 2 · ENA Play·ONCE 0.
// 하위 20%만 쓰면 채널당 32~51자리(정의상 늘 20%)라 주간 목록이 되지 않아 ②·③을 더했다(docs/weak-slot-verdict/WEAK_SLOT_VERDICT.md §5).

export const LONG_LOW_DAYS = 56;
export const LONG_LOW_MIN_AIRINGS = 4;
export const LONG_LOW_QUANTILE = 0.2;
export const LONG_LOW_RECENT = 8;

export interface LowSlotAiring {
  date: string;
  dow: number; // 1=월 … 7=일
  startMin: number; // 방송일 분(02시 이전은 +24시간)
  name: string;
  rating: number;
}

export interface LongLowSlot {
  dow: number;
  hour: number; // 방송일 시(24·25 = 다음 날 0·1시)
  median: number;
  bandMedian: number;
  bandLine: number; // 구간 하위 20%선
  airings: number;
  /** 이 자리에 가장 많이 나온 프로그램 */
  program: string;
}

export const bandOf = (hour: number) => Math.floor((hour - 2) / 3); // 0=02-05 … 7=23-26
export const bandLabel = (band: number) => `${String(2 + band * 3).padStart(2, "0")}~${String((2 + band * 3 + 3) % 24).padStart(2, "0")}시`;

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 864e5;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? NaN : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const quantile = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** airings: 공휴일을 뺀 방영. asOf 이후와 56일보다 오래된 방영은 쓰지 않는다. 결과는 구간 중앙값 대비 낮은 순. */
export function findLongLowSlots(airings: LowSlotAiring[], asOf: string): LongLowSlot[] {
  const from = dayNum(asOf) - LONG_LOW_DAYS;
  const slots = new Map<string, { dow: number; hour: number; list: LowSlotAiring[] }>();
  for (const a of airings) {
    const d = dayNum(a.date);
    if (d <= from || a.date > asOf || !Number.isFinite(a.rating)) continue;
    const hour = Math.floor(a.startMin / 60);
    const k = `${a.dow}|${hour}`;
    const s = slots.get(k) ?? { dow: a.dow, hour, list: [] };
    s.list.push(a);
    slots.set(k, s);
  }
  const rows = [...slots.values()].filter((s) => s.list.length >= LONG_LOW_MIN_AIRINGS).map((s) => ({ ...s, m: median(s.list.map((x) => x.rating)) }));
  const byBand = new Map<number, typeof rows>();
  for (const r of rows) byBand.set(bandOf(r.hour), [...(byBand.get(bandOf(r.hour)) ?? []), r]);
  const out: LongLowSlot[] = [];
  for (const list of byBand.values()) {
    const ms = list.map((r) => r.m);
    const line = quantile(ms, LONG_LOW_QUANTILE);
    const bm = median(ms);
    if (!(line > 0)) continue;
    for (const r of list) {
      const recent = [...r.list].sort((p, q) => (p.date < q.date ? -1 : 1)).slice(-LONG_LOW_RECENT);
      if (r.m > line || !recent.every((x) => x.rating <= line)) continue;
      const count = new Map<string, number>();
      for (const x of r.list) count.set(x.name, (count.get(x.name) ?? 0) + 1);
      const program = [...count].sort((p, q) => q[1] - p[1])[0][0];
      out.push({ dow: r.dow, hour: r.hour, median: r.m, bandMedian: bm, bandLine: line, airings: r.list.length, program });
    }
  }
  return out.sort((p, q) => p.median / (p.bandMedian || 1) - q.median / (q.bandMedian || 1));
}
