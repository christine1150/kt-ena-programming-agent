// 비교군 우수 사례 — 격차 자리(고도화 B2, docs/upgrade-plan/B2_BENCHMARK_PATTERNS.md §1) 순수 함수(DB·네트워크 없음).
// 자리 = 평일/주말 × 8대 시간대(방송일 02시 기준). 자리 지수 = 그 자리의 방영 분 가중 시청률 ÷ 채널 평균 — 채널 안에서 그 자리가 얼마나 강한가의 "모양"이다(절대 시청률 비교가 아님).
// 격차 자리 = 우리 자리 지수가 벤치마크 중앙값보다 GAP_MARGIN 이상 낮은 자리(벤치마크 2곳 이상일 때만). 기대 효과 수치는 만들지 않는다.

export const SLOT_DAYPARTS = ["02-05", "05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02"] as const;
export const GAP_MARGIN = 0.2;
export const MIN_BENCH_CHANNELS = 2;
/** 자리 하나를 비교에 쓰는 최소 방영 분(채널 52주 합) */
export const MIN_SLOT_MINUTES = 600;
export const MAX_GAPS = 3;
export const TAGGED_SHARE_MIN = 0.3;

/** 한 방영(자사·경쟁 공통). tag는 프로그램명의 <본>·<재> 표기(없으면 null) */
export interface SlotAiring {
  /** 요일(월=1 … 일=7), 방송일 기준 */
  dow: number;
  /** 시작 분(02시 기준 방송일, 24시 이후는 24*60+) */
  startMin: number;
  /** 방영 분(최소 1) */
  dur: number;
  rating: number;
  name: string;
  tag: "본" | "재" | null;
}

export interface SlotStat {
  minutes: number;
  /** 자리 지수(채널 평균 대비). 채널 평균이 없으면 null */
  index: number | null;
  /** 방영 분이 많은 순 상위 3개 작품 */
  topTitles: string[];
  /** 재방 비중(0~1). 본·재 표기가 30% 미만인 채널은 null(숨김) */
  rerunShare: number | null;
}
export type SlotStats = Record<string, SlotStat>;

export function daypartOf(startMin: number): (typeof SLOT_DAYPARTS)[number] {
  const h = Math.floor(startMin / 60);
  return h < 5 ? "02-05" : h < 8 ? "05-08" : h < 11 ? "08-11" : h < 14 ? "11-14" : h < 17 ? "14-17" : h < 20 ? "17-20" : h < 23 ? "20-23" : "23-02";
}
export const slotKeyOf = (a: Pick<SlotAiring, "dow" | "startMin">) => `${a.dow >= 6 ? "WE" : "WD"}|${daypartOf(a.startMin)}`;
export function slotLabel(slot: string): string {
  const [dt, dp] = slot.split("|");
  return `${dt === "WE" ? "주말" : "평일"} ${dp.split("-").map((v) => String(Number(v)).padStart(2, "0")).join("~")}시`;
}

const median = (v: number[]): number | null => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const r3 = (v: number) => Math.round(v * 1000 + 1e-9) / 1000;

/**
 * 채널 방영(최근 52주)의 자리별 통계. 표기 규칙: <재>만 쓰는 채널은 무표기=본방, <본>만 쓰는 채널은 무표기=재방이며,
 * 둘 다 거의 없으면(표기 30% 미만) 재방 비중을 숨긴다.
 */
export function computeSlotStats(airings: readonly SlotAiring[]): SlotStats {
  const total = airings.reduce((s, a) => s + a.dur, 0);
  if (total === 0) return {};
  const chanAvg = airings.reduce((s, a) => s + a.rating * a.dur, 0) / total;
  const nJae = airings.filter((a) => a.tag === "재").length;
  const nBon = airings.filter((a) => a.tag === "본").length;
  const tagged = (nJae + nBon) / airings.length >= TAGGED_SHARE_MIN;
  const jaeMode = nJae >= nBon;
  const isRerun = (a: SlotAiring) => (a.tag ? a.tag === "재" : !jaeMode);
  const bySlot = new Map<string, SlotAiring[]>();
  for (const a of airings) {
    const k = slotKeyOf(a);
    (bySlot.get(k) ?? bySlot.set(k, []).get(k)!).push(a);
  }
  const out: SlotStats = {};
  for (const [k, xs] of bySlot) {
    const w = xs.reduce((s, a) => s + a.dur, 0);
    const byTitle = new Map<string, number>();
    for (const a of xs) byTitle.set(a.name, (byTitle.get(a.name) ?? 0) + a.dur);
    out[k] = {
      minutes: w,
      index: chanAvg > 0 ? r3(xs.reduce((s, a) => s + a.rating * a.dur, 0) / w / chanAvg) : null,
      topTitles: [...byTitle.entries()].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([n]) => n),
      rerunShare: tagged ? r3(xs.filter(isRerun).reduce((s, a) => s + a.dur, 0) / w) : null,
    };
  }
  return out;
}

export interface BenchCell {
  snap: string;
  index: number;
  topTitles: string[];
  rerunShare: number | null;
}
export interface SlotGap {
  slot: string;
  ownIndex: number;
  ownTop: string[];
  benchMedian: number;
  /** 지수 높은 순 상위 3곳 */
  benches: BenchCell[];
  /** 이 자리에서 비교한 벤치마크 채널 수와 그중 우리보다 GAP_MARGIN 이상 높은 채널 수 */
  benchN: number;
  benchHigherN: number;
}

/**
 * 격차 자리 찾기. 벤치마크가 2곳 미만이거나 자리별로 비교할 수 있는 벤치마크가 2곳 미만이면 그 자리는 내지 않는다.
 * 정렬: 우리와 벤치마크 중앙값의 차가 큰 순, 최대 MAX_GAPS개.
 */
export function computeGaps(own: SlotStats, benches: readonly { snap: string; stats: SlotStats }[]): SlotGap[] {
  if (benches.length < MIN_BENCH_CHANNELS) return [];
  const gaps: SlotGap[] = [];
  for (const [slot, o] of Object.entries(own)) {
    if (o.index === null || o.minutes < MIN_SLOT_MINUTES) continue;
    const ownIndex = o.index;
    const cells: BenchCell[] = [];
    for (const b of benches) {
      const s = b.stats[slot];
      if (s && s.index !== null && s.minutes >= MIN_SLOT_MINUTES) cells.push({ snap: b.snap, index: s.index, topTitles: s.topTitles, rerunShare: s.rerunShare });
    }
    if (cells.length < MIN_BENCH_CHANNELS) continue;
    const bm = median(cells.map((c) => c.index));
    if (bm === null || ownIndex >= bm - GAP_MARGIN) continue;
    cells.sort((p, q) => q.index - p.index);
    gaps.push({ slot, ownIndex, ownTop: o.topTitles, benchMedian: r3(bm), benches: cells.slice(0, 3), benchN: cells.length, benchHigherN: cells.filter((c) => c.index >= ownIndex + GAP_MARGIN).length });
  }
  gaps.sort((p, q) => q.benchMedian - q.ownIndex - (p.benchMedian - p.ownIndex));
  return gaps.slice(0, MAX_GAPS);
}

/** 보고서·저장용 요약(스냅샷 extras에 그대로 들어간다) */
export interface BenchmarkGapsSummary {
  /** 계산 기준일(분석 종료일이 아니라 적재 기준일) */
  asOf: string;
  /** 비교한 벤치마크 채널 이름(선정 순) */
  benchmarks: string[];
  /** 방영 분석 기간(일) */
  windowDays: number;
  gaps: SlotGap[];
}
