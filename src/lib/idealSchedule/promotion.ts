// 승격(유지·교체) 판정 기준 — OPT05. 순수 함수. **합격선은 Claude가 합성 세계 기준선을 먼저 측정한 뒤 제안한 값이며 사용자 승인 전의 제안치다.**
// 실측 근거가 없는 "+20% 달성" 같은 목표를 기준으로 쓰지 않는다 — 기준은 모델 오차·구간 보정·유효해율·탐색시간·낙관 편향·적용 범위다.
// 판정은 3가지 상태로만 나온다: HOLD(보류) / LIMITED(일부 집단 적용 제한) / PASS. 합성 세계 수치만으로는 PASS가 되지 않고 UNVERIFIED_REAL_DATA(실데이터 미검증)로 멈춘다.
export interface GroupMeasure {
  name: string;
  /** 이 집단의 평가 건수 */
  n: number;
  maeModel: number;
  /** 같은 집단에서 가장 좋은 기준모델의 MAE */
  maeBaseline: number;
}

export interface PromotionMeasure {
  /** 측정이 합성 세계인가 실제 자료인가 — 합성이면 PASS를 내지 않는다 */
  source: "synthetic" | "real";
  /** 같은 최종 holdout·같은 데이터 마감에서의 MAE(%p) — 마감 목표 주 전날 / 7일 전 */
  mae: { model: number; bestBaseline: number };
  maeLead7: { model: number; bestBaseline: number } | null;
  /** 평균(예측−실측) %p */
  bias: number;
  /** 80% 구간의 이후 목표 주 적중률 */
  coverage: number | null;
  groups: GroupMeasure[];
  /** 신규 프로그램(학습 이력 없음) MAE — 전체 MAE 대비 얼마나 나쁜지(근거 부족 표시 의무 판단) */
  newProgramMae: number | null;
  /** 하드 제약을 모두 지킨 실행 비율(0~1) */
  validRate: number;
  /** 시간 마감으로 멈춘 실행 비율(0~1). 측정하지 않았으면 null */
  deadlineStopRate: number | null;
  /** 보고 개선율 − 정답(또는 사후 실적) 개선율의 평균(비율, 예: 0.06 = 6%p). 일반 세계 */
  overshoot: number | null;
  /** 진짜 차이가 없는 세계에서 후보를 20개 이상으로 늘렸을 때의 같은 값 — 근거 없는 개선율이 얼마나 생기나 */
  overshootStress: number | null;
  /** 시나리오 [p10,p90]에 실제 개선율이 든 비율(후보 20개 이하) */
  scenarioContainment: number | null;
}

export interface Thresholds {
  /** 현재 모델 유지 조건: MAE ≤ 최선 기준모델 × 이 값 */
  maeRatioMax: number;
  /** 모델 교체(도전 모델) 조건: 현재 모델 대비 MAE 상대 개선이 이 값 이상 */
  challengerMinGain: number;
  /** |bias| ≤ MAE × 이 값 */
  biasShareOfMaeMax: number;
  /** 80% 구간 적중률 허용 범위 */
  coverageRange: [number, number];
  /** 집단 보호: 평가 건수가 이 이상인 집단에서 MAE ≤ 최선 기준 × 이 값 */
  groupMinN: number;
  groupRatioMax: number;
  /** 신규 프로그램 MAE가 전체 MAE의 이 배수 이상이면 "근거 부족" 표시를 의무로 한다 */
  weakEvidenceMultiple: number;
  validRateMin: number;
  deadlineStopRateMax: number;
  /** 보고 개선율의 낙관(보고−실제) 허용 상한 — 넘으면 개선율을 범위·경고와 함께만 표시 */
  overshootMax: number;
  overshootStressMax: number;
  scenarioContainmentMin: number;
}

/** 제안 합격선(사용자 승인 대기). 근거: 합성 세계 4개 측정(OPT05_VALIDATION.md 4절) — 현재 모델이 최선 기준모델 대비 MAE 0.83배, 구간 적중 79%. */
export const PROPOSED_THRESHOLDS: Thresholds = {
  maeRatioMax: 1.0,
  challengerMinGain: 0.05,
  biasShareOfMaeMax: 0.15,
  coverageRange: [0.73, 0.87],
  groupMinN: 100,
  groupRatioMax: 1.1,
  weakEvidenceMultiple: 2.5,
  validRateMin: 1.0,
  deadlineStopRateMax: 0.05,
  overshootMax: 0.1,
  overshootStressMax: 0.1,
  scenarioContainmentMin: 0.7,
};

