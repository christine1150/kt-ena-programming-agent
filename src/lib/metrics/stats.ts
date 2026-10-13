// 보조 통계 — 건별 값(일별·회차별 등)이 있을 때 n·평균·중앙값·최대 제외 평균·최대·최소를 항상 함께 낸다.
// 배경(B 에이전트 비교 결정 2026-10-13): 한두 번의 높은 값이 평균을 끌어올려도 결론이 흔들리지 않게 하고, 표본이 적으면 "참고용"이라고 밝힌다.
// 공식 KPI(시청률·점유율·Reach 등)는 DB·metrics 규칙이 정한다. 여기 값은 "표시된 건별 값만으로 낸 보조 통계"이며, 공급자 기간 값(공식)과 다를 수 있다
// (metrics/aggregate.ts: 일간 단순 평균은 잠정값). 그래서 화면에는 항상 그 점을 함께 적는다.
// 기존 파일마다 따로 있는 중앙값 함수는 건드리지 않는다 — 짝수 개일 때 윗값을 쓰는 곳(ChannelDeepDive)과 두 값의 평균을 쓰는 곳이 섞여 있어 합치면 화면 숫자가 달라질 수 있다.
// 이 모듈의 중앙값은 짝수 개일 때 가운데 두 값의 평균이다. 새로 만드는 곳만 이 모듈을 쓴다.

/** 소표본 기준 — PRD "INSUFFICIENT SAMPLE"(방영 3회 미만)과 같은 값 */
export const SMALL_SAMPLE_N = 3;

export interface DescStats {
  /** 결측(null/NaN)을 뺀 관측 수. 0 은 관측값이다. */
  n: number;
  mean: number | null;
  /** 짝수 개면 가운데 두 값의 평균 */
  median: number | null;
  /** 가장 큰 값 한 개를 뺀 평균(관측이 2개 미만이면 null) */
  meanExMax: number | null;
  max: number | null;
  min: number | null;
  /** n < SMALL_SAMPLE_N */
  small: boolean;
}

export function describeValues(values: readonly (number | null | undefined)[]): DescStats {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return { n: 0, mean: null, median: null, meanExMax: null, max: null, min: null, small: true };
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = n >> 1;
  const max = sorted[n - 1];
  return {
    n,
    mean: sum / n,
    median: n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    meanExMax: n >= 2 ? (sum - max) / (n - 1) : null,
    max,
    min: sorted[0],
    small: n < SMALL_SAMPLE_N,
  };
}

/** 가중 평균(예: 방송 길이 가중). 결측 값과 0 이하 가중치는 뺀다. 남은 가중치 합이 0 이면 null. */
export function weightedMean(pairs: readonly { value: number | null | undefined; weight: number }[]): number | null {
  let num = 0;
  let den = 0;
  for (const p of pairs) {
    if (typeof p.value !== "number" || !Number.isFinite(p.value) || !(p.weight > 0)) continue;
    num += p.value * p.weight;
    den += p.weight;
  }
  return den > 0 ? num / den : null;
}

const fmt = (v: number | null, digits: number) => (v === null ? "-" : v.toFixed(digits));

/** 화면용 한 줄. unit 은 "일", "회" 같은 관측 단위. */
export function describeLine(s: DescStats, unit: string, digits = 3): string {
  if (s.n === 0) return `${unit} 값 없음`;
  const parts = [`${s.n}${unit}`, `평균 ${fmt(s.mean, digits)}`, `중앙값 ${fmt(s.median, digits)}`];
  if (s.meanExMax !== null) parts.push(`최대 제외 평균 ${fmt(s.meanExMax, digits)}`);
  const line = parts.join(" · ");
  return s.small ? `${line} (표본 ${SMALL_SAMPLE_N}${unit} 미만 — 참고용)` : line;
}
