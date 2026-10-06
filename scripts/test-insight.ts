// 분석 사실·권고·AI 문장 검증(단계 04) 테스트 — 테스트 프레임워크 없이 tsx로 실행. DB·네트워크 접근 없음(OpenAI는 fetch를 가짜로 바꿔 검증).
// 실행: npm run test:insight
import {
  DEFAULT_OPERATING_POLICY,
  INDEX_NOT_COMPOSITION_NOTE,
  acceptNarrative,
  actionDetailLines,
  actionPhrase,
  applyPolicy,
  buildProgramAction,
  buildTargetSentence,
  classifyIndex,
  decomposeContribution,
  describeIndex,
  extractNumberTokens,
  factTemplate,
  factsFromInput,
  findActionConflicts,
  guardNarrative,
  isBelowAverage,
  judgeEvidence,
  unsetPolicyItems,
  verifyReferences,
  type Fact,
  type ProgramActionInput,
} from "../src/lib/insight";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const close = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;

const F = (id: string, display: string, extra: Partial<Fact> = {}): Fact => ({
  id,
  metricId: id,
  context: id,
  value: null,
  valueKind: "text",
  unit: "",
  display,
  provenance: { source: "test" },
  basis: "observed",
  ...extra,
});
const codes = (text: string, facts: Fact[], opts = {}) => guardNarrative(text, facts, opts).violations.map((v) => v.code);

// ── 지수·강약 표현 ─────────────────────────────────────────
{
  check("153.8 지수는 기준 대비 53.8% 높은 수준(시청률·상승률 아님)", describeIndex(153.8) === "153.8 지수(기준 대비 53.8% 높은 수준)", describeIndex(153.8));
  check("68 지수는 기준 대비 32% 낮은 수준", describeIndex(68) === "68 지수(기준 대비 32% 낮은 수준)", describeIndex(68));
  check("100 지수는 기준과 같은 수준", describeIndex(100) === "100 지수(기준과 같은 수준)");
  check("강세/중립/약세 판정선: 120 이상 강세, 80 이하 약세, 그 사이 중립", classifyIndex(120) === "strong" && classifyIndex(119.9) === "neutral" && classifyIndex(80) === "weak" && classifyIndex(80.1) === "neutral");
  check("'평균 미만'은 강약 판정과 별개: 96은 중립이지만 평균 미만, 100은 평균 미만이 아님", classifyIndex(96) === "neutral" && isBelowAverage(96) && !isBelowAverage(100));

  const muhan = [96, 95, 94, 72, 38, 0].map((index, i) => ({ label: `집단${i + 1}`, index }));
  const s = buildTargetSentence(muhan);
  check("무한도전 96/95/94/72/38/0: 여러 집단이 100 미만인데 '한 집단만'·'~만 평균 미만'을 쓰지 않는다", !/한 집단|하나의 집단/.test(s) && !/[가-힣0-9]\)만 채널 평균/.test(s), s);
  check("무한도전 사례: 전체 6개 집단이 평균 미만이고 약세 3개임을 말한다", s.includes("6개 집단") && s.includes("3개 집단이 약세"), s);
  const one = buildTargetSentence([{ label: "여30대", index: 68 }, { label: "남20대", index: 110 }, { label: "여20대", index: 105 }]);
  check("100 미만이 정말 한 집단뿐이면 단독 표현을 쓴다", one.includes("여30대(68)만 채널 평균 미만"), one);
  const two = buildTargetSentence([{ label: "여30대", index: 68 }, { label: "남50대", index: 75 }, { label: "남20대", index: 130 }]);
  check("약세 2개면 '만'을 쓰지 않는다", !/\)만 채널/.test(two) && two.includes("2개 집단이 약세"), two);
  const weakPlusBelow = buildTargetSentence([{ label: "A", index: 70 }, { label: "B", index: 90 }, { label: "C", index: 130 }]);
  check("약세 1개 + 평균 미만 1개 추가: '만'을 쓰지 않고 추가 집단을 알린다", !/\)만 채널/.test(weakPlusBelow) && weakPlusBelow.includes("평균(100) 미만인 집단이 1개 더"), weakPlusBelow);
  const none = buildTargetSentence([{ label: "A", index: 101 }, { label: "B", index: 99 }, { label: "C", index: 100 }]);
  check("99처럼 약세는 아니지만 100 미만인 집단은 '고르게 나온 편'으로 뭉개지 않는다", !none.includes("고르게") && none.includes("평균(100) 미만"), none);
  const nulls = buildTargetSentence([{ label: "A", index: null }, { label: "B", index: 130 }]);
  check("지수를 산출하지 못한 집단은 제외했다고 알린다", nulls.includes("제외함"), nulls);
  check("구성비가 아니라는 안내 문구가 있다", INDEX_NOT_COMPOSITION_NOTE.includes("구성비가 아님"));
}

