// 편성 변경 사후 효과 측정 순수 함수 테스트(고도화 S-2/B1) — DB·네트워크 없음.
// 실행: npm run test:change-events
// 범위(명세 §3.4 중 1단계 분): ② measureChanges 단위(공휴일 제외·잡음 띠 경계·prev_continues·자리 기준 이동) ③ 20건 미만 셀 숨김
//   ④ 잡음 표가 없을 때 ±10% 띠 폴백. (① 회귀 77건은 크론 첫 적재 뒤 별도 점검, ⑤ 홈 문구는 3단계)
import { CHANGE_BAND, detectPastChanges, eightDaypart, measureChanges, noiseBandPct, summarizeEffect, MIN_EFFECT_CELL_N, type HistAiring, type MeasuredChange } from "../src/lib/dashboard/changeHistory";
import type { NoiseTable } from "../src/lib/iptvNoise";

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
const near = (name: string, actual: number | null | undefined, expected: number, tol = 1e-9) => {
  if (actual !== null && actual !== undefined && Math.abs(actual - expected) <= tol) pass++;
  else {
    fail++;
    console.error(`✗ ${name}\n   기대 ${expected} (±${tol})\n   실제 ${actual}`);
  }
};

const dowOf = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mk = (date: string, startMin: number, key: string, rating: number): HistAiring => ({ date, dow: dowOf(date), startMin, key, rating });
/** 월요일 20:30 시작 — 슬롯 '1|20' */
const MON20 = 20 * 60 + 30;
/** 화요일 21:00 시작 — 슬롯 '2|21' */
const TUE21 = 21 * 60;
const weekly = (start: string, count: number, startMin: number, key: string, rating: number) => Array.from({ length: count }, (_, i) => mk(addDay(start, 7 * i), startMin, key, rating));

const noHoliday = new Set<string>();
const noiseTable = (step: number): NoiseTable => ({ version: "test", periodFrom: "2025-01-01", periodTo: "2026-10-31", bands: { household: [{ lo: 0, hi: null, noiseStep: step, nPairs: 100 }], p2049: [{ lo: 0, hi: null, noiseStep: step, nPairs: 100 }] } });

// ── 8대 시간대 경계 ──
eq("시간대 경계 4→02-05", eightDaypart(4), "02-05");
eq("시간대 경계 5→05-08", eightDaypart(5), "05-08");
eq("시간대 경계 19→17-20", eightDaypart(19), "17-20");
eq("시간대 경계 20→20-23", eightDaypart(20), "20-23");
eq("시간대 경계 23→23-02", eightDaypart(23), "23-02");
eq("시간대 경계 25→23-02", eightDaypart(25), "23-02");

// ── 교체: 월 20시 자리에서 A(6주, 1.0) → B(6주, 1.5) ──
const A = weekly("2026-01-05", 6, MON20, "프로그램에이", 1.0);
const B = weekly("2026-02-16", 6, MON20, "프로그램비", 1.5);
const base = [...A, ...B];
const found = detectPastChanges(base, "2026-04-01").filter((c) => c.kind === "replace");
eq("교체 1건 추출", found.length, 1);
const m1 = measureChanges(base, found, { holidays: noHoliday, noise: noiseTable(0.5), targetKind: "household" })[0];
eq("교체 시간대", m1.daypart, "20-23");
near("교체 변화율", m1.change, 0.5);
eq("±10% 띠 상승", m1.verdictBand10, "up");
// 잡음 띠: 0.5/√6 ≈ 0.204, 대칭 변화 폭 0.5/1.25 = 0.4 > 0.204 → 상승
near("잡음 띠 값", m1.noiseStep, 0.5 / Math.sqrt(6), 1e-9);
eq("잡음 띠 상승", m1.verdictNoise, "up");
eq("종료 후 교체(이전 프로그램이 다른 자리에 없음)", m1.prevContinues, false);
near("4주 창 변화율", m1.w4?.change, 0.5);
eq("4주 창 후 방영 수", m1.w4?.afterN, 4);

