// 프로그램 기여 분해(단계 04) — 같은 분모(관측된 방송시간 합)의 시간가중 모델로 채널 평균을 프로그램별로 나누고,
// 두 기간의 변화를 편성량 효과 / 동일 슬롯 내 성과 변화 / 신규·종영 효과로 쪼갠다. 분해는 항등식이라 프로그램 합계에는 잔차가 없고,
// 잔차는 "채널 전체 원본(공식 기간 평균)"과 "상세 방송 구간으로 재구성한 값"의 차이로만 나타난다 — 이 차이를 숨기지 않는다.
// 이 값은 인과가 아니라 산술 분해다. 교란요인(프라임 구성 변화·공휴일·재방 비중·타깃 변경 등)이 있으면 라벨을 "관측"으로 낮춘다.

export interface UnitAiring {
  /** 분해 단위 키. 같은 슬롯 안의 성과 변화를 보려면 "요일|시|프로그램"처럼 슬롯을 포함시킨다 */
  unit: string;
  /** 방송 길이(초) */
  seconds: number;
  /** 그 방송의 평균 시청률. 결측이면 null(관측 분모에서 제외, 0으로 채우지 않음) */
  rating: number | null;
}

export interface PeriodModel {
  /** 관측된 방송 초 합(= 분모) */
  observedSeconds: number;
  /** 시청률 결측이라 분모에서 뺀 초 */
  missingRatingSeconds: number;
  /** 시간가중 모델 평균 시청률 = Σ(초×시청률) ÷ 관측 초 */
  modelAvg: number | null;
  units: Map<string, { seconds: number; avgRating: number; share: number; contribution: number }>;
}

export function buildPeriodModel(airings: UnitAiring[]): PeriodModel {
  const acc = new Map<string, { seconds: number; weighted: number }>();
  let observed = 0;
  let missing = 0;
  let weightedSum = 0;
  for (const a of airings) {
    if (!(a.seconds > 0)) continue;
    if (a.rating === null || !Number.isFinite(a.rating)) {
      missing += a.seconds;
      continue;
    }
    observed += a.seconds;
    weightedSum += a.seconds * a.rating;
    const u = acc.get(a.unit) ?? { seconds: 0, weighted: 0 };
    u.seconds += a.seconds;
    u.weighted += a.seconds * a.rating;
    acc.set(a.unit, u);
  }
  const units: PeriodModel["units"] = new Map();
  for (const [k, u] of acc) {
    units.set(k, { seconds: u.seconds, avgRating: u.weighted / u.seconds, share: observed > 0 ? u.seconds / observed : 0, contribution: observed > 0 ? u.weighted / observed : 0 });
  }
  return { observedSeconds: observed, missingRatingSeconds: missing, modelAvg: observed > 0 ? weightedSum / observed : null, units };
}

export type EffectKind = "volume_and_performance" | "new" | "ended";

export interface UnitDelta {
  unit: string;
  kind: EffectKind;
  /** 기여 변화 = 이후 기여 − 이전 기여 (시청률 %p) */
  delta: number;
  /** 편성량(점유 비중) 변화로 생긴 몫 — 신규·종영은 0으로 두고 전체를 신규/종영 효과에 둔다 */
  volumeEffect: number;
  /** 같은 단위의 회당 성과(시청률) 변화로 생긴 몫 */
  performanceEffect: number;
  /** 신규 편성(이전 0 → 이후 >0)의 기여 */
  newEffect: number;
  /** 종영·미편성(이전 >0 → 이후 0)의 기여(음수) */
  endedEffect: number;
  before: { share: number; avgRating: number } | null;
  after: { share: number; avgRating: number } | null;
}

