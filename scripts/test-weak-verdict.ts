// 약해진 자리 판정·문구 테스트 — DB·네트워크 없음. 실행: npm run test:weak-verdict
//
// 보증하는 것: ① 한 입력에서 수치·판정·근거 문장이 함께 나오고 서로 모순되지 않는다 ② 중앙값 0·표본 부족·결측이면 단정하지 않고 판단 보류
// ③ 실제 시청률 0과 결측(null)을 구분 ④ 채널 단위 근거와 프로그램 단위 판정이 문장에서 섞이지 않는다 ⑤ 긴 제목 약칭 치환
// ⑥ 2026-10-15 재현 사례(ENA Play 수 9시 나는SOLO그후사랑은계속된다)가 더는 "이번 한 번만 낮은 일시적 하락"으로 나오지 않는다.
// ⑦ 2026-10-23 채널별 규칙: 방영 한 편이 아니라 최근 N회 평균(저시청 2049는 4회)을 채널 기준선(평상시 헛경보 10% 선)과 견준다.
// 보증하지 못하는 것: 기준선 값 자체의 타당성 — 실측 보정·검증 결과는 scripts/skill-baseline/weak-calibrate.mts와 docs/agent-improvement/SKILL_BASELINE.md에 있다.
import { buildCardCopy, structuralGapOf, type AiSuggestionPayload } from "../src/lib/dashboard/homeCopy";
import { gapContribution, gapShareOf } from "../src/lib/dashboard/gapContribution";
import { findLongLowSlots } from "../src/lib/dashboard/longLowSlots";
import { DEFAULT_WEAK_SLOT_RULE, STATUS_KO, WEAK_SLOT_RULES, WEAK_VERDICT_CONFIG, basisLabel, judgeWeakSlot, verdictCause, weakSlotRuleFor, type VerdictBasis, type WeakVerdict } from "../src/lib/dashboard/weakSlotVerdict";
import type { WeakSlotRemedyView } from "../src/lib/dashboard/weakSlotView";
import { shortenProgramNames, shortProgramName } from "../src/lib/programAlias";
import { findWordingIssues } from "../src/lib/ui/glossary";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const LONG = "나는SOLO그후사랑은계속된다";
const remedyFor = (v: WeakVerdict, ownCount: number, n = v.baseCount): WeakSlotRemedyView => {
  const basis: VerdictBasis = { n, ownCount, ownLowCount: 0 };
  const cause = (verdictCause(v, basis) ?? "").replace(/\.$/, "");
  return {
    lines: [cause],
    concrete: false,
    sample: n,
    brief: { cause, action: "다음 방영(수요일)이 기준선 아래이면 이동·교체 검토" },
    hole: { program: LONG, hour: 9, ratioPct: v.ratioPct === null ? null : Math.round(v.ratioPct) },
    verdict: { status: v.status, statusKo: STATUS_KO[v.status], holdReason: v.holdReason, today: v.today, window: v.window, level: v.level, median: v.median, ratioPct: v.ratioPct, dropLine: v.dropLine, sampleCount: v.baseCount, lowCount: v.lowCount, ownCount, missingCount: v.missingCount },
  };
};
const aiOf = (r: WeakSlotRemedyView): AiSuggestionPayload => ({ channelCode: "ENA_PLAY", weekStart: "2026-10-12", currentExpected: null, aiExpected: null, change: null, remedy: r });
const copyOf = (v: WeakVerdict, opt: { own?: number; achievementPct?: number; structural?: boolean; priorPct?: number | null } = {}) =>
  buildCardCopy({ achievementPct: opt.achievementPct ?? 46, rating: 0.03, goalRating: 0.0652, priorPct: opt.priorPct ?? null, structural: opt.structural ?? false, program: null, ai: aiOf(remedyFor(v, opt.own ?? v.sampleCount)) });
const allText = (c: ReturnType<typeof buildCardCopy>) => [c.headline, c.cause, c.action, ...c.more].filter(Boolean).join(" ");

