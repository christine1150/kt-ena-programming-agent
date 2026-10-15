// 약해진 자리 판정·문구 테스트 — DB·네트워크 없음. 실행: npm run test:weak-verdict
//
// 보증하는 것: ① 한 입력에서 수치·판정·근거 문장이 함께 나오고 서로 모순되지 않는다 ② 중앙값 0·표본 부족·결측이면 단정하지 않고 판단 보류
// ③ 실제 시청률 0과 결측(null)을 구분 ④ 채널 단위 근거와 프로그램 단위 판정이 문장에서 섞이지 않는다 ⑤ 긴 제목 약칭 치환
// ⑥ 2026-10-15 재현 사례(ENA Play 수 9시 나는SOLO그후사랑은계속된다)가 더는 "이번 한 번만 낮은 일시적 하락"으로 나오지 않는다.
// 보증하지 못하는 것: 임계값(기준선 0.8배·최근 8회·과반)의 업무 타당성 — 기존 값 재사용이며 확인 사항으로 보고한다.
import { buildCardCopy, type AiSuggestionPayload } from "../src/lib/dashboard/homeCopy";
import { STATUS_KO, WEAK_VERDICT_CONFIG, basisLabel, judgeWeakSlot, verdictCause, type VerdictBasis, type WeakVerdict } from "../src/lib/dashboard/weakSlotVerdict";
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
const remedyFor = (v: WeakVerdict, ownCount: number, n = v.sampleCount): WeakSlotRemedyView => {
  const basis: VerdictBasis = { n, ownCount, ownLowCount: 0 };
  const cause = (verdictCause(v, basis) ?? "").replace(/\.$/, "");
  return {
    lines: [cause],
    concrete: false,
    sample: n,
    brief: { cause, action: "다음 방영(수요일)이 기준선 아래이면 이동·교체 검토" },
    hole: { program: LONG, hour: 9, ratioPct: v.ratioPct === null ? null : Math.round(v.ratioPct) },
    verdict: { status: v.status, statusKo: STATUS_KO[v.status], holdReason: v.holdReason, today: v.today, median: v.median, ratioPct: v.ratioPct, dropLine: v.dropLine, sampleCount: v.sampleCount, lowCount: v.lowCount, ownCount, missingCount: v.missingCount },
  };
};
const aiOf = (r: WeakSlotRemedyView): AiSuggestionPayload => ({ channelCode: "ENA_PLAY", weekStart: "2026-10-12", currentExpected: null, aiExpected: null, change: null, remedy: r });
const copyOf = (v: WeakVerdict, opt: { own?: number; achievementPct?: number; structural?: boolean; priorPct?: number | null } = {}) =>
  buildCardCopy({ achievementPct: opt.achievementPct ?? 46, rating: 0.03, goalRating: 0.0652, priorPct: opt.priorPct ?? null, structural: opt.structural ?? false, program: null, ai: aiOf(remedyFor(v, opt.own ?? v.sampleCount)) });
const allText = (c: ReturnType<typeof buildCardCopy>) => [c.headline, c.cause, c.action, ...c.more].filter(Boolean).join(" ");

