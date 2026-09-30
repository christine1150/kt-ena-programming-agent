// "기존 틀 유지"(KEEP_CURRENT) 모드의 편성 골격 — 최근 N주(공휴일 제외) 요일별 실제 방영 시작 시각을
// 모아 절반 이상 주에서 반복된 시작 시각만 슬롯 경계로 삼는다. 순수 함수.
import { unitKeyOf } from "./features";
import { addDays } from "./time";
import type { OwnAiring } from "./types";

export interface SkeletonSlot {
  weekday: number;
  startMin: number;
  endMin: number;
  weeksSeen: number; // 이 시작 시각이 나온 날짜 수
  weeksTotal: number; // 골격 계산에 쓴 그 요일 날짜 수
  occupants: { key: string; programName: string; n: number }[]; // 이 슬롯에 실제 편성됐던 프로그램(빈도순)
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function buildSkeleton(
  airings: OwnAiring[],
  opts: { asOfDate: string; weeks: number; gridMinutes: number; excludeHolidays: boolean }
): { slots: SkeletonSlot[]; datesUsed: Record<number, string[]> } {
  const from = addDays(opts.asOfDate, -(opts.weeks * 7 * 2 - 1)); // 공휴일로 빠지는 주를 채우려고 2배 창에서 최근 N개
  const usable = airings.filter((a) => a.date >= from && a.date <= opts.asOfDate && !(opts.excludeHolidays && a.isHoliday));
  const slots: SkeletonSlot[] = [];
  const datesUsed: Record<number, string[]> = {};

  for (let dow = 1; dow <= 7; dow++) {
    const dates = [...new Set(usable.filter((a) => a.dow === dow).map((a) => a.date))].sort().reverse().slice(0, opts.weeks);
    datesUsed[dow] = [...dates].sort();
    if (dates.length === 0) continue;
    const dateSet = new Set(dates);
    const day = usable.filter((a) => dateSet.has(a.date)).sort((a, b) => a.startMin - b.startMin || (a.date < b.date ? -1 : 1));

    // 시작 시각 군집: 군집 첫 값과 grid 이내면 같은 군집
    const clusters: OwnAiring[][] = [];
    for (const a of day) {
      const last = clusters[clusters.length - 1];
      if (last && a.startMin - last[0].startMin <= opts.gridMinutes) last.push(a);
      else clusters.push([a]);
    }
    const need = Math.ceil(dates.length / 2);
    const kept = clusters.filter((c) => new Set(c.map((a) => a.date)).size >= need);
    if (kept.length === 0) continue;

    const lastEnds = dates
      .map((d) => Math.max(...day.filter((a) => a.date === d && a.endMin !== null).map((a) => a.endMin as number)))
      .filter((v) => Number.isFinite(v));
    const dayEnd = lastEnds.length ? median(lastEnds) : null;

    const starts = kept.map((c) => median(c.map((a) => a.startMin)));
    for (let i = 0; i < kept.length; i++) {
      const startMin = starts[i];
      const endMin = i + 1 < kept.length ? starts[i + 1] : dayEnd ?? startMin;
      if (endMin <= startMin) continue;
      // 이 슬롯 구간에 시작한 방영(군집 사이에 끼인 소규모 방영 포함)의 프로그램 빈도
      const inside = day.filter((a) => a.startMin >= startMin - opts.gridMinutes && a.startMin < endMin - opts.gridMinutes / 2);
      const freq = new Map<string, { programName: string; n: number }>();
      for (const a of inside) {
        const key = unitKeyOf(a.programId, a.airingType);
        const f = freq.get(key) ?? { programName: a.programName, n: 0 };
        f.n += 1;
        freq.set(key, f);
      }
      slots.push({
        weekday: dow,
        startMin,
        endMin,
        weeksSeen: new Set(kept[i].map((a) => a.date)).size,
        weeksTotal: dates.length,
        occupants: [...freq]
          .map(([key, f]) => ({ key, programName: f.programName, n: f.n }))
          .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1)),
      });
    }
  }
  return { slots, datesUsed };
}

/** 고정 블록과 겹치는 골격 슬롯을 잘라 남은 부분만 슬롯으로 둔다(minLen 미만 조각은 버림). */
export function cutSkeletonByFixed(
  slots: SkeletonSlot[],
  occupied: { weekday: number; startMin: number; endMin: number }[],
  minLen: number
): SkeletonSlot[] {
  const out: SkeletonSlot[] = [];
  for (const s of slots) {
    let pieces = [{ startMin: s.startMin, endMin: s.endMin }];
    for (const o of occupied.filter((x) => x.weekday === s.weekday)) {
      pieces = pieces.flatMap((p) => {
        if (o.endMin <= p.startMin || o.startMin >= p.endMin) return [p];
        const res = [];
        if (o.startMin > p.startMin) res.push({ startMin: p.startMin, endMin: o.startMin });
        if (o.endMin < p.endMin) res.push({ startMin: o.endMin, endMin: p.endMin });
        return res;
      });
    }
    for (const p of pieces) if (p.endMin - p.startMin >= minLen) out.push({ ...s, startMin: p.startMin, endMin: p.endMin });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
}
