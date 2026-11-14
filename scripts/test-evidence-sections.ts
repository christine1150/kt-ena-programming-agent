// 보고서 근거 단락(편성 변경 사후 효과·공휴일 영향) 순수 함수 테스트 — 고도화 B1·A2. DB·네트워크 없음.
// 실행: npm run test:evidence-sections
import { holidayTypeOf } from "../src/lib/holiday/dayType";
import { changeEffectSection, holidayEffectSection, REPORT_MIN_N, CHANGE_EFFECT_NOTE, HOLIDAY_EFFECT_NOTE, HOLIDAY_REFERENCE } from "../src/lib/reportSnapshot/evidenceText";
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

console.log(`\n${pass}건 통과${fail ? `, ${fail}건 실패` : ""}`);
if (fail) process.exit(1);