// ── 재현 사례: 실제 데이터(ENA Play 수 9시, 같은 자리 직전 8회·4개 프로그램, 최신순) — ENA Play 규칙(최근 4회 평균) ──
const PLAY = weakSlotRuleFor("ENA_PLAY");
{
  const prior = [0.02475, 0.05521, 0.00159, 0.03045, 0.02041, 0.04418, 0.00085, 0.03183];
  const v = judgeWeakSlot(0, prior, PLAY);
  check("재현: 오늘 0은 실제 시청률 0으로 유효(결측 아님) — 판정 대상", v.today === 0 && v.holdReason !== "today_missing");
  check("재현: 최근 4회 평균(오늘 0 포함)은 0.0204, 비교 회차는 그 앞 5회·중앙값 0.03045", v.window === 4 && Math.abs((v.level ?? 0) - 0.0203875) < 1e-9 && v.baseCount === 5 && Math.abs((v.median ?? 0) - 0.03045) < 1e-9, `${v.level}/${v.baseCount}/${v.median}`);
  check("재현: 기준선은 중앙값 × ENA Play 선(0.55)", Math.abs((v.dropLine ?? 0) - 0.03045 * PLAY.line) < 1e-9, String(v.dropLine));
  check("재현: 오늘 0이어도 4회 평균이 평소 흔들림 범위 안 → 부진으로 단정하지 않는다(오늘은 낮지만 평균은 평소 범위)", v.status === "transient", v.status);
  const c = copyOf(v, { own: 2, achievementPct: 46, structural: true, priorPct: 73 });
  const t = allText(c);
  check("재현: 문구에 '이번 한 번만'·'일시적 하락' 단정이 없고, 한 편으로는 판단할 수 없다고 밝힌다", !t.includes("이번 한 번만") && !t.includes("일시적 하락") && t.includes("한 편만으로는 부진을 판단할 수 없어"), t);
  check("재현: 오늘 0.0000과 4회 평균·중앙값을 숫자로 밝히고 '0%'를 쓰지 않으며 제목을 되풀이하지 않는다", /오늘 0\.0000?[(, ]/.test(t) && t.includes("최근 4회 평균 0.020") && t.includes("중앙값 0.030") && !/(^|[^0-9])0%/.test(t) && !(c.cause ?? "").includes("나솔사계"), t);
  check("재현: 비교 회차 중 이 프로그램은 2회뿐임을 밝힌다", t.includes("이 프로그램 방영분은 2회"), t);
  check("재현: 채널 전체 근거(73%)는 '채널 전체'로 범위를 밝히고 프로그램 판정과 섞이지 않는다", t.includes("채널 전체는 전주·전전주 같은 요일 평균도 목표의 73%여서"), t);
  check("재현: 옛 문구 '오늘만의 문제가 아닙니다'가 없다", !t.includes("오늘만의 문제가 아닙니다"), t);
  check("재현: 목표 46%와 프로그램을 인과로 잇지 않고 '평소 대비 하락이 가장 큰 자리'라고만 한다", c.headline === "목표의 46% 달성 — 같은 자리 중앙값 대비 하락이 가장 큰 곳은 9시 '나솔사계'", c.headline ?? "");
  check("재현: 긴 제목이 약칭으로 표시된다", !t.includes(LONG) && t.includes("나솔사계"), t);
  check("재현: 화면 문구 규칙(용어·내부 이름) 위반 0건", findWordingIssues(t).length === 0, findWordingIssues(t).map((i) => i.rule).join(","));
}

// ── 10개 시나리오(2회 평균 채널 규칙: OLIFE) ──────────────────────
const R2 = weakSlotRuleFor("OLIFE");
const NORMAL = [1.0, 0.95, 1.05, 1.0, 0.9, 1.1, 1.0, 0.95]; // 비교 회차 — 중앙값 1.0
const withPrev = (...recent: number[]) => [...recent, ...NORMAL];
{ // 1) 오늘만 낮고 직전 방영은 정상
  const v = judgeWeakSlot(0.3, withPrev(1.0), R2);
  const c = copyOf(v, { structural: false });
  check("1) 오늘만 크게 낮고 2회 평균은 평소 범위 → 부진 판정 아님(오늘은 낮지만 평균은 평소 범위)", v.status === "transient" && v.lowCount === 0, v.status);
  check("1) 문구에 지속·단기 부진 표현이 없다", allText(c).includes("평소 흔들림 범위 안") && !/지속적 부진|단기 부진|오늘만의/.test(allText(c)), allText(c));
}
{ // 2) 오늘만 낮지만 채널의 최근 2주 목표 달성률도 낮음 — 서로 다른 범위의 사실이라 모순 없이 함께 쓴다
  const v = judgeWeakSlot(0.3, withPrev(1.0), R2);
  const t = allText(copyOf(v, { structural: true, priorPct: 73 }));
  check("2) 프로그램은 평소 범위, 채널은 2주 연속 저조 — 범위를 나눠 둘 다 쓰되 '오늘만의 문제가 아닙니다'는 쓰지 않는다", t.includes("평소 흔들림 범위 안") && t.includes("채널 전체는") && !t.includes("오늘만의 문제가 아닙니다"), t);
}
{ // 3) 연속으로 낮음
  const two = judgeWeakSlot(0.3, withPrev(0.3), R2);
  check("3) 오늘·직전 2회 평균이 기준선 아래(처음) → 단기 부진", two.status === "short_persist" && two.prevLow === false, `${two.status}/${two.prevLow}`);
  const three = judgeWeakSlot(0.3, withPrev(0.3, 0.3), R2);
  const t = allText(copyOf(three));
  check("3) 한 회 앞 판정(직전 2회 평균)도 기준선 아래 → 지속적 부진 가능성(단정 아님)", three.status === "persistent" && three.prevLow === true, `${three.status}/${three.prevLow}`);
  check("3) 문구에 '평소 흔들림 범위 안'이 함께 나오지 않는다", t.includes("지속적 부진 가능성") && !t.includes("평소 흔들림 범위 안"), t);
  const same = judgeWeakSlot(0.3, [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3], R2);
  check("3) 내내 같은 낮은 수준이면 '낮아졌다'가 아니라 평소 수준 — 절대 기준은 별도 확인 사항", same.status === "not_low", same.status);
}
{ // 4) 중앙값이 0 — 비율 산출 금지, 판단 보류
  const v = judgeWeakSlot(0, [0, 0, 0, 0, 0, 0, 0, 0, 0], R2);
  const c = copyOf(v);
  check("4) 중앙값 0 → 판단 보류, 비율(%) 없음", v.status === "hold" && v.holdReason === "median_zero" && v.ratioPct === null && v.dropLine === null, `${v.status}/${v.ratioPct}`);
  check("4) 문구에 중앙값 대비 %가 나오지 않는다", !/중앙값[^.]*\d+%/.test(allText(c)), allText(c));
}
{ // 5) NULL·결측 회차
  const v = judgeWeakSlot(0.3, [1.0, null, 1.0, undefined, 0.95, 1.05, Number.NaN, 1.0, 0.9], R2);
  check("5) 결측(null·undefined·NaN) 3회는 비교에서 빼고 수를 따로 센다", v.sampleCount === 6 && v.missingCount === 3 && v.baseCount === 5, `${v.sampleCount}/${v.missingCount}/${v.baseCount}`);
  check("5) 결측을 0으로 바꿔 세지 않는다(낮은 회차 0, 평균은 평소 범위)", v.lowCount === 0 && v.status === "transient", `${v.lowCount}/${v.status}`);
  const t0 = judgeWeakSlot(null, withPrev(1.0), R2);
  check("5) 오늘 값이 결측이면 0%로 대체하지 않고 판단 보류", t0.status === "hold" && t0.holdReason === "today_missing" && t0.ratioPct === null);
  const z = judgeWeakSlot(0, withPrev(1.0), R2);
  check("5) 오늘 값이 실제 0이면 결측과 구분되어 판정한다(2회 평균 0.5 < 기준선 0.55 → 단기 부진)", z.today === 0 && z.status === "short_persist", z.status);
}
{ // 6) 비교 회차 부족
  const thin = judgeWeakSlot(0.3, [1.0, 1.0, 1.0], R2);
  check("6) 2회 평균 채널: 직전 3회(최근 창 1회 + 비교 2회)는 판단 보류", thin.status === "hold" && thin.holdReason === "thin_sample", `${thin.status}/${thin.holdReason}`);
  const thin4 = judgeWeakSlot(0.3, [1, 1, 1, 1, 1], PLAY);
  check("6) 4회 평균 채널: 직전 5회(최근 창 3회 + 비교 2회)는 판단 보류", thin4.status === "hold" && thin4.holdReason === "thin_sample", `${thin4.status}/${thin4.holdReason}`);
  const t = allText(copyOf(thin));
  check("6) 표본 부족 문구에 부진 단정이 없다", !/단기 부진|지속적 부진 가능성/.test(t), t);
}
{ // 7) 중앙값 대비는 양호하지만 채널 최근 2주는 낮음 → 프로그램 판정은 '평소 흔들림 범위 안', 채널 근거는 별도
  const v = judgeWeakSlot(1.0, withPrev(1.0), R2);
  const t = allText(copyOf(v, { structural: true, priorPct: 73 }));
  check("7) 최근 평균이 중앙값 수준이면 프로그램은 '평소 흔들림 범위 안'(낮음 아님)", v.status === "not_low", v.status);
  check("7) 프로그램 부진 표현이 없고 채널 근거만 따로 나온다", !/부진이 이어|지속적 부진|단기 부진/.test(t) && t.includes("채널 전체는"), t);
}
{ // 8) 목표 달성률은 낮지만 과거 중앙값 대비 실적은 정상
  const v = judgeWeakSlot(0.95, withPrev(0.9), R2);
  check("8) 달성률 46%여도 프로그램이 정상 범위면 근거 문장에 부진·하락 단정이 없다", v.status === "not_low" && !/부진|하락 가능성/.test(copyOf(v).cause ?? ""), copyOf(v).cause ?? "");
}
{ // 9) 전체 목표 미달인데 개별 프로그램 기여도는 확인되지 않음 → 인과 표현 금지
  const v = judgeWeakSlot(0.3, withPrev(0.3), R2);
  const c = copyOf(v, { achievementPct: 46 });
  check("9) 헤드라인이 프로그램을 목표 미달의 원인으로 단정하지 않는다('때문'·'원인'·'가장 부진' 없음)", !!c.headline && !/때문|원인|가장 부진|기여/.test(c.headline), c.headline ?? "");
}
{ // 10) 결정성 — 같은 입력은 판정·문장이 같다
  const run = () => JSON.stringify([judgeWeakSlot(0, [0.02475, 0.05521, 0.00159, 0.03045, 0.02041, 0.04418, 0.00085, 0.03183], PLAY), copyOf(judgeWeakSlot(0.3, withPrev(1.0), R2), { structural: true, priorPct: 73 })]);
  const a = run();
  const ok = Array.from({ length: 20 }, run).every((x) => x === a);
  check("10) 같은 데이터로 20회 반복해도 판정·문장이 동일", ok);
}

// ── 경계·설정·약칭 ──────────────────────────────────────────
{
  const cfg = WEAK_VERDICT_CONFIG;
  check("설정: 비교 회차 최소 3·최대 8은 기존 weakSlotRemedy 값과 같다", cfg.minSample === 3 && cfg.baseTake === 8);
  const rules = Object.entries(WEAK_SLOT_RULES);
  check("설정: 모든 채널 규칙은 2회·4회 평균이고 기준선은 0~1배 사이", rules.every(([, r]) => (r.window === 2 || r.window === 4) && r.line > 0 && r.line < 1), JSON.stringify(WEAK_SLOT_RULES));
  check("설정: 저시청 2049(ENA Drama·ENA Play)와 skyUHD는 4회 평균만 쓴다", ["ENA_DRAMA", "ENA_PLAY", "SKYUHD"].every((c) => weakSlotRuleFor(c).window === 4));
  check("설정: 규칙이 없는 채널은 기본 규칙", weakSlotRuleFor("UNKNOWN") === DEFAULT_WEAK_SLOT_RULE);
  const edge = judgeWeakSlot(R2.line, withPrev(R2.line), R2); // 2회 평균이 정확히 기준선 = 중앙값 1.0 × line
  check("경계: 최근 평균이 정확히 기준선이면 낮음이 아니다(기준선 '아래'만 낮음)", edge.status === "not_low", edge.status);
  const old = judgeWeakSlot(0.75, withPrev(0.75), R2); // 옛 규칙(0.8배)이면 낮음이었던 값
  check("경계: 옛 0.8배 규칙에서 낮음이던 25% 하락(2회 연속)도 OLIFE 평소 흔들림 안이면 부진이 아니다", old.status === "not_low", old.status);
  check("basisLabel: 시간대 전체로 넓힌 비교는 이 프로그램 몇 회인지 밝힌다", basisLabel({ n: 8, ownCount: 2, ownLowCount: 0 }) === "같은 요일·시간대 그 앞 8회(이 프로그램 2회·다른 프로그램 6회)" && basisLabel({ n: 8, ownCount: 8, ownLowCount: 0 }) === "같은 요일·시간대 그 앞 8회");
  check("약칭: 띄어쓰기·쉼표가 달라도 같은 제목이면 '나솔사계'", shortProgramName("나는 SOLO, 그 후 사랑은 계속된다") === "나솔사계" && shortProgramName(LONG) === "나솔사계");
  check("약칭: 다른 프로그램('나는SOLO')은 바꾸지 않는다", shortProgramName("나는SOLO") === "나는SOLO" && shortenProgramNames("'나는SOLO' 방영") === "'나는SOLO' 방영");
  check("약칭: 문장 안의 제목만 바꾸고 나머지는 그대로", shortenProgramNames(`9시 '${LONG}'가 부진`) === "9시 '나솔사계'가 부진");
}

// ── 목표 격차 기여(분 가중, 2026-10-23 확인 대기 3) ──
{
  const c = { rating: 0.01, usual: 0.03, minutes: 60, scale: 0.93 };
  const s = gapShareOf(c, 0.03, 0.0652);
  check("기여: (시청률×배율−목표)×분÷1440 ÷ 격차", !!s && Math.abs(s.share - ((0.0093 - 0.0652) * 60) / 1440 / (0.03 - 0.0652)) < 1e-9 && Math.round(s.share * 100) === 7, JSON.stringify(s));
  check("기여: 평소 수준이었다면의 몫은 더 작다", !!s && s.usualShare !== null && s.usualShare < s.share && Math.round(s.usualShare * 100) === 4, JSON.stringify(s));
  check("기여: 목표 이상이면 말하지 않는다", gapShareOf(c, 0.07, 0.0652) === null);
  check("기여: 방영이 목표 이상이면 말하지 않는다", gapShareOf({ ...c, rating: 0.2 }, 0.03, 0.0652) === null);
  check("기여: 모든 방영 몫의 합 = 격차(하루 전체를 덮을 때)", (() => { const t = 0.05, sc = 1; const rs = [0.02, 0.04, 0.06]; const off = rs.reduce((a, r) => a + r * 480, 0) / 1440; const sum = rs.reduce((a, r) => a + gapContribution(r, 480, sc, t), 0); return Math.abs(sum - (off - t)) < 1e-12; })());
  const v = { status: "persistent", statusKo: STATUS_KO.persistent, holdReason: null, today: 0.01, window: 2, level: 0.012, median: 0.03, ratioPct: 40, dropLine: 0.0135, sampleCount: 8, lowCount: 3, ownCount: 8, missingCount: 0 } as const;
  const remedy = { lines: [], concrete: false, sample: 8, brief: { cause: "", action: "" }, hole: { program: "테스트", hour: 21, ratioPct: 40 }, verdict: v, contribution: { date: "2026-10-22", ...c } } as unknown as WeakSlotRemedyView;
  const copy = buildCardCopy({ achievementPct: 46, rating: 0.03, goalRating: 0.0652, priorPct: null, structural: false, program: null, ai: aiOf(remedy) });
  // 실제 사례(ENA Story 10/22 인간극장 74분, 달성 88.7%): 몫 34%, 같은 자리 중앙값은 목표 이상
  const story = { ...remedy, contribution: { date: "2026-10-22", rating: 0.01165, usual: 0.07499, minutes: 74, scale: 0.9255 } } as WeakSlotRemedyView;
  const sc = buildCardCopy({ achievementPct: 88.7, rating: 0.03898, goalRating: 0.04395, priorPct: null, structural: false, program: null, ai: aiOf(story) });
  check("기여 문구: 같은 자리 중앙값이 목표 이상이면 0% 대신 격차를 줄였을 자리라고 쓴다", (sc.cause ?? "").includes("격차의 34%를 차지했습니다(편성 분 가중, 같은 자리 중앙값 수준이었다면 오히려 격차를 줄였을 자리)"), sc.cause ?? "");
  check("기여 문구: 방영 분과 몫, 평소 수준 몫을 함께 적는다", (copy.cause ?? "").includes("이 방영(약 60분)이 오늘 채널 목표 격차의 7%를 차지했습니다(편성 분 가중, 같은 자리 중앙값 수준이었다면 4%)"), copy.cause ?? "");
}

// ── 오래 낮은 자리(2026-10-23 확인 대기 5) ──
{
  // 같은 20~23시 구간 다섯 자리(월~금 21시) — 월요일만 8주 내내 낮다. 새벽 3시 구간은 모두 0.
  const air: { date: string; dow: number; startMin: number; name: string; rating: number }[] = [];
  const day = (w: number, dow: number) => new Date(Date.parse("2026-08-31T00:00:00Z") + ((w * 7 + dow - 1) * 864e5)).toISOString().slice(0, 10);
  for (let w = 0; w < 8; w++) {
    for (const [dow, r] of [[1, 0.01], [2, 0.05], [3, 0.06], [4, 0.07], [5, 0.08]] as const) air.push({ date: day(w, dow), dow, startMin: 21 * 60, name: dow === 1 ? "낮은프로" : "보통프로", rating: r + (w % 2) * 0.001 });
    for (const dow of [1, 2, 3, 4, 5]) air.push({ date: day(w, dow), dow, startMin: 27 * 60, name: "새벽", rating: 0 });
  }
  const res = findLongLowSlots(air, "2026-10-25");
  check("오래 낮은 자리: 8주 내내 구간 하위 20%선 아래인 자리만 잡는다", res.length === 1 && res[0].dow === 1 && res[0].hour === 21 && res[0].program === "낮은프로", JSON.stringify(res));
  check("오래 낮은 자리: 구간 전체가 0인 새벽은 측정 하한이라 잡지 않는다", !res.some((s) => s.hour === 27));
  const once = air.map((a) => (a.dow === 1 && a.startMin === 21 * 60 && a.date === day(7, 1) ? { ...a, rating: 0.09 } : a));
  check("오래 낮은 자리: 최근 8회 중 한 번이라도 선 위면 잡지 않는다", findLongLowSlots(once, "2026-10-25").length === 0);
}

// ── 구조적 격차: 전주·전전주 평균(2026-10-23 변경, 확인 대기 4) ──
{
  const g1 = structuralGapOf(70, 0.1, [0.09, 0.07]); // 각각 90%·70%, 평균 80%
  check("구조적 격차: 한 주가 85% 이상이어도 두 주 평균이 85% 미만이면 구조적으로 본다", g1.structural && Math.round(g1.priorPct ?? 0) === 80, JSON.stringify(g1));
  const g2 = structuralGapOf(70, 0.1, [0.09, 0.085]);
  check("구조적 격차: 두 주 평균이 85% 이상이면 아니다", !g2.structural, JSON.stringify(g2));
  check("구조적 격차: 오늘 달성률이 80% 이상이면 아니다", !structuralGapOf(82, 0.1, [0.05, 0.05]).structural);
  check("구조적 격차: 지난 값이 없으면 판정하지 않는다", !structuralGapOf(50, 0.1, []).structural && structuralGapOf(50, 0.1, []).priorPct === null);
}

console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
if (failures.length) {
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
