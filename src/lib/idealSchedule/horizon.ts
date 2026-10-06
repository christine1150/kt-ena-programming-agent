// 주간 horizon 대비 평가 범위(OPT03, 벤치마크 T01·T06) — 순수 함수.
// 주간 기대 시청률 R̂ = Σ(편성 분 × 기대 시청률) ÷ 평가된 분. 기대값이 없는 시간(예측 불가·여백·미평가)은 평균에서 조용히 빠지면 안 된다:
//  · 평가된 분이 horizon의 일부뿐이면 coverage로 드러내고, 평가되지 않은 분을 0으로 둔 하한(lowerBound)을 함께 돌려준다.
//  · "관측된 좋은 구간 30%만" 평균내서 주간 기대치를 높이는 일을 막는다 — 화면은 coverage가 낮으면 평균만 크게 보여 주지 않는다.
// 가중은 길이(분) 비례다(단순 평균 아님: 30분×0.200% + 90분×0.100% = 120분 평균 0.125%, 단순평균 0.150%는 오류 — T01).

export const WEEK_HORIZON_MIN = 7 * 24 * 60;
/** 이 비율 이상 평가되면 '전체 평가'로 본다(여백 몇 분 정도는 허용). 표시 경고용 임시 기준. */
export const FULL_COVERAGE = 0.98;

export interface HorizonBlock {
  startMin: number;
  endMin: number;
  expected: number | null;
  /** 경쟁사 가상 편성 등 주간 합계에서 빼는 블록은 false */
  countable?: boolean;
}

export interface HorizonCoverage {
  horizonMinutes: number;
  /** 기대값이 있는(평가된) 편성 분 */
  evaluatedMinutes: number;
  /** 편성되었지만 기대값이 없는 분 */
  unevaluatedMinutes: number;
  /** 평가된 분 ÷ horizon */
  coverage: number;
  /** 평가된 시간만의 분 가중 평균(기존 방식). 평가된 분이 없으면 null */
  avgOverEvaluated: number | null;
  /** 평가되지 않은 모든 시간(미편성 포함)을 0으로 둔 horizon 전체 평균 — 부분 평가가 평균을 부풀리지 않았는지 보는 하한 */
  lowerBound: number | null;
  /** 평가가 horizon 대부분을 덮는가 */
  full: boolean;
}

export function horizonExpected(blocks: HorizonBlock[], horizonMinutes = WEEK_HORIZON_MIN): HorizonCoverage {
  let sum = 0;
  let evaluated = 0;
  let unevaluated = 0;
  for (const b of blocks) {
    if (b.countable === false) continue;
    const len = Math.max(0, b.endMin - b.startMin);
    if (b.expected === null || !Number.isFinite(b.expected)) {
      unevaluated += len;
      continue;
    }
    sum += b.expected * len;
    evaluated += len;
  }
  const coverage = horizonMinutes > 0 ? Math.min(1, evaluated / horizonMinutes) : 0;
  return {
    horizonMinutes,
    evaluatedMinutes: evaluated,
    unevaluatedMinutes: unevaluated,
    coverage,
    avgOverEvaluated: evaluated > 0 ? sum / evaluated : null,
    lowerBound: horizonMinutes > 0 ? sum / horizonMinutes : null,
    full: coverage >= FULL_COVERAGE,
  };
}

/** 평가 범위 안내 문구(전체가 평가되었으면 null). */
export function coverageNote(h: HorizonCoverage | null | undefined): string | null {
  if (!h || h.full) return null;
  const pct = Math.round(h.coverage * 1000) / 10;
  const lb = h.lowerBound === null ? "" : ` 평가되지 않은 시간을 0으로 두면 주간 평균은 ${h.lowerBound.toFixed(3)}입니다.`;
  return `주 전체 ${h.horizonMinutes.toLocaleString("ko-KR")}분 중 ${h.evaluatedMinutes.toLocaleString("ko-KR")}분(${pct}%)만 기대값이 있어 그 시간의 평균입니다.${lb}`;
}