// ── 재현 사례: 실제 데이터(ENA Play 수 9시, 같은 자리 직전 8회·4개 프로그램, 최신순) ──
{
  const prior = [0.02475, 0.05521, 0.00159, 0.03045, 0.02041, 0.04418, 0.00085, 0.03183];
  const v = judgeWeakSlot(0, prior);
  check("재현: 오늘 0은 실제 시청률 0으로 유효(결측 아님) — 판정 대상", v.today === 0 && v.holdReason !== "today_missing");
  check("재현: 중앙값은 0.0276(8회 정렬 가운데 두 값 평균), 기준선은 0.8배", Math.abs((v.median ?? 0) - 0.0276) < 1e-9 && Math.abs((v.dropLine ?? 0) - 0.02208) < 1e-9, `${v.median}/${v.dropLine}`);
  check("재현: 직전 8회 중 기준선 미만은 3회(0.00159·0.02041·0.00085)", v.lowCount === 3, String(v.lowCount));
  check("재현: '이번 한 번만 낮은 일시적 하락'이 아니라 판단 보류(과거에도 낮은 회차가 섞임)", v.status === "hold" && v.holdReason === "mixed_history", `${v.status}/${v.holdReason}`);
  const c = copyOf(v, { own: 2, achievementPct: 46, structural: true, priorPct: 73 });
  const t = allText(c);
  check("재현: 문구에 '이번 한 번만' 단정이 없다", !t.includes("이번 한 번만") && !t.includes("이번만 낮은 일시적"), t);
  check("재현: 오늘 0.0000과 중앙값 0.028을 숫자로 밝히고 '0%'를 쓰지 않으며 제목을 되풀이하지 않는다", /오늘 0\.0000?[, ]/.test(t) && t.includes("중앙값 0.028") && !t.includes("0%") && !(c.cause ?? "").includes("나솔사계"), t);
  check("재현: 비교한 8회 중 이 프로그램은 2회뿐임을 밝힌다", t.includes("이 프로그램 방영분은 2회 중 0회"), t);
  check("재현: 채널 전체 근거(73%)는 '채널 전체'로 범위를 밝히고 프로그램 판정과 섞이지 않는다", t.includes("채널 전체는 전주·전전주 같은 요일도 목표의 73% 이하"), t);
  check("재현: 옛 문구 '오늘만의 문제가 아닙니다'가 없다", !t.includes("오늘만의 문제가 아닙니다"), t);
  check("재현: 목표 46%와 프로그램을 인과로 잇지 않고 '평소 대비 하락이 가장 큰 자리'라고만 한다", c.headline === "목표의 46% 달성 — 같은 자리 중앙값 대비 하락이 가장 큰 곳은 9시 '나솔사계'", c.headline ?? "");
  check("재현: 긴 제목이 약칭으로 표시된다", !t.includes(LONG) && t.includes("나솔사계"), t);
  check("재현: 화면 문구 규칙(용어·내부 이름) 위반 0건", findWordingIssues(t).length === 0, findWordingIssues(t).map((i) => i.rule).join(","));
}