// ── 문장 검증기: 잘못된 해석 차단 ─────────────────────────
{
  const facts = [
    F("delta12", "▲15.1%", { value: 15.1, valueKind: "pct_change", comparison: { kind: "rolling_12w", label: "최근 12주 평균", baseValue: null, direction: "up" } }),
    F("rating", "0.147", { value: 0.147, valueKind: "rating" }),
    F("idxA", "153.8 지수", { value: 153.8, valueKind: "index100" }),
    F("idxB", "72 지수", { value: 72, valueKind: "index100" }),
  ];
  check("전주 vs 12주: 12주 기준 값을 '전주 대비'로 쓰면 차단", codes("시청률은 전주 대비 ▲15.1% 올랐다.", facts).includes("baseline_mismatch"));
  check("전주 vs 12주: 올바른 기준 표기는 통과", codes("시청률은 최근 12주 평균 대비 ▲15.1% 올랐다.", facts).length === 0, codes("시청률은 최근 12주 평균 대비 ▲15.1% 올랐다.", facts).join());
  check("근거에 없는 기준(전월)은 차단", codes("시청률은 전월 대비 올랐다.", facts).includes("baseline_mismatch"));
  check("허용되지 않은 N주 평균(6주 평균)은 차단", codes("6주 평균 대비 ▲15.1% 올랐다.", facts).includes("baseline_mismatch"));
  check("지수를 시청률%로 쓰면 차단", codes("남20대 시청률이 153.8%로 나타났다.", facts).includes("index_as_percent"));
  check("지수를 상승률로 쓰면 차단", codes("남20대는 153.8% 상승했다.", facts).includes("index_as_percent"));
  check("지수를 단위 없이 시청률처럼 쓰면 차단", codes("남20대 시청률 153.8을 기록했다.", facts).includes("index_as_percent"));
  check("올바른 지수 표현은 통과: 153.8 지수는 기준 대비 53.8% 높은 수준", codes("남20대는 153.8 지수로 기준 대비 53.8% 높은 수준이다.", facts).length === 0, codes("남20대는 153.8 지수로 기준 대비 53.8% 높은 수준이다.", facts).join());
  check("근거에 없는 지수는 차단", codes("여40대는 210 지수이다.", facts).includes("unknown_number"));
  check("화살표 방향이 근거와 반대면 차단", codes("시청률이 최근 12주 평균 대비 ▼15.1% 하락했다.", facts).includes("direction_mismatch"));
  check("▲ 표기에 하락 표현이 붙으면 차단", codes("시청률이 최근 12주 평균 대비 ▲15.1% 하락했다.", facts).includes("direction_mismatch"));
  check("인과 단정(때문에)은 차단", codes("경쟁작 때문에 시청률이 최근 12주 평균 대비 ▲15.1% 올랐다.", facts).includes("causal_claim"));
  check("헤지 표현이 있는 관측은 통과", !codes("경쟁작 편성과 동시에 관찰된 변화로, 최근 12주 평균 대비 ▲15.1%이며 원인은 알 수 없다.", facts).includes("causal_claim"));
  check("'~에 밀림' 같은 인과 서술도 차단", codes("동시간대 3위로 경쟁작에 밀렸다.", facts).includes("causal_claim"));
  check("구성비 근거 없이 핵심 시청층을 단정하면 차단", codes("핵심 시청층은 남20대이다. 153.8 지수이다.", facts).includes("composition_without_data"));
  const withComp = [...facts, F("comp", "34.5%", { value: 34.5, valueKind: "composition_pct" })];
  check("구성비 Fact가 있으면 시청층 서술 허용", !codes("핵심 시청층은 남20대로 구성비 34.5%이다.", withComp).includes("composition_without_data"));
  check("평균 미만 집단이 여러 개인데 '~만 평균 이하'는 차단", codes("여30대(72)만 채널 평균 이하이다.", facts, { belowAverageGroupCount: 3 }).includes("single_group_claim"));
  check("평균 미만 집단이 하나뿐이면 허용", !codes("여30대(72)만 채널 평균 이하이다.", facts, { belowAverageGroupCount: 1 }).includes("single_group_claim"));
  check("출처 없는 사실을 인용하면 차단", codes("시청률 0.147이다.", [F("r", "0.147", { value: 0.147, valueKind: "rating", provenance: { source: "" } })]).includes("unsourced_fact"));
  check("허용되지 않은 참조 ID는 차단", verifyReferences(["rating", "ghost"], facts).length === 1 && verifyReferences(["rating"], facts).length === 0);
  check("통과한 문장은 인용한 Fact ID를 돌려준다", guardNarrative("시청률은 0.147이다.", facts).matchedFactIds.includes("rating"));
}

