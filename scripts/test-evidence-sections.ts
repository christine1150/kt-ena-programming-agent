// 보고서 근거 단락(편성 변경 사후 효과·공휴일 영향) 순수 함수 테스트 — 고도화 B1·A2. DB·네트워크 없음.
// 실행: npm run test:evidence-sections
import { holidayTypeOf } from "../src/lib/holiday/dayType";
import { changeEffectSection, forecastAccuracySection, holidayEffectSection, REPORT_MIN_N, CHANGE_EFFECT_NOTE, HOLIDAY_EFFECT_NOTE, HOLIDAY_REFERENCE } from "../src/lib/reportSnapshot/evidenceText";
import { earliestPerWeek, summarizeForecastAccuracy, type ReviewedSlot, type SlotValue, type WeekReview } from "../src/lib/reportSnapshot/forecastAccuracyCore";
import type { ChangeEffectSummary, HolidayEffectSummary } from "../src/lib/reportSnapshot/types";

let pass = 0;
let fail = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`✗ ${name}\n   기대 ${e}\n   실제 ${a}`);
  }
}
const ok = (name: string, cond: boolean) => eq(name, cond, true);
const near = (name: string, actual: number | null | undefined, expected: number, tol = 1e-9) => ok(`${name} (기대 ${expected}, 실제 ${actual})`, actual !== null && actual !== undefined && Math.abs(actual - expected) <= tol);

// ── 공휴일 유형(2026년 시드 일부) ──
const H = new Map<string, string>([
  ["2026-02-16", "설날 연휴"], ["2026-02-17", "설날"], ["2026-02-18", "설날 연휴"],
  ["2026-03-01", "삼일절"], ["2026-03-02", "대체공휴일(삼일절)"],
  ["2026-05-05", "어린이날"],
  ["2026-06-03", "제9회 전국동시지방선거"],
  ["2026-09-24", "추석 연휴"], ["2026-09-25", "추석"], ["2026-09-26", "추석 연휴"],
  ["2026-10-09", "한글날"],
]);
eq("어린이날(화)은 평일 하루 공휴일", holidayTypeOf("2026-05-05", H), "single");
eq("어린이날 전날(월)", holidayTypeOf("2026-05-04", H), "eve");
eq("어린이날 다음 날(수)", holidayTypeOf("2026-05-06", H), "after");
eq("설날(화)은 설·추석 연휴", holidayTypeOf("2026-02-17", H), "seol_chuseok");
eq("설 연휴 다음 날(목)", holidayTypeOf("2026-02-19", H), "after");
eq("설 연휴 앞 금요일은 주말을 건너 연휴에 닿으므로 전날(eve)", holidayTypeOf("2026-02-13", H), "eve");
eq("삼일절(일)은 주말 공휴일이라 null", holidayTypeOf("2026-03-01", H), null);
eq("대체공휴일(월)은 주말에 붙은 하루 → single", holidayTypeOf("2026-03-02", H), "single");
eq("대체공휴일 다음 날(화)", holidayTypeOf("2026-03-03", H), "after");
eq("지방선거(수) 임시공휴일 → single", holidayTypeOf("2026-06-03", H), "single");
eq("추석(금)은 설·추석 연휴", holidayTypeOf("2026-09-25", H), "seol_chuseok");
eq("한글날(금) 주말에 붙은 하루 → single", holidayTypeOf("2026-10-09", H), "single");
eq("평범한 평일은 null", holidayTypeOf("2026-04-15", H), null);
eq("평범한 토요일은 null", holidayTypeOf("2026-04-18", H), null);
eq("빈 공휴일표면 항상 null", holidayTypeOf("2026-05-05", new Map()), null);

