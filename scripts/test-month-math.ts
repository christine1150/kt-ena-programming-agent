// 월 더하기(말일 보정) 날짜 산술 테스트 — 기존 함수 두 개를 같은 사례로 검증한다. 구현은 바꾸지 않는다.
// 배경: A 에는 월 연산 구현이 둘 있다(avail/dates.ts addMonthsIso — 구매기간·종료일 계산, audienceReport/periodPresets.ts addMonthsClampedStr — 기간 비교).
// 홀드백 종료일(본방일+N개월)처럼 새 계산을 얹기 전에 "8/31+3개월=11/30" 같은 말일 보정이 두 함수에서 같게 동작하는지 고정해 둔다.
// 실행: npm run test:month-math   (DB·네트워크 없음)
import { addMonthsIso, inclusiveEndFromTerm } from "../src/lib/avail/dates";
import { addMonthsClampedStr } from "../src/lib/audienceReport/periodPresets";

let passed = 0;
const failures: string[] = [];
function eq(name: string, actual: string, expected: string) {
  const ok = actual === expected;
  if (ok) passed++;
  else failures.push(`${name} — 기대 ${expected}, 실제 ${actual}`);
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` — 기대 ${expected}, 실제 ${actual}`}`);
}

// [시작일, 더할 개월, 기대 결과, 설명]
const CASES: [string, number, string, string][] = [
  ["2026-08-31", 3, "2026-11-30", "8/31+3개월 = 11/30(11월에 31일이 없어 말일로 보정)"],
  ["2026-01-31", 1, "2026-02-28", "평년 1/31+1개월 = 2/28"],
  ["2028-01-31", 1, "2028-02-29", "윤년 1/31+1개월 = 2/29"],
  ["2026-11-30", 3, "2027-02-28", "연도가 넘어가는 말일 보정"],
  ["2026-12-15", 1, "2027-01-15", "연말 넘김(말일 아님)"],
  ["2028-02-29", 12, "2029-02-28", "윤일 + 12개월 = 다음 해 2/28"],
  ["2026-10-01", 0, "2026-10-01", "0개월은 그대로"],
  ["2026-03-31", -1, "2026-02-28", "음수(이전 달)도 말일 보정"],
  ["2026-05-31", -3, "2026-02-28", "5/31-3개월 = 2/28(3/3로 밀리지 않음)"],
  ["2024-02-29", -12, "2023-02-28", "윤일 -12개월"],
  ["2026-03-15", -3, "2025-12-15", "연초에서 이전 해로"],
];
for (const [start, months, expected, label] of CASES) {
  eq(`addMonthsIso: ${label}`, addMonthsIso(start, months), expected);
  eq(`addMonthsClampedStr: ${label}`, addMonthsClampedStr(start, months), expected);
}

// 종료일(포함) = 시작일 + N개월 − 1일 (구매기간 규칙, 단계 06)
eq("inclusiveEndFromTerm: 8/31 시작 3개월 → 11/29", inclusiveEndFromTerm("2026-08-31", 3), "2026-11-29");
eq("inclusiveEndFromTerm: 10/1 시작 12개월 → 다음 해 9/30", inclusiveEndFromTerm("2026-10-01", 12), "2027-09-30");
eq("inclusiveEndFromTerm: 1/31 시작 1개월 → 2/27", inclusiveEndFromTerm("2026-01-31", 1), "2026-02-27");

console.log(`\n${failures.length === 0 ? "✅ 모두 통과" : "❌ 실패 있음"} — 통과 ${passed}건${failures.length ? `, 실패 ${failures.length}건` : ""}`);
if (failures.length) process.exit(1);