// ── %와 %p, 위/회/배 단위, 본방/재방 ───────────────────────
{
  const facts = [
    F("pp", "+0.021%p", { value: 0.021, valueKind: "pp_change" }),
    F("pct", "▲12.0%", { value: 12, valueKind: "pct_change" }),
    F("rank", "3위", { value: 3, valueKind: "rank" }),
    F("air", "108회", { value: 108, valueKind: "count" }),
    F("amp", "5.9배", { value: 5.9, valueKind: "ratio_x" }),
    F("live", "0.200", { value: 0.2, valueKind: "rating", airType: "first_run" }),
    F("mix", "0.150", { value: 0.15, valueKind: "rating", airType: "mixed" }),
  ];
  check("%p 값을 %로 쓰면 차단", codes("시청률이 0.021% 올랐다.", facts).length > 0);
  check("%p 값을 %p로 쓰면 통과", codes("시청률이 0.021%p 올랐다.", facts).length === 0, codes("시청률이 0.021%p 올랐다.", facts).join());
  check("% 값을 %p로 쓰면 차단", codes("시청률이 12%p 올랐다.", facts).includes("pp_pct_confusion"));
  check("근거에 없는 %p는 차단", codes("시청률이 0.5%p 올랐다.", facts).length > 0);
  check("순위를 바꿔 쓰면 차단(3위 → 5위)", codes("동시간대 5위를 기록했다.", facts).includes("unknown_number"));
  check("편성 횟수 108회를 108배로 바꾸면 차단(값은 맞고 단위가 다름)", codes("108배 편성했다.", facts).includes("unit_mismatch"));
  check("108회·5.9배를 제 단위로 쓰면 통과", codes("108회 편성했고 확산 배수는 5.9배이다.", facts).length === 0, codes("108회 편성했고 확산 배수는 5.9배이다.", facts).join());
  check("본방 값을 재방 설명에 쓰면 차단", codes("재방 평균은 0.200이다.", facts).includes("airtype_mismatch"));
  check("본방 값을 본방 설명에 쓰면 통과", !codes("본방 평균은 0.200이다.", facts).includes("airtype_mismatch"));
  check("본방+재방 합산 값을 본방 값처럼 쓰면 차단", codes("본방 평균은 0.150이다.", facts).includes("airtype_mismatch"));
  check("본방+재방 합산 값은 합산으로 설명하면 통과", !codes("본방과 재방을 합산한 평균은 0.150이다.", facts).includes("airtype_mismatch"));
  check("단위 없는 정수(시각·회차)는 검증하지 않는다", codes("21시 방송 5회차 편성이다.", facts).length === 0, codes("21시 방송 5회차 편성이다.", facts).join());
  check("쉼표·소수 포함 숫자 추출", extractNumberTokens("▲1,234.5%").length === 1 && extractNumberTokens("▲1,234.5%")[0].value === 1234.5);
  check("acceptNarrative: 위반 문장은 null, 정상 문장은 그대로", acceptNarrative("시청률이 0.5%p 올랐다.", facts) === null && acceptNarrative("시청률이 0.021%p 올랐다.", facts) === "시청률이 0.021%p 올랐다.");
  check("사실 템플릿은 Fact 표시값만 사용", factTemplate([F("a", "▲12.0%", { context: "시청률" })]) === "시청률 ▲12.0%");
}

// ── 입력 객체 → Fact ───────────────────────────────────────
{
  const facts = factsFromInput(
    { today_rating: 0.147, today_rank: 3, baseline_avg_rank: 4.4, rating_delta_pct: "▲12.3%", demographics: [{ label: "남20대", today: 0.2, delta_pct: "▼8.1%" }] },
    { source: "page1", rules: [{ match: /delta_pct/, comparison: "rolling_4w" }] }
  );
  check("순위는 정수로 반올림해 허용(4.4 → 4위)", facts.some((f) => f.value === 4 && f.display === "4위"));
  check("문자열 등락률은 비교 기준을 갖는다", facts.filter((f) => f.display.startsWith("▲") || f.display.startsWith("▼")).every((f) => f.comparison?.kind === "rolling_4w"));
  check("입력 값에 맞는 문장은 통과", codes("오늘 시청률 0.147, 순위 3위, 최근 4주 평균 대비 ▲12.3%이다.", facts, { allowedBaselines: ["rolling_4w"] }).length === 0, codes("오늘 시청률 0.147, 순위 3위, 최근 4주 평균 대비 ▲12.3%이다.", facts, { allowedBaselines: ["rolling_4w"] }).join());
  check("입력에 없는 4.4위 소수 순위는 차단(순위는 정수)", codes("평균 4.4위였다.", facts).length > 0);
  check("입력과 다른 기준(전주)으로 쓰면 차단", codes("전주 대비 ▲12.3%이다.", facts, { allowedBaselines: ["rolling_4w"] }).includes("baseline_mismatch"));
}