// ── 편성 변경 사후 효과 단락 ──
const base: ChangeEffectSummary = {
  from: "2025-10-07", to: "2026-11-09", basis: "noise",
  replace: { n: 42, up: 12, flat: 21, down: 9, endedN: 17 },
  move: { n: 14, up: 6, flat: 4, down: 4, toSlot: { n: 11, up: 7, down: 3 }, fromSlot: { n: 12, up: 4, down: 6 } },
  recent: [
    { kind: "replace", date: "2026-10-12", program: "맛있는 녀석들", prev: "냉장고를 부탁해", from: "2|23", to: "2|23", before: 0.012, after: 0.019, verdict: "up", swap: true },
    { kind: "move", date: "2026-09-21", program: "유 퀴즈 온 더 블럭", prev: null, from: "4|17", to: "6|14", before: 0.02, after: 0.031, verdict: "flat", swap: null },
    { kind: "replace", date: "2026-09-01", program: "신작", prev: "종영작", from: "3|20", to: "3|20", before: 0.03, after: 0.01, verdict: "down", swap: false },
  ],
};
const ce = changeEffectSection(base, "ENA_PLAY");
ok("섹션 생성", ce !== null);
eq("섹션 키", ce?.key, "change_effect");
const bullets = (ce?.blocks.find((b) => b.kind === "bullets") as { items: string[] } | undefined)?.items ?? [];
ok("교체 문장에 건수 포함", bullets.some((t) => t.includes("42건") && t.includes("12건") && t.includes("9건")));
ok("종료 뒤 교체 제외 안내", bullets.some((t) => t.includes("17건")));
ok("기간은 연도를 붙여 표기(1년 범위가 한 달로 읽히지 않게)", bullets.some((t) => t.includes("2025.10.7~2026.11.9")));
ok("이동 문장에 건수 포함", bullets.some((t) => t.includes("14건")));
ok("자리 기준 문장", bullets.some((t) => t.includes("새 자리") && t.includes("비운 자리")));
ok("잡음 폭 기준 안내", bullets.some((t) => t.includes("잡음 폭")));
const tbl = ce?.blocks.find((b) => b.kind === "table") as { headers: string[]; rows: string[][] } | undefined;
eq("최근 변경 표 행 수", tbl?.rows.length, 3);
eq("교체 행 프로그램 표기", tbl?.rows[0][2], "냉장고를 부탁해 → 맛있는 녀석들");
eq("이동 행 자리 표기", tbl?.rows[1][3], "목 17시대 → 토 14시대");
eq("작품 종료 뒤 교체 유형 표기", tbl?.rows[2][1], "교체(작품 종료 뒤)");
eq("판정 한글", tbl?.rows.map((r) => r[5]), ["상승", "잡음 범위 안", "하락"]);
const allText = JSON.stringify(ce);
ok("기대 효과 수치 문구 없음(기대·약속)", !/기대 효과\s*[+-]?\d/.test(allText) && !/\+\d+%/.test(allText));
ok("한계 주석 포함", allText.includes("약속하지 않음") || CHANGE_EFFECT_NOTE.includes("약속하지 않음"));

eq("사례 부족이면 null", changeEffectSection({ ...base, replace: { ...base.replace, n: REPORT_MIN_N - 1 }, move: { ...base.move, n: 3 } }, "ENA_PLAY"), null);
eq("null 입력", changeEffectSection(null, "ENA_PLAY"), null);
const onlyMove = changeEffectSection({ ...base, replace: { n: 2, up: 1, flat: 1, down: 0, endedN: 0 } }, "ENA_PLAY");
const onlyMoveBullets = (onlyMove?.blocks.find((b) => b.kind === "bullets") as { items: string[] } | undefined)?.items ?? [];
ok("교체 사례가 적으면 교체 문장만 생략", onlyMoveBullets.every((t) => !t.includes("편성상의 교체")) && onlyMoveBullets.some((t) => t.includes("이동")));
const band10 = changeEffectSection({ ...base, basis: "band10" }, "ENA_PLAY");
ok("±10% 띠 안내", JSON.stringify(band10).includes("±10% 띠"));
const thinSlots = changeEffectSection({ ...base, move: { ...base.move, toSlot: { n: 3, up: 1, down: 1 }, fromSlot: { n: 2, up: 1, down: 0 } } }, "ENA_PLAY");
ok("자리 기준 표본이 5건 미만이면 자리 문장 생략", !JSON.stringify(thinSlots).includes("비운 자리"));

