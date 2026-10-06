// 편성안 vs 기준 주(CURRENT) 개선율의 "같은 시간 기준" 계산(OPT01) — 순수 함수, 클라이언트·서버 공용.
//
// 문제(OPT01 합성 실험으로 확인): 기존 개선율 = (이번 안 주간 기대 평균) ÷ (기준 주 주간 기대 평균) − 1 은 두 평균이 "서로 다른 시간"의 평균일 수 있다.
//  · 이번 안은 일주일 전체(예: 10080분)가 평가값을 갖는데, 기준 주는 방영 기록이 비었거나 시청률이 없는 방영(기대값 없음)이 빠져 더 적은 분만 평균에 들어간다.
//  · 기준 주에서 프라임 방영 기록이 일부 비어 있으면 기준 평균이 낮아져 개선율이 크게 부풀려진다(실험: 같은 시간 기준 1.7% → 보고 13.5%).
// 이 함수는 두 편성 모두 평가값이 있는 "같은 요일·같은 분"만으로 평균을 다시 내 개선율을 계산하고, 두 편성이 평가한 시간 범위의 차이를 함께 돌려준다.
// 새 모델이 아니라 같은 기대값을 같은 분에서 비교하는 집계 보정이다.

export interface ComparableBlock {
  weekday: number; // 1=월 … 7=일
  startMin: number; // 방송일 기준 분(02:00 = 120)
  endMin: number;
  expected: number | null;
  /** 경쟁사 가상 편성은 주간 합계에서 빼는 기존 규칙과 같게 false로 보낸다 */
  countable?: boolean;
}

export interface SupportComparison {
  /** 같은 분에서 이번 안의 기대 평균 */
  idealAvg: number | null;
  /** 같은 분에서 기준 주의 기대 평균 */
  currentAvg: number | null;
  /** 같은 시간 기준 개선율(= idealAvg / currentAvg − 1). 계산할 수 없으면 null */
  ratio: number | null;
  /** 두 편성 모두 평가값이 있는 분 */
  commonMinutes: number;
  /** 이번 안·기준 주가 각각 평가값을 가진 분 */
  idealMinutes: number;
  currentMinutes: number;
  /** 전체 평균끼리 비교한 기존 개선율(비교 시간이 다를 수 있음) */
  wholeRatio: number | null;
  /** 두 편성의 평가 시간 범위가 눈에 띄게 다른가(공통 분이 둘 중 작은 쪽의 98% 미만) */
  supportDiffers: boolean;
  /** 기존 전체 평균 비교와 같은 시간 비교의 차이(%p, 비율 단위) — 클수록 기존 값이 시간 범위 차이의 영향을 받았다 */
  distortion: number | null;
}

/** 이 값 미만이면 두 편성의 시간 범위가 같다고 본다(공통 분 ÷ 더 작은 쪽 분). 임시 기준 — 정책 수치는 아니고 표시 경고용. */
export const SUPPORT_SAME_SHARE = 0.98;

function perMinute(blocks: ComparableBlock[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const b of blocks) {
    if (b.countable === false || b.expected === null || !Number.isFinite(b.expected)) continue;
    if (!(b.endMin > b.startMin)) continue;
    const base = b.weekday * 100000;
    for (let t = b.startMin; t < b.endMin; t++) m.set(base + t, b.expected); // 같은 분에 겹치면 나중 값(겹침은 엔진이 막는다)
  }
  return m;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function compareOnCommonSupport(ideal: ComparableBlock[], current: ComparableBlock[]): SupportComparison {
  const mi = perMinute(ideal);
  const mc = perMinute(current);
  const common = [...mi.keys()].filter((k) => mc.has(k));
  const idealAvg = mean(common.map((k) => mi.get(k) as number));
  const currentAvg = mean(common.map((k) => mc.get(k) as number));
  const ratio = idealAvg !== null && currentAvg !== null && currentAvg > 0 ? idealAvg / currentAvg - 1 : null;
  const wi = mean([...mi.values()]);
  const wc = mean([...mc.values()]);
  const wholeRatio = wi !== null && wc !== null && wc > 0 ? wi / wc - 1 : null;
  const smaller = Math.min(mi.size, mc.size);
  return {
    idealAvg,
    currentAvg,
    ratio,
    commonMinutes: common.length,
    idealMinutes: mi.size,
    currentMinutes: mc.size,
    wholeRatio,
    supportDiffers: smaller > 0 ? common.length / smaller < SUPPORT_SAME_SHARE || Math.abs(mi.size - mc.size) / Math.max(mi.size, mc.size) > 1 - SUPPORT_SAME_SHARE : false,
    distortion: ratio !== null && wholeRatio !== null ? wholeRatio - ratio : null,
  };
}

/** 두 편성의 평가 시간 범위 차이 안내 문구(차이가 없으면 null). */
export function supportNote(c: SupportComparison): string | null {
  if (!c.supportDiffers) return null;
  const gap = Math.abs(c.idealMinutes - c.currentMinutes);
  const less = c.currentMinutes < c.idealMinutes ? "기준 주" : "이번 안";
  const d = c.distortion !== null && Math.abs(c.distortion) >= 0.005 ? ` 전체 평균끼리 비교하면 ${c.distortion > 0 ? "+" : "−"}${Math.abs(c.distortion * 100).toFixed(1)}%p 달라집니다.` : "";
  return `${less}의 평가 시간이 ${gap.toLocaleString("ko-KR")}분 적어(이번 안 ${c.idealMinutes.toLocaleString("ko-KR")}분 · 기준 주 ${c.currentMinutes.toLocaleString("ko-KR")}분) 같은 시간(${c.commonMinutes.toLocaleString("ko-KR")}분)만으로 비교했습니다.${d}`;
}