// ── 기여 분해 ──────────────────────────────────────────────
{
  const A = [
    { unit: "월21|가", seconds: 3600, rating: 1.0 },
    { unit: "월22|나", seconds: 3600, rating: 0.6 },
    { unit: "화21|다", seconds: 3600, rating: 0.4 },
  ];
  const B = [
    { unit: "월21|가", seconds: 3600, rating: 0.8 }, // 같은 슬롯 성과 하락
    { unit: "월22|나", seconds: 1800, rating: 0.6 }, // 편성량 감소
    { unit: "수21|라", seconds: 3600, rating: 0.9 }, // 신규
  ]; // 화21|다는 종영
  const d = decomposeContribution(A, B, { officialBefore: 0.7, officialAfter: 0.72, periodSecondsBefore: 3 * 3600, periodSecondsAfter: 3 * 3600 });
  const sumDelta = d.units.reduce((s, u) => s + u.delta, 0);
  check("단위 기여 변화의 합 = 모델 평균의 변화(분해에 잔차 없음)", close(sumDelta, d.modelDelta ?? NaN), `${sumDelta} vs ${d.modelDelta}`);
  const same = d.units.find((u) => u.unit === "월21|가")!;
  check("같은 슬롯 항목: 편성량 효과 + 성과 효과 = 기여 변화(항등식)", close(same.volumeEffect + same.performanceEffect, same.delta));
  check("같은 슬롯·같은 분량이라도 다른 단위의 비중이 바뀌면 분모가 달라져 편성량 효과가 생긴다", Math.abs(same.volumeEffect) > 1e-6 && same.performanceEffect < 0, `${same.volumeEffect} / ${same.performanceEffect}`);
  const neu = d.units.find((u) => u.unit === "수21|라")!;
  const ended = d.units.find((u) => u.unit === "화21|다")!;
  check("신규 편성은 신규 효과로, 종영은 종영 효과로 분리", neu.kind === "new" && close(neu.newEffect, neu.delta) && neu.volumeEffect === 0 && ended.kind === "ended" && close(ended.endedEffect, ended.delta) && ended.endedEffect < 0);
  check("공식 채널 평균과 재구성값의 차이를 공개한다(잔차)", close(d.reconciliation.residualBefore, 0.7 - (1.0 + 0.6 + 0.4) / 3) && close(d.reconciliation.residualAfter, 0.72 - d.after.modelAvg!));
  check("공식 변화 − 모델 변화 = 잔차 변화", close(d.reconciliation.residualDelta, 0.72 - 0.7 - (d.modelDelta ?? 0)));
  check("커버리지(관측 방송시간 ÷ 기간 전체)를 공개한다", close(d.reconciliation.coverageBefore, 1) && close(d.reconciliation.coverageAfter, 9000 / 10800));
  check("인과 주장은 항상 불가", d.causalClaimAllowed === false && d.labelKo.includes("원인을 단정하지 않음"));
  const conf = decomposeContribution(A, B, { confounders: ["공휴일 포함", "재방 비중 변화"] });
  check("교란요인이 있으면 라벨에 드러내 '관측'으로 낮춘다", conf.labelKo.includes("교란요인 있음") && conf.labelKo.includes("공휴일 포함") && conf.causalClaimAllowed === false);
  const gap = decomposeContribution([{ unit: "a", seconds: 3600, rating: 1 }, { unit: "b", seconds: 3600, rating: null }], [{ unit: "a", seconds: 3600, rating: 1 }]);
  check("시청률 결측 방송은 0으로 채우지 않고 분모에서 제외하되 초는 공개", gap.before.modelAvg === 1 && gap.before.missingRatingSeconds === 3600 && gap.before.observedSeconds === 3600);
  const empty = decomposeContribution([], []);
  check("관측이 없으면 평균을 만들지 않는다(null)", empty.modelDelta === null && empty.before.modelAvg === null);
}

