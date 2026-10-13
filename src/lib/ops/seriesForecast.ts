// 시리즈 기준 예측(신규 시즌 단순 추정) — 순수 계산. 같은 시리즈의 지난 시즌 본방 회차별 시청률과 채널 수준 보정 비율로
// 새 시즌의 기대 시청률을 낸다. 이것은 "한 개의 지난 시즌"을 근거로 한 거친 추정이며 예측 모델(OPT02)이 아니다.
// 시즌 사이의 변화(출연·여행지·경쟁·계절)는 담지 못하므로 범위를 함께 낸다. 방송하지 않은 값은 검증 성과로 쓰지 않는다.
export interface SeriesForecastInput {
  /** 지난 시즌 본방 회차별 시청률(방송 순서대로, % 단위). 값이 없는 회차는 null */
  episodes: (number | null)[];
  /** 채널 수준 보정 비율 = (새 시즌 방영 직전 채널 평균) ÷ (지난 시즌 방영 기간 채널 평균), 같은 타깃 */
  levelRatio: number;
}

export interface SeriesForecast {
  /** 값이 있는 회차 수 */
  n: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  /** 첫 1~3회 평균(시즌 초반 램프업) */
  firstThreeMean: number;
  /** 4회 이후 평균 */
  laterMean: number;
  /** 마지막 6회 평균(시즌 종반 수준) */
  lastSixMean: number;
  /** 보정 비율을 곱한 예상값 */
  scaled: { premiere: number; firstThree: number; seasonMean: number; median: number; low: number; high: number; lateLevel: number };
}

const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** 선형 보간 분위수(0~1) */
export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

export function seriesForecast(input: SeriesForecastInput): SeriesForecast | null {
  if (!(input.levelRatio > 0) || !Number.isFinite(input.levelRatio)) throw new Error("보정 비율은 0보다 큰 값이어야 합니다.");
  const eps = input.episodes.filter((v): v is number => v !== null && Number.isFinite(v));
  if (eps.length < 3) return null; // 3회 미만으로는 시즌 수준을 말하지 않는다
  const sorted = [...eps].sort((a, b) => a - b);
  const r = input.levelRatio;
  const mean = avg(eps);
  const firstThreeMean = avg(eps.slice(0, 3));
  const lastSixMean = avg(eps.slice(-6));
  const p10 = quantile(sorted, 0.1);
  const p90 = quantile(sorted, 0.9);
  const median = quantile(sorted, 0.5);
  return {
    n: eps.length,
    mean,
    median,
    p10,
    p90,
    firstThreeMean,
    laterMean: eps.length > 3 ? avg(eps.slice(3)) : mean,
    lastSixMean,
    scaled: { premiere: eps[0] * r, firstThree: firstThreeMean * r, seasonMean: mean * r, median: median * r, low: p10 * r, high: p90 * r, lateLevel: lastSixMean * r },
  };
}