// 이전 프로그램이 28일 안에 다른 자리(화 20시)에서 계속 방영되면 편성상의 교체
const withCont = [...base, mk("2026-02-24", 20 * 60, "프로그램에이", 1.0)];
const m2 = measureChanges(withCont, detectPastChanges(withCont, "2026-04-01").filter((c) => c.kind === "replace"), { holidays: noHoliday, noise: null, targetKind: null })[0];
eq("편성상의 교체", m2.prevContinues, true);
// 변경 28일 뒤(03-16 이후)에만 방영되면 계속으로 세지 않는다
const lateCont = [...base, mk("2026-03-17", 20 * 60, "프로그램에이", 1.0)];
const m2b = measureChanges(lateCont, detectPastChanges(lateCont, "2026-04-01").filter((c) => c.kind === "replace"), { holidays: noHoliday, noise: null, targetKind: null })[0];
eq("28일 밖 방영은 계속으로 세지 않음", m2b.prevContinues, false);

// 공휴일 ±1일 방영은 4주 창에서 뺀다 — 02-24가 공휴일이면 02-23 방영(B 2회차)이 빠진다
const m3 = measureChanges(base, found, { holidays: new Set(["2026-02-24"]), noise: null, targetKind: null })[0];
eq("공휴일 ±1일 제외 후 방영 수", m3.w4?.afterN, 3);
eq("공휴일 제외해도 기존 change는 그대로", m3.change, m1.change);

// 잡음 표가 없으면 잡음 띠 판정을 하지 않고 ±10% 띠만(폴백)
eq("잡음 표 없음 → verdictNoise null", m2.verdictNoise, null);
eq("잡음 표 없음 → noiseStep null", m2.noiseStep, null);
eq("잡음 표 없음 → ±10% 띠는 있음", m2.verdictBand10, "up");

// 잡음 띠 경계: +15%는 ±10% 띠로는 '상승'이지만 잡음 띠(0.204)로는 '비슷'
const B2 = weekly("2026-02-16", 6, MON20, "프로그램비", 1.15);
const base2 = [...A, ...B2];
const m4 = measureChanges(base2, detectPastChanges(base2, "2026-04-01").filter((c) => c.kind === "replace"), { holidays: noHoliday, noise: noiseTable(0.5), targetKind: "household" })[0];
eq("+15%: ±10% 띠 상승", m4.verdictBand10, "up");
eq("+15%: 잡음 띠 비슷", m4.verdictNoise, "flat");
// 같은 변화라도 비교 방영이 많아질수록 띠가 좁아진다(√n)
const B3 = weekly("2026-02-16", 6, MON20, "프로그램비", 1.3);
const base3 = [...A, ...B3];
const m5 = measureChanges(base3, detectPastChanges(base3, "2026-04-01").filter((c) => c.kind === "replace"), { holidays: noHoliday, noise: noiseTable(0.5), targetKind: "household" })[0];
eq("+30%: 대칭 폭 0.26 > 0.204 → 상승", m5.verdictNoise, "up");
eq("하락 방향", measureChanges([...weekly("2026-01-05", 6, MON20, "프로그램에이", 1.5), ...weekly("2026-02-16", 6, MON20, "프로그램비", 1.0)], detectPastChanges([...weekly("2026-01-05", 6, MON20, "프로그램에이", 1.5), ...weekly("2026-02-16", 6, MON20, "프로그램비", 1.0)], "2026-04-01").filter((c) => c.kind === "replace"), { holidays: noHoliday, noise: noiseTable(0.5), targetKind: "household" })[0].verdictNoise, "down");

// ── 이동: 프로그램 P가 월 20시 → 화 21시, 새 자리·비운 자리 변화 ──
const P_old = weekly("2026-01-05", 4, MON20, "프로그램피", 1.0);
const P_new = weekly("2026-02-03", 5, TUE21, "프로그램피", 2.0);
const Q_toSlot = weekly("2026-01-06", 4, TUE21, "프로그램큐", 1.0); // 새 자리의 직전 프로그램
const R_fromSlot = weekly("2026-02-02", 4, MON20, "프로그램알", 0.5); // 비운 자리를 채운 프로그램
const mv = [...P_old, ...P_new, ...Q_toSlot, ...R_fromSlot];
const moves = detectPastChanges(mv, "2026-04-01").filter((c) => c.kind === "move");
eq("이동 1건 추출", moves.length, 1);
const mm = measureChanges(mv, moves, { holidays: noHoliday, noise: null, targetKind: null })[0];
near("이동 프로그램 기준 변화율", mm.change, 1.0);
near("새 자리 변화율(1.0 → 2.0)", mm.toSlotChange, 1.0);
near("비운 자리 변화율(1.0 → 0.5)", mm.fromSlotChange, -0.5);
eq("이동은 prevContinues 없음", mm.prevContinues, null);
eq("이동 시간대는 새 자리(21시) 기준", mm.daypart, "20-23");