export type CriterionStatus = "PASS" | "FAIL" | "NOT_MEASURED";
export interface Criterion {
  id: string;
  area: "A 예측" | "B 탐색";
  label: string;
  /** 필수(실패하면 보류) vs 표시 의무(실패하면 화면 표시·경고로 완화) */
  kind: "REQUIRED" | "DISCLOSURE";
  value: string;
  threshold: string;
  status: CriterionStatus;
  note: string;
}

export type Verdict = "HOLD" | "LIMITED" | "UNVERIFIED_REAL_DATA" | "PASS";

export interface PromotionResult {
  verdict: Verdict;
  criteria: Criterion[];
  /** 적용 범위를 제한해야 하는 집단(모델이 기준모델보다 뚜렷이 나쁜 집단) */
  limitedGroups: string[];
  /** 실패한 표시 의무 — 화면이 반드시 알려야 하는 것 */
  disclosures: string[];
}

const f = (v: number, d = 3) => v.toFixed(d);
const p = (v: number) => `${(v * 100).toFixed(1)}%`;

export function evaluatePromotion(m: PromotionMeasure, t: Thresholds = PROPOSED_THRESHOLDS): PromotionResult {
  const c: Criterion[] = [];
  const add = (x: Omit<Criterion, "status"> & { ok: boolean | null }) => c.push({ ...x, status: x.ok === null ? "NOT_MEASURED" : x.ok ? "PASS" : "FAIL" });

  const ratio = m.mae.bestBaseline > 0 ? m.mae.model / m.mae.bestBaseline : Infinity;
  add({ id: "A1", area: "A 예측", kind: "REQUIRED", label: "현재 모델이 최선 기준모델보다 낫다(마감 목표 주 전날)", value: `MAE ${f(m.mae.model)} / 기준 ${f(m.mae.bestBaseline)} = ${f(ratio, 2)}배`, threshold: `≤ ${t.maeRatioMax}배`, ok: ratio <= t.maeRatioMax, note: "같은 holdout·같은 마감·같은 지표." });
  if (m.maeLead7) {
    const r7 = m.maeLead7.model / m.maeLead7.bestBaseline;
    add({ id: "A1b", area: "A 예측", kind: "REQUIRED", label: "데이터 마감이 7일 앞당겨져도 기준모델보다 낫다", value: `${f(r7, 2)}배`, threshold: `≤ ${t.maeRatioMax}배`, ok: r7 <= t.maeRatioMax, note: "실제 편성 작업은 보통 1~2주 전에 하므로 마감 간격을 함께 본다." });
  } else add({ id: "A1b", area: "A 예측", kind: "REQUIRED", label: "데이터 마감 7일 전 성능", value: "—", threshold: `≤ ${t.maeRatioMax}배`, ok: null, note: "측정하지 않음" });
  const biasShare = m.mae.model > 0 ? Math.abs(m.bias) / m.mae.model : 0;
  add({ id: "A2", area: "A 예측", kind: "REQUIRED", label: "평균 오차 방향(bias)이 오차 크기에 비해 작다", value: `|bias| ${f(Math.abs(m.bias))} = MAE의 ${p(biasShare)}`, threshold: `≤ MAE의 ${p(t.biasShareOfMaeMax)}`, ok: biasShare <= t.biasShareOfMaeMax, note: "한쪽으로 쏠린 예측(체계적 과대·과소)은 편성 선택을 왜곡한다." });
  add({
    id: "A3",
    area: "A 예측",
    kind: "REQUIRED",
    label: "80% 예측구간이 이후 목표 주에서 약 80% 적중한다",
    value: m.coverage === null ? "—" : p(m.coverage),
    threshold: `${p(t.coverageRange[0])} ~ ${p(t.coverageRange[1])}`,
    ok: m.coverage === null ? null : m.coverage >= t.coverageRange[0] && m.coverage <= t.coverageRange[1],
    note: "과거 오차의 실증 범위이며 미래 적중 보장이 아니다.",
  });
  const limited = m.groups.filter((g) => g.n >= t.groupMinN && g.maeBaseline > 0 && g.maeModel / g.maeBaseline > t.groupRatioMax).map((g) => g.name);
  add({ id: "A4", area: "A 예측", kind: "REQUIRED", label: `평가 ${t.groupMinN}건 이상 집단에서 기준모델보다 뚜렷이 나쁘지 않다`, value: limited.length ? `나쁜 집단: ${limited.join(", ")}` : `${m.groups.filter((g) => g.n >= t.groupMinN).length}개 집단 모두 통과`, threshold: `집단 MAE ≤ 기준 × ${t.groupRatioMax}`, ok: limited.length === 0, note: "실패하면 전체 보류가 아니라 그 집단만 적용을 제한한다(LIMITED)." });
  const weak = m.newProgramMae !== null && m.mae.model > 0 ? m.newProgramMae / m.mae.model : null;
  add({
    id: "A5",
    area: "A 예측",
    kind: "DISCLOSURE",
    label: "신규·소표본 프로그램은 근거 부족으로 표시한다",
    value: weak === null ? "—" : `신규 MAE가 전체의 ${f(weak, 1)}배`,
    threshold: `${t.weakEvidenceMultiple}배 이상이면 표시 의무`,
    ok: weak === null ? null : weak < t.weakEvidenceMultiple, // 통과 = 표시 의무가 없을 만큼 좋음, 실패 = 표시 의무 발생
    note: "실패(=배수가 큼)는 모델이 틀렸다는 뜻이 아니라 화면이 '근거 부족' 표시와 넓은 범위를 반드시 보여야 한다는 뜻이다.",
  });
  add({ id: "B1", area: "B 탐색", kind: "REQUIRED", label: "생성한 편성안은 모두 하드 제약을 지킨다", value: p(m.validRate), threshold: `≥ ${p(t.validRateMin)}`, ok: m.validRate >= t.validRateMin, note: "점수가 높아도 위반이 있으면 거부." });
  add({ id: "B2", area: "B 탐색", kind: "REQUIRED", label: "시간 마감으로 멈춘 실행이 드물다", value: m.deadlineStopRate === null ? "—" : p(m.deadlineStopRate), threshold: `≤ ${p(t.deadlineStopRateMax)}`, ok: m.deadlineStopRate === null ? null : m.deadlineStopRate <= t.deadlineStopRateMax, note: "마감으로 멈춰도 유효한 최선안은 나오지만, 잦으면 실데이터 크기에 맞춰 탐색을 손봐야 한다." });
  add({ id: "B3", area: "B 탐색", kind: "DISCLOSURE", label: "보고 개선율이 실제보다 과하지 않다(일반 세계)", value: m.overshoot === null ? "—" : `${(m.overshoot * 100).toFixed(1)}%p`, threshold: `≤ ${(t.overshootMax * 100).toFixed(0)}%p`, ok: m.overshoot === null ? null : m.overshoot <= t.overshootMax, note: "실패하면 개선율을 단일 숫자로 보여 주지 말고 범위·경고와 함께만 표시한다." });
  add({ id: "B3b", area: "B 탐색", kind: "DISCLOSURE", label: "진짜 차이가 없을 때 후보를 늘려도 근거 없는 개선율이 크지 않다", value: m.overshootStress === null ? "—" : `${(m.overshootStress * 100).toFixed(1)}%p`, threshold: `≤ ${(t.overshootStressMax * 100).toFixed(0)}%p`, ok: m.overshootStress === null ? null : m.overshootStress <= t.overshootStressMax, note: "후보(프로그램) 20~40개에서 정답 개선율 0인 합성 세계의 보고 개선율." });
  add({ id: "B4", area: "B 탐색", kind: "DISCLOSURE", label: "검증 오차 시나리오 구간이 실제 개선율을 충분히 포함한다", value: m.scenarioContainment === null ? "—" : p(m.scenarioContainment), threshold: `≥ ${p(t.scenarioContainmentMin)}`, ok: m.scenarioContainment === null ? null : m.scenarioContainment >= t.scenarioContainmentMin, note: "실패하면 시나리오 구간을 '실제 범위'가 아니라 '선택 편향 미반영 범위'로 표기한다." });

  const requiredFail = c.some((x) => x.kind === "REQUIRED" && x.status === "FAIL" && x.id !== "A4");
  const disclosures = c.filter((x) => x.kind === "DISCLOSURE" && x.status === "FAIL").map((x) => `${x.id} ${x.label}`);
  let verdict: Verdict;
  if (requiredFail) verdict = "HOLD";
  else if (limited.length > 0) verdict = "LIMITED";
  else if (m.source === "synthetic" || c.some((x) => x.kind === "REQUIRED" && x.status === "NOT_MEASURED")) verdict = "UNVERIFIED_REAL_DATA";
  else verdict = "PASS";
  return { verdict, criteria: c, limitedGroups: limited, disclosures };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  HOLD: "보류 — 필수 기준 미달",
  LIMITED: "일부 집단 적용 제한",
  UNVERIFIED_REAL_DATA: "합성 기준 통과 · 실제 자료 미검증(승격하지 않고 현행 유지)",
  PASS: "통과",
};
