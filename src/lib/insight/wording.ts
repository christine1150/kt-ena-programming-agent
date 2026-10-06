// 지수·강약 표현(단계 04) — '153.8 지수'는 기준 대비 53.8% 높은 수준이지 시청률 153.8%도, 153.8% 상승도 아니다.
// '강세/중립/약세'(판정선 120·80)와 '평균 미만'(100 미만)은 서로 다른 정의라 따로 관리하고, 여러 집단이 100 미만인데
// "한 집단만"이라고 쓰지 않는다. 구성비 자료가 없으면 시청률 지수만으로 핵심 시청자 구성을 말하지 않는다.
import { TARGET_INDEX_STRONG, TARGET_INDEX_WEAK } from "@/lib/audienceReport/deepDiveAnalyzer";

export const INDEX_BASE = 100;

/** 판정 정의 — 서로 겹치지 않게 한곳에 둔다. 강세/약세는 판정선, 평균 미만은 기준선(100)이다. */
export const INDEX_DEFINITIONS = {
  strong: `지수 ${TARGET_INDEX_STRONG} 이상`,
  weak: `지수 ${TARGET_INDEX_WEAK} 이하`,
  belowAverage: `지수 ${INDEX_BASE} 미만(채널 평균보다 낮음)`,
} as const;

export const INDEX_NOT_COMPOSITION_NOTE = "지수는 연령대별 시청률이 채널 평균 대비 어느 수준인지를 보여 줄 뿐, 시청자 구성비가 아님";

export type IndexClass = "strong" | "neutral" | "weak";

export function classifyIndex(index: number): IndexClass {
  if (index >= TARGET_INDEX_STRONG) return "strong";
  if (index <= TARGET_INDEX_WEAK) return "weak";
  return "neutral";
}

/** 100 미만인지(강약 판정과 무관한 '평균 미만'). 100 정확히는 평균과 같다. */
export function isBelowAverage(index: number): boolean {
  return index < INDEX_BASE;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 지수를 기준 대비 %로 읽은 값(양수=높음). 153.8 → +53.8, 68 → −32. */
export function indexGapPct(index: number): number {
  return round1(index - INDEX_BASE);
}

/** "153.8 지수(기준 대비 53.8% 높은 수준)". 시청률이나 상승률처럼 읽히는 표기를 만들지 않는다. */
export function describeIndex(index: number): string {
  const gap = indexGapPct(index);
  const shown = Number.isInteger(index) ? String(index) : String(round1(index));
  if (gap === 0) return `${shown} 지수(기준과 같은 수준)`;
  return `${shown} 지수(기준 대비 ${Math.abs(gap)}% ${gap > 0 ? "높은" : "낮은"} 수준)`;
}

export interface TargetPoint {
  label: string;
  /** 채널 동일 연령대 평균 = 100 기준 지수. 산출 불가면 null */
  index: number | null;
}

const fmt = (t: TargetPoint) => `${t.label}(${t.index})`;

/**
 * 프로그램 프로필 한 줄(deepDive 화면 하단).
 * - 강세: 120 이상 상위 2개까지.
 * - 약세: 80 이하를 모두 센다(1개만 골라 "만"이라고 쓰지 않는다).
 * - 평균 미만: 100 미만 집단 수를 따로 말한다. 100 미만이 둘 이상이면 "~만 평균 이하"를 쓰지 않는다.
 */
export function buildTargetSentence(points: TargetPoint[]): string {
  const known = points.filter((p): p is TargetPoint & { index: number } => p.index !== null);
  const unknownCount = points.length - known.length;
  const strong = known.filter((p) => classifyIndex(p.index) === "strong").sort((a, b) => b.index - a.index);
  const weak = known.filter((p) => classifyIndex(p.index) === "weak").sort((a, b) => a.index - b.index);
  const below = known.filter((p) => isBelowAverage(p.index));
  const tail = unknownCount > 0 ? ` 지수를 산출하지 못한 집단 ${unknownCount}개는 제외함.` : "";

  if (known.length === 0) return `연령대별 지수를 산출할 자료가 없음.${tail}`;

  const strongText = strong.length > 0 ? `${strong.slice(0, 2).map(fmt).join("·")}에서 강세(${INDEX_DEFINITIONS.strong})` : null;

  let lowText: string | null = null;
  if (weak.length === 1 && below.length === 1) {
    // 100 미만이 정말 이 집단 하나뿐일 때만 단독으로 말한다.
    lowText = `${fmt(weak[0])}만 채널 평균 미만이며 약세(${INDEX_DEFINITIONS.weak})`;
  } else if (weak.length >= 1) {
    const extra = below.length - weak.length;
    lowText = `${weak.slice(0, 3).map(fmt).join("·")}${weak.length > 3 ? ` 외 ${weak.length - 3}개` : ""} 등 ${weak.length}개 집단이 약세(${INDEX_DEFINITIONS.weak})${
      extra > 0 ? `, 약세 기준에는 못 미치지만 채널 평균(100) 미만인 집단이 ${extra}개 더 있음` : ""
    }`;
  } else if (below.length >= 1) {
    lowText =
      below.length === 1
        ? `${fmt(below[0])}이(가) 채널 평균(100) 미만이나 약세 기준(${TARGET_INDEX_WEAK} 이하)에는 해당하지 않음`
        : `${below.length}개 집단이 채널 평균(100) 미만이나 약세 기준(${TARGET_INDEX_WEAK} 이하)에는 해당하지 않음`;
  }

  if (!strongText && !lowText) return `채널 평균에서 크게 벗어난 타깃이 없어 전 연령대가 고르게 나온 편임.${tail}`;
  if (!strongText) {
    const allBelow = below.length === known.length && known.length >= 2;
    return `채널 평균을 뚜렷하게 상회한 타깃은 없고, ${allBelow ? `전체 ${known.length}개 집단이 평균(100) 미만. ` : ""}${lowText}임.${tail}`;
  }
  if (!lowText) return `${strongText}이며, 채널 평균(100) 미만인 타깃은 없음.${tail}`;
  return `${strongText}, ${lowText}임.${tail}`;
}