export interface ContributionDecomposition {
  before: PeriodModel;
  after: PeriodModel;
  units: UnitDelta[];
  /** Σ 단위 기여 변화 = 모델 평균의 변화 */
  modelDelta: number | null;
  /** 공식 채널 평균(있을 때)과의 비교 — 재구성값 차이 */
  reconciliation: {
    officialBefore: number | null;
    officialAfter: number | null;
    residualBefore: number | null;
    residualAfter: number | null;
    /** 공식 평균의 변화 − 모델 평균의 변화 */
    residualDelta: number | null;
    /** 관측 방송시간 ÷ 기간 전체 시간(커버리지) — 공백·시청률 결측이 얼마나 빠졌는지 */
    coverageBefore: number | null;
    coverageAfter: number | null;
  };
  confounders: string[];
  /** 항상 false — 이 분해는 인과가 아니다 */
  causalClaimAllowed: false;
  labelKo: string;
}

/** 기여 변화를 항등식으로 분해한다: s_B·r_B − s_A·r_A = (s_B−s_A)·r̄ + (r_B−r_A)·s̄ (r̄, s̄는 두 기간 평균). */
export function decomposeContribution(
  beforeAirings: UnitAiring[],
  afterAirings: UnitAiring[],
  opts: {
    officialBefore?: number | null;
    officialAfter?: number | null;
    /** 기간 전체 초(커버리지 분모). 알면 넘긴다 */
    periodSecondsBefore?: number | null;
    periodSecondsAfter?: number | null;
    confounders?: string[];
  } = {}
): ContributionDecomposition {
  const before = buildPeriodModel(beforeAirings);
  const after = buildPeriodModel(afterAirings);
  const keys = new Set([...before.units.keys(), ...after.units.keys()]);
  const units: UnitDelta[] = [];
  for (const unit of keys) {
    const b = before.units.get(unit) ?? null;
    const a = after.units.get(unit) ?? null;
    if (b && a) {
      const volumeEffect = (a.share - b.share) * ((b.avgRating + a.avgRating) / 2);
      const performanceEffect = (a.avgRating - b.avgRating) * ((b.share + a.share) / 2);
      units.push({ unit, kind: "volume_and_performance", delta: a.contribution - b.contribution, volumeEffect, performanceEffect, newEffect: 0, endedEffect: 0, before: { share: b.share, avgRating: b.avgRating }, after: { share: a.share, avgRating: a.avgRating } });
    } else if (a) {
      units.push({ unit, kind: "new", delta: a.contribution, volumeEffect: 0, performanceEffect: 0, newEffect: a.contribution, endedEffect: 0, before: null, after: { share: a.share, avgRating: a.avgRating } });
    } else if (b) {
      units.push({ unit, kind: "ended", delta: -b.contribution, volumeEffect: 0, performanceEffect: 0, newEffect: 0, endedEffect: -b.contribution, before: { share: b.share, avgRating: b.avgRating }, after: null });
    }
  }
  units.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const modelDelta = before.modelAvg !== null && after.modelAvg !== null ? after.modelAvg - before.modelAvg : null;
  const ob = opts.officialBefore ?? null;
  const oa = opts.officialAfter ?? null;
  const rb = ob !== null && before.modelAvg !== null ? ob - before.modelAvg : null;
  const ra = oa !== null && after.modelAvg !== null ? oa - after.modelAvg : null;
  const cov = (m: PeriodModel, total: number | null | undefined) => (total && total > 0 ? m.observedSeconds / total : null);
  const confounders = [...(opts.confounders ?? [])];
  return {
    before,
    after,
    units,
    modelDelta,
    reconciliation: {
      officialBefore: ob,
      officialAfter: oa,
      residualBefore: rb,
      residualAfter: ra,
      residualDelta: ob !== null && oa !== null && modelDelta !== null ? oa - ob - modelDelta : null,
      coverageBefore: cov(before, opts.periodSecondsBefore),
      coverageAfter: cov(after, opts.periodSecondsAfter),
    },
    confounders,
    causalClaimAllowed: false,
    labelKo: confounders.length > 0 ? `산술 분해(관측) — 교란요인 있음: ${confounders.join(", ")}` : "산술 분해(관측) — 원인을 단정하지 않음",
  };
}