// ── 권고 후보 ──────────────────────────────────────────────
{
  const base: ProgramActionInput = {
    programName: "신병4",
    slot: { dow: 1, hour: 21 },
    period: { from: "2026-10-04", to: "2026-10-04", label: "2026-10-04" },
    purpose: "daily_review",
    snapshotId: "snap-abc",
    fitScoreTag: null,
    deviationPct: -32,
    baselineLabel: "본방 슬롯 최근 8주 평균",
    baselineDays: 8,
    observationText: "0.120, 본방 슬롯 최근 8주 평균 0.176 대비 ▼32%",
  };
  const one = buildProgramAction(base);
  check("1회 급락만으로는 교체·이동을 권하지 않는다(추적 점검)", one.kind === "MONITOR" && !one.permanentChangeSupported && one.shortLabel === "추적 점검");
  check("1회 급락이면 근거 강도는 강하지 않고 사유를 설명한다", one.evidence.strength !== "strong" && one.evidence.reasons.some((r) => r.includes("1회뿐")));
  check("권고마다 대안·확인 조건·검토일·평가 기준을 제공한다", one.alternatives.length >= 2 && one.confirmConditions.length >= 2 && one.reviewBy === "2026-10-18" && one.evaluation !== null && one.evaluation.windowDays === 28);
  check("가설은 관측과 분리되어 '가능성'으로 표현", one.hypothesis !== null && one.hypothesis.includes("가능성") && !/때문/.test(one.hypothesis));
  check("Avail은 미확인 상태로 기록하고 정책 미입력 항목을 가정으로 남긴다", one.constraints.avail === "unverified" && one.constraints.notes.some((n) => n.includes("고정 슬롯")) && unsetPolicyItems(DEFAULT_OPERATING_POLICY).length === 4);
  check("정책 버전이 액션과 함께 기록된다", one.policyVersion === DEFAULT_OPERATING_POLICY.version);
  const rep = buildProgramAction({ ...base, repeatedObservations: 3 });
  check("기준 미만이 3회 반복되고 표본 8회·편차 ▼32%면 근거가 강해 변경 검토를 권할 수 있다", rep.evidence.strength === "strong" && rep.permanentChangeSupported && rep.proposal.includes("이동·교체 검토에 착수"));
  const tagged = buildProgramAction({ ...base, fitScoreTag: "REPLACE" });
  check("Fit Score 태그가 있으면 그 판단을 쓰되 반복 확인 전에는 확정으로 보이지 않게 한다", tagged.kind === "REPLACE" && actionPhrase(tagged).includes("반복 확인 후 판단"), actionPhrase(tagged));
  check("태그와 확인 조건이 있는 문구가 같은 화면·같은 입력에서 항상 같다", actionPhrase(buildProgramAction({ ...base, fitScoreTag: "REPLACE" })) === actionPhrase(tagged));
  const up = buildProgramAction({ ...base, deviationPct: 40, observationText: "▲40%" });
  check("상승 편차는 강화 검토(목적지는 근거 없이 정하지 않음)", up.kind === "STRENGTHEN" && up.shortLabel === "강화 검토" && up.alternatives.some((a) => a.includes("Fit Score")));
  const flat = buildProgramAction({ ...base, deviationPct: -3 });
  check("편차가 작으면 유지(검토일·평가 기준 없음)", flat.kind === "KEEP" && flat.reviewBy === null && flat.evaluation === null);
  check("표본이 없으면 근거 부족", judgeEvidence(null, 1, -30).strength === "insufficient" && judgeEvidence(2, 1, -30).strength === "insufficient");

  const home = buildProgramAction(base);
  const detail = buildProgramAction({ ...base });
  check("홈과 상세가 같은 입력이면 같은 action_id·snapshot", home.actionId === detail.actionId && home.snapshotId === detail.snapshotId && home.actionKey === detail.actionKey);
  const otherPeriod = buildProgramAction({ ...base, period: { from: "2026-09-28", to: "2026-10-04", label: "최근 7일" }, purpose: "weekly_plan" });
  check("기간·목적이 다른 액션은 키가 달라 구분된다(충돌 아님)", otherPeriod.actionKey !== home.actionKey && findActionConflicts([home, otherPeriod]).length === 0);
  const conflicting = buildProgramAction({ ...base, fitScoreTag: "KEEP" });
  const conflicts = findActionConflicts([home, conflicting]);
  check("같은 대상·기간·목적에 다른 판단이면 충돌로 드러난다(숨기지 않음)", conflicts.length === 1 && conflicts[0].kinds.includes("MONITOR") && conflicts[0].kinds.includes("KEEP") && conflicts[0].message.includes("둘 다 표시"));
  check("상세 설명에 관측·가설·제안·대안·확인조건·제약·검토일·평가가 모두 있다", ["관측", "가설", "제안", "대안", "확인 조건", "근거 강도", "제약", "검토일", "실행 후 평가"].every((k) => actionDetailLines(home).some((l) => l.startsWith(k))));

  const fixed = applyPolicy(home, { ...DEFAULT_OPERATING_POLICY, version: "policy-test", fixedSlots: [{ channelCode: "ENA", dow: 1, hourFrom: 20, hourTo: 22, reason: "월 20~22 고정" }], protectedOriginals: ["신병4"] }, "ENA");
  check("고정 슬롯·오리지널 보호 정책이 제약으로 기록되고 정책 버전이 바뀐다", fixed.constraints.policyFlags.includes("fixed_slot") && fixed.constraints.policyFlags.includes("protected_original") && fixed.policyVersion === "policy-test");
  const notFixed = applyPolicy(home, { ...DEFAULT_OPERATING_POLICY, fixedSlots: [{ channelCode: "ENA", dow: 1, hourFrom: 20, hourTo: 22, reason: "x" }] }, "ENA_PLAY");
  check("다른 채널의 고정 슬롯은 적용하지 않는다", !notFixed.constraints.policyFlags.includes("fixed_slot"));
}