// ── 공휴일 영향 단락 ──
const hs: HolidayEffectSummary = {
  from: "2026-05-01", to: "2026-05-10",
  days: [
    { date: "2026-05-04", name: null, type: "eve", day: 1.02, evening: 0.98, all: 1.0 },
    { date: "2026-05-05", name: "어린이날", type: "single", day: 1.43, evening: 0.97, all: 1.21 },
    { date: "2026-05-06", name: null, type: "after", day: null, evening: null, all: null },
  ],
};
const he = holidayEffectSection(hs);
eq("섹션 키", he?.key, "holiday_effect");
const ht = he?.blocks.find((b) => b.kind === "table") as { headers: string[]; rows: string[][] } | undefined;
eq("배수를 못 낸 날은 표에서 뺀다", ht?.rows.length, 2);
eq("어린이날 행", ht?.rows[1], ["5/5(화)", "어린이날 · 평일 공휴일", "1.43배", "0.97배", "1.21배"]);
eq("전날 행 라벨", ht?.rows[0][1], "연휴·공휴일 전날");
const hAll = JSON.stringify(he);
ok("상관 참고 안내", hAll.includes("상관 참고") || HOLIDAY_EFFECT_NOTE.includes("상관 참고"));
ok("'연휴 전날 특수' 같은 문구 없음", !hAll.includes("특수"));
ok("과거 참고 문장 포함", hAll.includes("참고") && HOLIDAY_REFERENCE.includes("낮"));
eq("모든 날이 배수 없음 → null", holidayEffectSection({ ...hs, days: [{ date: "2026-05-06", name: null, type: "after", day: null, evening: null, all: null }] }), null);
eq("날짜 없음 → null", holidayEffectSection({ ...hs, days: [] }), null);
eq("null 입력", holidayEffectSection(null), null);

// ── 예측 적중 집계(순수) ──
const slotsOf = (weekStart: string, rows: { k: string; s?: string; a: number | null; e: number | null; g: string | null }[]): ReviewedSlot[] => rows.map((r) => ({ k: `${weekStart}|${r.k}`, s: r.s ?? "MATCHED", a: r.a, e: r.e, g: r.g }));
const valuesOf = (weekStart: string, keys: string[], low = 0.01, high = 0.05): Map<string, SlotValue> => new Map(keys.map((k, i) => [`${weekStart}|${k}`, { date: weekStart, startMin: 300 + i * 60, program: `프로그램 ${k}\n(특집)`, low, high }]));
// 25칸: 예상 0.04, 실적 0.03(범위 안, +0.01 오차), 다섯 칸은 실적 0.10(범위 밖, −0.06 오차)
const keys25 = Array.from({ length: 25 }, (_, i) => `s${i}`);
const mkWeek = (weekStart: string, createdAt: string, bias = 0): WeekReview => ({
  weekStart, createdAt,
  matches: slotsOf(weekStart, keys25.map((k, i) => ({ k, a: i < 5 ? 0.1 : 0.03, e: 0.04 + bias, g: i % 2 === 0 ? "A" : "C" }))),
  officialDaily: { n: 7, mae: 0.01, bias: -0.002, actualMean: 0.05 },
  values: valuesOf(weekStart, keys25),
});
const acc = summarizeForecastAccuracy([mkWeek("2026-10-26", "2026-10-20T00:00:00Z")]);
ok("집계 생성", acc !== null);
eq("주 수", acc?.weeks, 1);
eq("MATCHED 칸", acc?.slots.matched, 25);
eq("범위 안 칸: 20/25", [acc?.withinRange.hit, acc?.withinRange.n], [20, 25]);
// Σ|e−a| = 20×0.01 + 5×0.06 = 0.5, Σa = 20×0.03 + 5×0.10 = 1.1
near("상대 평균 오차", acc?.relMae, 0.5 / 1.1, 1e-9);
near("범위 폭 중앙값((0.05−0.01) ÷ 0.04 = 1.0)", acc?.rangeWidthRel, 1.0, 1e-9);
// Σ(e−a) = 20×0.01 − 5×0.06 = −0.1
near("편향(낮게 예측)", acc?.relBias, -0.1 / 1.1, 1e-9);
eq("가장 크게 빗나간 5칸이 모두 범위 밖", acc?.worst.map((w) => w.inRange), [false, false, false, false, false]);
eq("가장 크게 빗나간 칸 개수", acc?.worst.length, 5);
near("공식 하루 상대 오차", acc?.officialDaily.relMae, 0.01 / 0.05, 1e-9);
eq("등급 A·C만 있음", acc?.byGrade.map((g) => g.grade), ["A", "C"]);
eq("표본 20칸 미만이면 null", summarizeForecastAccuracy([{ ...mkWeek("2026-10-26", "2026-10-20T00:00:00Z"), matches: slotsOf("2026-10-26", keys25.slice(0, 19).map((k) => ({ k, a: 0.03, e: 0.04, g: "A" }))) }]), null);
eq("빈 입력 null", summarizeForecastAccuracy([]), null);
// 한 주에 여러 예측이면 가장 이른 것만(방송에 가까운 수정 예측으로 성적을 좋게 보이게 하지 않음)
const early = mkWeek("2026-10-26", "2026-10-20T00:00:00Z", 0);
const late = mkWeek("2026-10-26", "2026-10-25T00:00:00Z", 0.5); // 편향이 훨씬 큰 예측
eq("가장 이른 사전 예측 하나만", earliestPerWeek([late, early]).length, 1);
eq("가장 이른 것 선택", earliestPerWeek([late, early])[0].createdAt, "2026-10-20T00:00:00Z");
eq("두 주면 칸이 두 배", summarizeForecastAccuracy([early, mkWeek("2026-11-02", "2026-10-27T00:00:00Z")])?.slots.matched, 50);
// 대조 상태: MATCHED만 오차에 쓰고 나머지는 제외 건수로만
const withExcluded = summarizeForecastAccuracy([{ ...early, matches: [...early.matches, ...slotsOf("2026-10-26", [{ k: "x1", s: "CHANGED", a: null, e: 0.9, g: "A" }, { k: "x2", s: "AMBIGUOUS", a: null, e: 0.9, g: "A" }, { k: "x3", s: "NO_ACTUAL", a: null, e: 0.9, g: "A" }])] }]);
eq("제외 칸 수", [withExcluded?.slots.changed, withExcluded?.slots.ambiguous, withExcluded?.slots.noActual], [1, 1, 1]);
near("제외 칸은 오차에 영향 없음", withExcluded?.relMae, 0.5 / 1.1, 1e-9);