// ── 10개 시나리오 ──────────────────────────────────────────
const NORMAL = [1.0, 0.95, 1.05, 1.0, 0.9, 1.1, 1.0, 0.95]; // 중앙값 1.0, 기준선 0.8 — 모두 정상
{ // 1) 이번만 낮고 최근 2주(채널)는 정상
  const v = judgeWeakSlot(0.3, NORMAL);
  const c = copyOf(v, { structural: false });
  check("1) 이번 회차만 낮고 과거는 모두 정상 → 일시적 하락 가능성", v.status === "transient" && v.lowCount === 0, v.status);
  check("1) 문구는 일시적 가능성만 말하고 지속 표현이 없다", allText(c).includes("일시적 하락 가능성") && !/지속적 부진|단기 부진|오늘만의/.test(allText(c)), allText(c));
}
{ // 2) 이번만 낮지만 채널의 최근 2주 목표 달성률도 낮음 — 서로 다른 범위의 사실이라 모순 없이 함께 쓴다
  const v = judgeWeakSlot(0.3, NORMAL);
  const t = allText(copyOf(v, { structural: true, priorPct: 73 }));
  check("2) 프로그램은 일시적, 채널은 2주 연속 저조 — 범위를 나눠 둘 다 쓰되 '오늘만의 문제가 아닙니다'는 쓰지 않는다", t.includes("일시적 하락 가능성") && t.includes("채널 전체는") && !t.includes("오늘만의 문제가 아닙니다"), t);
}
{ // 3) 다수 회차가 지속적으로 낮음(8회 과반)
  const v = judgeWeakSlot(0.3, [0.3, 0.3, 0.3, 0.3, 1.0, 1.0, 0.9, 1.0]);
  const t = allText(copyOf(v));
  check("3) 최근 4회가 모두 그 이전 4회 기준선 아래로 내려앉음 → 지속적 부진 가능성(단정 아님)", v.status === "persistent" && v.levelShift?.recentLow === 4, `${v.status}/${v.levelShift?.recentLow}`);
  const same = judgeWeakSlot(0.3, [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
  check("3) 8회 내내 같은 낮은 수준이면 '낮아졌다'가 아니라 평소 수준(기준선 위) — 중앙값 기준으로는 부진을 단정하지 않는다", same.status === "not_low", same.status);
  check("3) 문구에 '일시적 하락'이 함께 나오지 않는다", t.includes("지속적 부진 가능성") && !t.includes("일시적 하락 가능성"), t);
}
{ // 4) 중앙값이 0 — 비율 산출 금지, 판단 보류
  const v = judgeWeakSlot(0, [0, 0, 0, 0, 0, 0, 0, 0]);
  const c = copyOf(v);
  check("4) 중앙값 0 → 판단 보류, 달성률 비율(%) 없음", v.status === "hold" && v.holdReason === "median_zero" && v.ratioPct === null && v.dropLine === null, `${v.status}/${v.ratioPct}`);
  check("4) 문구에 중앙값 대비 %가 나오지 않는다", !/중앙값[^.]*\d+%/.test(allText(c)), allText(c));
}
{ // 5) NULL·결측 회차
  const v = judgeWeakSlot(0.3, [null, 1.0, undefined, 0.95, 1.05, Number.NaN, 1.0, 0.9]);
  check("5) 결측(null·undefined·NaN) 3회는 비교에서 빼고 수를 따로 센다", v.sampleCount === 5 && v.missingCount === 3, `${v.sampleCount}/${v.missingCount}`);
  check("5) 결측을 0으로 바꿔 세지 않는다(낮은 회차 0)", v.lowCount === 0 && v.status === "transient", `${v.lowCount}/${v.status}`);
  const t0 = judgeWeakSlot(null, NORMAL);
  check("5) 오늘 값이 결측이면 0%로 대체하지 않고 판단 보류", t0.status === "hold" && t0.holdReason === "today_missing" && t0.ratioPct === null);
  const z = judgeWeakSlot(0, NORMAL);
  check("5) 오늘 값이 실제 0이면 결측과 구분되어 판정한다(낮음)", z.today === 0 && z.status === "transient");
}
{ // 6) 최근 8회 표본이 8개 미만
  const few = judgeWeakSlot(0.3, [0.3, 0.3, 1, 1, 1]);
  check("6) 표본 5회(<8)는 과반이 낮아도 '지속적 부진'으로 올리지 않는다 → 단기 부진 지속", few.status === "short_persist", few.status);
  const thin = judgeWeakSlot(0.3, [1.0, 1.0]);
  check("6) 표본 2회(<3)는 판단 보류", thin.status === "hold" && thin.holdReason === "thin_sample", `${thin.status}/${thin.holdReason}`);
  const t = allText(copyOf(thin));
  check("6) 표본 부족 문구에 일시적·지속 단정이 없다", !/일시적 하락 가능성|지속적 부진 가능성/.test(t), t);
}
{ // 7) 중앙값 대비는 양호하지만 채널 최근 2주는 낮음 → 프로그램 판정은 '기준선 위', 채널 근거는 별도
  const v = judgeWeakSlot(1.0, NORMAL);
  const t = allText(copyOf(v, { structural: true, priorPct: 73 }));
  check("7) 오늘이 중앙값 수준이면 프로그램은 '기준선 위'(낮음 아님)", v.status === "not_low", v.status);
  check("7) 프로그램 부진 표현이 없고 채널 근거만 따로 나온다", !/부진이 이어|지속적 부진|일시적 하락 가능성/.test(t) && t.includes("채널 전체는"), t);
}
{ // 8) 목표 달성률은 낮지만 과거 중앙값 대비 실적은 정상
  const v = judgeWeakSlot(0.95, NORMAL);
  check("8) 달성률 46%여도 프로그램이 정상 범위면 근거 문장에 부진·하락 단정이 없다", v.status === "not_low" && !/부진|하락 가능성/.test(copyOf(v).cause ?? ""), copyOf(v).cause ?? "");
}
{ // 9) 전체 목표 미달인데 개별 프로그램 기여도는 확인되지 않음 → 인과 표현 금지
  const v = judgeWeakSlot(0.3, NORMAL);
  const c = copyOf(v, { achievementPct: 46 });
  check("9) 헤드라인이 프로그램을 목표 미달의 원인으로 단정하지 않는다('때문'·'원인'·'가장 부진' 없음)", !!c.headline && !/때문|원인|가장 부진|기여/.test(c.headline), c.headline ?? "");
}
{ // 10) 결정성 — 같은 입력은 판정·문장이 같다
  const run = () => JSON.stringify([judgeWeakSlot(0, [0.02475, 0.05521, 0.00159, 0.03045, 0.02041, 0.04418, 0.00085, 0.03183]), copyOf(judgeWeakSlot(0.3, NORMAL), { structural: true, priorPct: 73 })]);
  const a = run();
  const ok = Array.from({ length: 20 }, run).every((x) => x === a);
  check("10) 같은 데이터로 20회 반복해도 판정·문장이 동일", ok);
}

// ── 경계·설정·약칭 ──────────────────────────────────────────
{
  const cfg = WEAK_VERDICT_CONFIG;
  check("설정: 기준선 0.8·표본 3·창 8·과반 0.5는 기존 weakSlotRemedy 값과 같다", cfg.dropRatio === 0.8 && cfg.minSample === 3 && cfg.persistentMinSample === 8 && cfg.persistentLowShare === 0.5);
  const edge = judgeWeakSlot(0.8, NORMAL); // 중앙값 1.0 대비 정확히 −20%: 기존 `dev <= -0.2`와 같이 낮음으로 본다
  check("경계: 중앙값 대비 정확히 −20%는 낮음으로 본다", edge.status !== "not_low", edge.status);
  const half = judgeWeakSlot(0.3, [0.3, 0.3, 1, 1, 0.3, 0.3, 1, 1]); // 최근 4회 중 정확히 절반(2회)만 이전 기준선 아래 — 과반(>0.5) 아님
  check("경계: 최근 구간의 절반만 낮으면 지속적 부진이 아니다(과반 초과만)", half.status !== "persistent", half.status);
  check("basisLabel: 시간대 전체로 넓힌 비교는 이 프로그램 몇 회인지 밝힌다", basisLabel({ n: 8, ownCount: 2, ownLowCount: 0 }) === "같은 요일·시간대 최근 8회(이 프로그램 2회·다른 프로그램 6회)" && basisLabel({ n: 8, ownCount: 8, ownLowCount: 0 }) === "같은 요일·시간대 최근 8회");
  check("약칭: 띄어쓰기·쉼표가 달라도 같은 제목이면 '나솔사계'", shortProgramName("나는 SOLO, 그 후 사랑은 계속된다") === "나솔사계" && shortProgramName(LONG) === "나솔사계");
  check("약칭: 다른 프로그램('나는SOLO')은 바꾸지 않는다", shortProgramName("나는SOLO") === "나는SOLO" && shortenProgramNames("'나는SOLO' 방영") === "'나는SOLO' 방영");
  check("약칭: 문장 안의 제목만 바꾸고 나머지는 그대로", shortenProgramNames(`9시 '${LONG}'가 부진`) === "9시 '나솔사계'가 부진");
}

console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
if (failures.length) {
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