// 방영 2개 미만이면 자리 기준 변화를 내지 않는다
const mvThin = [...P_old, ...P_new, ...weekly("2026-01-06", 1, TUE21, "프로그램큐", 1.0)];
const mt = measureChanges(mvThin, detectPastChanges(mvThin, "2026-04-01").filter((c) => c.kind === "move"), { holidays: noHoliday, noise: null, targetKind: null })[0];
eq("직전 방영 1건이면 새 자리 변화 null", mt.toSlotChange, null);

// 내역(detail)이 없는 변경은 건너뛴다
eq("detail 없는 변경은 측정 안 함", measureChanges(base, [{ kind: "replace", date: "2026-02-16", change: 0.5 }], { holidays: noHoliday, noise: null, targetKind: null }).length, 0);

// ── summarizeEffect: 20건 미만 숨김·편성상 교체만·띠 선택 ──
const fake = (kind: "move" | "replace", change: number, verdictNoise: MeasuredChange["verdictNoise"], prevContinues: boolean | null): MeasuredChange => ({
  kind, date: "2026-03-01", change,
  daypart: "20-23", w4: null, verdictBand10: change >= CHANGE_BAND ? "up" : change <= -CHANGE_BAND ? "down" : "flat",
  verdictNoise, noiseStep: verdictNoise === null ? null : 0.2, prevContinues, toSlotChange: null, fromSlotChange: null,
});
const few = Array.from({ length: MIN_EFFECT_CELL_N - 1 }, (_, i) => fake("replace", 0.2 + i * 0.01, "up", true));
const sFew = summarizeEffect(few);
eq("19건: n만", sFew.n, MIN_EFFECT_CELL_N - 1);
eq("19건: shown=false", sFew.shown, false);
eq("19건: 중앙값 숨김", sFew.medianChange, null);
const enough = Array.from({ length: MIN_EFFECT_CELL_N }, (_, i) => fake("replace", i % 2 === 0 ? 0.2 : -0.2, i % 4 === 0 ? "up" : i % 4 === 1 ? "down" : "flat", true));
const sEnough = summarizeEffect(enough);
eq("20건: shown", sEnough.shown, true);
eq("20건: 잡음 띠 기준", sEnough.basis, "noise");
eq("20건: 상승·비슷·하락", [sEnough.up, sEnough.flat, sEnough.down], [5, 10, 5]);
near("20건: 변화율 중앙값", sEnough.medianChange, 0);

const mixedEnded = [...enough, ...Array.from({ length: 10 }, () => fake("replace", -0.5, "down", false))];
eq("종료 후 교체는 기본으로 제외", summarizeEffect(mixedEnded).n, MIN_EFFECT_CELL_N);
eq("onlySwap=false면 포함", summarizeEffect(mixedEnded, { onlySwap: false }).n, MIN_EFFECT_CELL_N + 10);
eq("이동은 prevContinues와 무관하게 센다", summarizeEffect([fake("move", 0.3, "up", null)]).n, 1);

// 잡음 띠가 일부 행에 없으면 전체를 ±10% 띠로 센다(섞지 않는다)
const partial = [...enough.slice(0, 19), fake("replace", 0.2, null, true)];
eq("일부 행에 잡음 띠 없음 → ±10% 띠", summarizeEffect(partial).basis, "band10");

// ── 잡음 띠 → 전회 대비 % 범위 ──
eq("null 잡음 띠", noiseBandPct(null), null);
near("잡음 띠 0.5 하한 %", noiseBandPct(0.5)?.downPct, (-2 * 0.5 / 2.5) * 100, 1e-9);

console.log(`\n${pass}건 통과${fail ? `, ${fail}건 실패` : ""}`);
if (fail) process.exit(1);