// ── 예측 적중 단락 ──
const fa = forecastAccuracySection(acc, "ENA_PLAY");
eq("섹션 키", fa?.key, "forecast_accuracy");
const faBullets = (fa?.blocks.find((b) => b.kind === "bullets") as { items: string[] } | undefined)?.items ?? [];
ok("대조 칸 문장", faBullets.some((t) => t.includes("25칸")));
ok("범위 안 비율 문장(80%)", faBullets.some((t) => t.includes("20/25") && t.includes("80%")));
ok("오차·편향 문장(낮게 예측)", faBullets.some((t) => t.includes("낮게 예측")));
ok("범위 폭 안내", faBullets.some((t) => t.includes("범위 폭") && t.includes("100%")));
ok("표본 적음 안내(1주)", faBullets.some((t) => t.includes("1주뿐") && t.includes("표본 적음")));
ok("등급 라벨", faBullets.some((t) => t.includes("A 같은 자리 이력") && t.includes("C 이력 없음")));
ok("공식 하루 문장", faBullets.some((t) => t.includes("공식 채널 하루 값")));
const faTbl = fa?.blocks.find((b) => b.kind === "table") as { rows: string[][] } | undefined;
eq("표 5행", faTbl?.rows.length, 5);
ok("프로그램명 줄바꿈 정리", faTbl?.rows.every((r) => !r[1].includes("\n")) ?? false);
eq("범위 밖 표시", faTbl?.rows[0][5], "범위 밖");
eq("표본 부족이면 null", forecastAccuracySection({ ...acc!, slots: { ...acc!.slots, matched: 19 } }, "ENA_PLAY"), null);
eq("null 입력", forecastAccuracySection(null, "ENA_PLAY"), null);
const faAll = JSON.stringify(fa);
ok("한계 주석(가장 이른 예측만 셈)", faAll.includes("가장 이른"));
const manyWeeks = forecastAccuracySection({ ...acc!, weeks: 8 }, "ENA_PLAY");
ok("4주 이상이면 표본 적음 안내 없음", !JSON.stringify(manyWeeks).includes("표본 적음"));

console.log(`\n${pass}건 통과${fail ? `, ${fail}건 실패` : ""}`);
if (fail) process.exit(1);