// ── 홈·상세 공통 입구(programActionFor) ────────────────────
async function sharedActionChecks() {
  const { programActionFor } = await import("../src/lib/insight/actionCandidate");
  const args = { programName: "신병4", startHour: 21, deviationPct: -32, baselineLabel: "본방 슬롯 최근 8주 평균", baselineDays: 8, fitScoreTag: null, observationText: "x" };
  const home = programActionFor(args);
  const detail = programActionFor({ ...args });
  check("홈·상세가 같은 입구를 쓰면 같은 판단 문구·action_id", actionPhrase(home) === actionPhrase(detail) && home.actionId === detail.actionId);
  check("날짜를 모르는 화면에서도 검토일을 지어내지 않는다(null)", home.reviewBy === null);
  check("날짜를 알면 검토일이 계산된다", programActionFor({ ...args, asOfDate: "2026-10-04" }).reviewBy === "2026-10-18");
  const tagged = programActionFor({ ...args, fitScoreTag: "MOVE" });
  check("태그가 있는 홈과 태그 없는 상세는 같은 키에서 판단이 갈려 충돌로 드러난다", findActionConflicts([home, tagged]).length === 1);
}

// ── 보고서 요약 검증(기존 factCheckNarrative 확장) — 변경 전 재현 사례가 이제 차단된다 ──
async function reportChecks() {
  const { factCheckNarrative } = await import("../src/lib/audienceReport/narrativeLlm");
  const nf = [
    { label: "시청률 12주 평균 대비", formatted: "▲15.1%" },
    { label: "시청률", formatted: "0.147" },
    { label: "무한도전 남20대", formatted: "153.8 지수" },
  ];
  const quietWarn = <T,>(fn: () => T): T => {
    const w = console.warn;
    console.warn = () => {};
    try {
      return fn();
    } finally {
      console.warn = w;
    }
  };
  check("보고서: 12주 기준 값을 전주 대비로 쓰면 차단(변경 전 통과 결함)", !quietWarn(() => factCheckNarrative("시청률은 전주 대비 ▲15.1% 올랐다.", nf)));
  check("보고서: 방향 불일치 차단(변경 전 통과 결함)", !quietWarn(() => factCheckNarrative("시청률이 12주 평균 대비 ▲15.1% 하락했다.", nf)));
  check("보고서: 인과 단정 차단(변경 전 통과 결함)", !quietWarn(() => factCheckNarrative("경쟁작 때문에 시청률이 12주 평균 대비 ▲15.1% 올랐다.", nf)));
  check("보고서: 구성비 없이 핵심 시청층 단정 차단(변경 전 통과 결함)", !quietWarn(() => factCheckNarrative("핵심 시청층은 남20대이다. 지수는 153.8 지수다.", nf)));
  check("보고서: 지수를 %로 쓰면 차단", !quietWarn(() => factCheckNarrative("남20대 시청률이 153.8%로 나타났다.", nf)));
  check("보고서: 올바른 문장은 그대로 통과(회귀 없음)", factCheckNarrative("시청률은 0.147이며 12주 평균 대비 ▲15.1%이다. 남20대는 153.8 지수이다.", nf));
}

