// 기능 2 단계 D-2 — "실제 방영 시청률의 편성시간 가중 집계"가 닐슨 공식 채널 하루 시청률과 얼마나 맞는지 보는 순수 함수.
// 예측이 아니라 실적끼리의 대조다: 칸별 예측을 하루로 모을 때(편성시간 가중 예상) 공식 하루 값과 같은 정의로 볼 수 있는지 판단하는 근거.
// 보정식은 만들지 않는다(검증 전 보정 금지). 덮이지 않은 분은 0으로 채우지 않고 따로 센다.
import { airingSpan, BROADCAST_DAY_END_MIN, BROADCAST_DAY_START_MIN } from "@/lib/idealSchedule/time";

const DAY = BROADCAST_DAY_END_MIN - BROADCAST_DAY_START_MIN; // 1440

export interface DayAiring {
  startTime: string | null;
  endTime: string | null;
  rating: number | null;
}

export interface DayAlignment {
  /** 방송일(02:00~26:00) 중 시청률 값이 있는 방영으로 덮인 분 */
  coveredMinutes: number;
  /** 방영은 있지만 시청률이 NULL인 분(다른 방영으로도 덮이지 않은 것만) */
  nullRatedMinutes: number;
  /** 방영 행이 겹친 분(같은 시간에 두 행 이상) — 그 분은 겹친 값의 평균을 쓴다 */
  overlapMinutes: number;
  /** 종료 시각이 없어 구간을 만들 수 없는 방영 수 */
  noEndAirings: number;
  /** 덮인 분 기준 편성시간 가중 평균 */
  weighted: number | null;
  /** 방영별 산술평균(비교용) */
  arithmetic: number | null;
  airings: number;
  /** 시청률 값이 있는 방영으로 덮이지 않은 분을 방송 시(2~25)별로 센 것 */
  uncoveredByHour: Record<number, number>;
}

export function alignDay(airings: DayAiring[]): DayAlignment {
  const sum = new Float64Array(DAY);
  const cnt = new Uint16Array(DAY);
  const nul = new Uint8Array(DAY);
  let noEnd = 0;
  const vals: number[] = [];
  for (const a of airings) {
    if (a.rating !== null && Number.isFinite(a.rating)) vals.push(a.rating);
    if (!a.startTime) {
      noEnd++;
      continue;
    }
    const sp = airingSpan(a.startTime, a.endTime);
    if (!sp || sp.endMin === null) {
      noEnd++;
      continue;
    }
    const from = Math.max(Math.round(sp.startMin), BROADCAST_DAY_START_MIN) - BROADCAST_DAY_START_MIN;
    const to = Math.min(Math.round(sp.endMin), BROADCAST_DAY_END_MIN) - BROADCAST_DAY_START_MIN;
    for (let m = from; m < to; m++) {
      if (a.rating === null || !Number.isFinite(a.rating)) nul[m] = 1;
      else {
        sum[m] += a.rating;
        cnt[m]++;
      }
    }
  }
  let covered = 0;
  let overlap = 0;
  let nullOnly = 0;
  let acc = 0;
  const uncoveredByHour: Record<number, number> = {};
  for (let m = 0; m < DAY; m++) {
    if (cnt[m] === 0) {
      const h = Math.floor((m + BROADCAST_DAY_START_MIN) / 60);
      uncoveredByHour[h] = (uncoveredByHour[h] ?? 0) + 1;
    }
    if (cnt[m] > 0) {
      covered++;
      acc += sum[m] / cnt[m];
      if (cnt[m] > 1) overlap++;
    } else if (nul[m]) nullOnly++;
  }
  return {
    coveredMinutes: covered,
    nullRatedMinutes: nullOnly,
    overlapMinutes: overlap,
    noEndAirings: noEnd,
    weighted: covered > 0 ? acc / covered : null,
    arithmetic: vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null,
    airings: airings.length,
    uncoveredByHour,
  };
}

export interface PairStat {
  n: number;
  mae: number | null;
  bias: number | null; // 집계 − 공식
  /** 공식 ÷ 집계의 중앙값(체계적 배율 차이 확인용, 보정식 아님) */
  medianRatio: number | null;
  corr: number | null;
}

export function pairStats(pairs: { est: number; official: number }[]): PairStat {
  const n = pairs.length;
  if (n === 0) return { n: 0, mae: null, bias: null, medianRatio: null, corr: null };
  const errs = pairs.map((p) => p.est - p.official);
  const ratios = pairs.filter((p) => p.est > 0).map((p) => p.official / p.est).sort((a, b) => a - b);
  const mx = pairs.reduce((s, p) => s + p.est, 0) / n;
  const my = pairs.reduce((s, p) => s + p.official, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pairs) {
    sxy += (p.est - mx) * (p.official - my);
    sxx += (p.est - mx) ** 2;
    syy += (p.official - my) ** 2;
  }
  const mid = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2) : null;
  return {
    n,
    mae: errs.reduce((s, e) => s + Math.abs(e), 0) / n,
    bias: errs.reduce((s, e) => s + e, 0) / n,
    medianRatio: mid,
    corr: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null,
  };
}