// ── 서술 생성기(가짜 OpenAI) ───────────────────────────────
async function llmModules() {
  await sharedActionChecks();
  await reportChecks();
  process.env.OPENAI_API_KEY = "test-key-not-real";
  const realFetch = globalThis.fetch;
  let reply: unknown = null;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (reply === "__throw__") throw new Error("timeout");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200 });
  }) as typeof fetch;

  const { buildChannelNarrativeViaLlm } = await import("../src/lib/channelNarrativeLlm");
  const { buildCompetitorNarrativeViaLlm } = await import("../src/lib/competitorNarrativeLlm");
  const { buildOpportunityNarrativeViaLlm } = await import("../src/lib/opportunityNarrativeLlm");
  const { buildWhyDiagnosisViaLlm } = await import("../src/lib/whyDiagnosisLlm");
  const { buildFitScoreInterpretationViaLlm } = await import("../src/lib/fitScoreInterpretationLlm");
  const { enhanceAskAnswerViaLlm } = await import("../src/lib/askAnswerLlm");
  const { buildBriefingReportViaLlm } = await import("../src/lib/briefingReportLlm");

  const chInput = {
    channelName: "ENA", leadSentence: null, today_rating: 0.1472, baseline_avg_rating: 0.1281, rating_delta_pct: 15.1, priorWeekRating: 0.13, priorWeek2Rating: null,
    today_rank: 3, baseline_avg_rank: 4.4, dow_baseline_avg_rating: null, today_peak_hour: 22, today_peak_rating: 0.2, today_peak_program_name: "신병4",
    baseline_peak_hour: 22, top_program_name: "신병4", top_program_rating: 0.2, top_program_start_time: "22:00:00", top_program_baseline_avg: 0.18, top_program_baseline_days: 8,
    decline_program_name: null, decline_program_rating: null, decline_program_start_time: null, decline_program_baseline_avg: null, decline_program_delta_pct: null, demographics: null, household: null,
  };
  const quiet = (fn: () => Promise<unknown>) => {
    const w = console.warn;
    console.warn = () => {};
    return fn().finally(() => (console.warn = w));
  };

  reply = { narrative: "오늘 시청률 0.147로 최근 4주 평균 대비 ▲15.1% 올랐고 3위를 기록했다." };
  check("채널 인사이트: 입력 값과 기준에 맞는 문장은 통과", (await buildChannelNarrativeViaLlm(chInput)) === (reply as { narrative: string }).narrative);
  reply = { narrative: "오늘 시청률 0.147로 전주 대비 ▲15.1% 올랐다." };
  check("채널 인사이트: 4주 평균 기준 값을 '전주 대비'로 바꾸면 폐기(null → 규칙 기반 문구로 대체)", (await quiet(() => buildChannelNarrativeViaLlm(chInput))) === null);
  reply = { narrative: "오늘 시청률 0.147로 최근 4주 평균 대비 ▲15.1% 하락했다." };
  check("채널 인사이트: 화살표와 방향어가 어긋나면 폐기", (await quiet(() => buildChannelNarrativeViaLlm(chInput))) === null);
  reply = { narrative: "신병4 때문에 시청률이 0.147로 올랐다." };
  check("채널 인사이트: 인과 단정은 폐기", (await quiet(() => buildChannelNarrativeViaLlm(chInput))) === null);
  reply = { narrative: "오늘 시청률 0.147로 최근 4주 평균 대비 ▲15.1%이고 평균 4.4위였다." };
  check("채널 인사이트: 소수 순위(4.4위)는 폐기(순위는 정수)", (await quiet(() => buildChannelNarrativeViaLlm(chInput))) === null);
  reply = "__throw__";
  check("OpenAI 실패·타임아웃이면 null(호출부가 규칙 기반 문구 사용)", (await buildChannelNarrativeViaLlm(chInput)) === null);

  const compInput = { channelName: "ENA", competitors: [{ competitor_name: "tvN", today_rating: 0.31, delta_pct: 22.5, top_program_name: "A", top_program_start_time: "21:00:00" }] };
  reply = { narrative: "tvN은 최근 12주 평균 대비 22.5% 높았다." };
  check("경쟁 서술: 지정한 기준 표현은 통과", (await buildCompetitorNarrativeViaLlm(compInput)) !== null);
  reply = { narrative: "tvN은 전주 대비 22.5% 높았다." };
  check("경쟁 서술: 12주 평균 기준 값을 전주 대비로 쓰면 폐기", (await quiet(() => buildCompetitorNarrativeViaLlm(compInput))) === null);
  reply = { narrative: "tvN 때문에 ENA가 밀렸다. 최근 12주 평균 대비 22.5%." };
  check("경쟁 서술: 인과 단정은 폐기", (await quiet(() => buildCompetitorNarrativeViaLlm(compInput))) === null);

  const oppInput = { channelName: "ENA", recentLabel: "최근 1주", hourBlocks: [{ label: "심야(2~4시)", our_full_avg: 0.05, our_recent_avg: 0.07, gap_full: 0.12, gap_recent: 0.08, gap_change: 0.04, classification: "OPPORTUNITY" as const }], candidatePrograms: [] };
  reply = { narrative: "심야(2~4시)는 격차가 0.12에서 0.08로 좁혀졌다." };
  check("기회 서술: 입력 수치 인용은 통과", (await buildOpportunityNarrativeViaLlm(oppInput)) !== null);
  reply = { narrative: "심야(2~4시)는 격차가 0.12에서 0.03으로 좁혀졌다." };
  check("기회 서술: 지어낸 수치(0.03)는 폐기", (await quiet(() => buildOpportunityNarrativeViaLlm(oppInput))) === null);

  const whyInput = { channelName: "ENA", candidates: [{ variable: "프라임", strengthPct: 31, sentence: "프라임 평균이 ▼31% 낮았다." }] };
  reply = { leadSentence: "프라임 평균이 ▼31% 낮았다." };
  check("WHY 진단: 후보 문장 수치 인용은 통과", (await buildWhyDiagnosisViaLlm(whyInput)) !== null);
  reply = { leadSentence: "프라임 부진 때문에 ▼31% 하락했다." };
  check("WHY 진단: 인과 단정은 폐기", (await quiet(() => buildWhyDiagnosisViaLlm(whyInput))) === null);
  reply = { leadSentence: "프라임 평균이 ▼45% 낮았다." };
  check("WHY 진단: 후보에 없는 수치는 폐기", (await quiet(() => buildWhyDiagnosisViaLlm(whyInput))) === null);

  const fitInput = { programName: "신병4", tag: "REPLACE" as const, fitScore: 42, confidencePct: 55, subScores: [{ label: "타깃 성과", value: 72 }, { label: "경쟁 기회", value: 31 }], audienceRoleLabel: null };
  reply = { interpretation: "타깃 성과 72는 강점이고 경쟁 기회 31은 주의할 점이다. 신뢰도 55로 참고용이다." };
  check("Fit 해석: 입력 점수 인용은 통과", (await buildFitScoreInterpretationViaLlm(fitInput)) !== null);
  reply = { interpretation: "타깃 성과 88은 강점이다." };
  check("Fit 해석: 지어낸 점수(88)는 폐기", (await quiet(() => buildFitScoreInterpretationViaLlm(fitInput))) === null);

  const askInput = { question: "최근 4주 ENA 시청률은?", conclusion: "ENA 시청률 0.147", keyNumbers: "0.147 / 3위", comparisonBasis: "최근 4주 평균 0.128", evidence: "근거", confidenceNote: "표본 28일" };
  reply = { interpretation: "시청률 0.147은 최근 4주 평균 0.128보다 높다.", programmingAction: "다음 주에도 같은 흐름인지 확인해 볼 만하다." };
  check("자연어 답변: 준 수치 해석은 통과", (await enhanceAskAnswerViaLlm(askInput)) !== null);
  reply = { interpretation: "시청률 0.147은 전주 평균 0.128보다 높다.", programmingAction: "확인해 볼 만하다." };
  check("자연어 답변: 기준을 전주로 바꾸면 폐기(기존 템플릿 문구 유지)", (await quiet(() => enhanceAskAnswerViaLlm(askInput))) === null);
  reply = { interpretation: "시청률이 0.321로 올랐다.", programmingAction: "확인해 볼 만하다." };
  check("자연어 답변: 지어낸 수치는 폐기", (await quiet(() => enhanceAskAnswerViaLlm(askInput))) === null);

  const briefInput = {
    channelName: "ENA", refLabel: "어제", currentRating: 0.12, enaLeadSentence: null, rating_delta_pct: -12.5, baseline_avg_rating: 0.14, dow_baseline_avg_rating: null, today_peak_hour: 22, today_peak_rating: 0.2,
    today_peak_program_name: "신병4", today_peak_program_rating: 0.2, baseline_peak_hour: 22, baseline_peak_rating: 0.21, today_peak_vs_baseline_peak_pct: null, top_program_name: null, top_program_rating: null,
    top_program_start_time: null, top_program_baseline_avg: null, top_program_baseline_days: null, demographics: null, groupAHouseholdException: null, today_rank: 3, baseline_avg_rank: 4, today_share: null,
    baseline_avg_share: null, decline_program_name: null, decline_program_rating: null, decline_program_start_time: null, decline_program_baseline_avg: null, decline_program_baseline_days: null,
    decline_program_delta_pct: null, target_rank: null, target_achievement_pct: null, same_weekday_avg_rating: null, same_weekday_sample_days: null, prime_label: "평일 19~23시",
    prime_today_avg_rating: null, prime_baseline_avg_rating: null, today_time_spent_minutes: null, today_share_pct: null, prime_focus_program_name: null, prime_focus_program_rating: null, prime_focus_program_start_time: null,
  };
  reply = { headline: "시청률은 최근 12주 평균 대비 ▼12.5%", verdict: "down" };
  check("브리핑 헤드라인: 입력 등락률 인용은 통과", (await buildBriefingReportViaLlm(briefInput)) !== null);
  reply = { headline: "'신병4' 부진이 끌어내린 날 ▼12.5%", verdict: "down" };
  check("브리핑 헤드라인: 인과 서술(끌어내린)은 폐기", (await quiet(() => buildBriefingReportViaLlm(briefInput))) === null);
  reply = { headline: "시청률 전주 대비 ▼12.5%", verdict: "down" };
  check("브리핑 헤드라인: 기준 바꿔치기는 폐기", (await quiet(() => buildBriefingReportViaLlm(briefInput))) === null);
  reply = { headline: "시청률은 최근 12주 평균 대비 ▲12.5%", verdict: "down" };
  check("브리핑 헤드라인: 방향 반대 표기는 폐기", (await quiet(() => buildBriefingReportViaLlm(briefInput))) === null);

  delete process.env.OPENAI_API_KEY;
  const callsBefore = calls;
  check("API 키가 없으면 호출 없이 null(규칙 기반 설명·KPI는 그대로 사용 가능)", (await buildChannelNarrativeViaLlm(chInput)) === null && (await buildCompetitorNarrativeViaLlm(compInput)) === null && (await buildBriefingReportViaLlm(briefInput)) === null && calls === callsBefore);
  globalThis.fetch = realFetch;
}

llmModules()
  .then(() => {
    console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
    if (failures.length) {
      console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
