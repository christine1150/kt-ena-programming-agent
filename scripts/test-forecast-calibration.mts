// 편성표 예측 보정(calib-v1) 순수 함수 점검 — npx tsx scripts/test-forecast-calibration.mts
import { applyCalibration, factorFor, learnCalibration, validateCalibration, type CalibrationObs } from "../src/lib/scheduleForecast/calibration";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", name);
  }
};
const obs = (week: string, ch: string, grade: string, e: number, a: number, n: number): CalibrationObs[] => Array.from({ length: n }, () => ({ weekStart: week, channelCode: ch, grade, expected: e, actual: a, minutes: 60 }));

// 1) 늘 20% 높게 나오는 채널 — 배율은 1보다 작고, 표본이 적어 0.8까지 다 가지 않는다
const one = learnCalibration(obs("2026-10-26", "ONCE", "B", 0.12, 0.1, 30));
const f1 = one.channels.ONCE.factor;
ok(f1 < 1 && f1 > 0.8333, `한 주 수축 ${f1}`);
// 2) 주가 늘면 관측 비율 쪽으로 더 다가간다
const two = learnCalibration([...obs("2026-10-26", "ONCE", "B", 0.12, 0.1, 30), ...obs("2026-11-02", "ONCE", "B", 0.12, 0.1, 30)]);
ok(two.channels.ONCE.factor < f1, `두 주면 더 강하게 ${two.channels.ONCE.factor}`);
// 3) 등급 배율은 채널 배율 쪽으로 당겨지고, 표본 없는 등급은 채널 배율
const mix = learnCalibration([...obs("2026-10-26", "ENA", "A", 0.1, 0.1, 40), ...obs("2026-10-26", "ENA", "C", 0.3, 0.1, 4)]);
const fc = factorFor(mix, "ENA", "C");
ok(fc < mix.channels.ENA.factor && fc > 1 / 3, `C 등급 수축 ${fc}`);
ok(factorFor(mix, "ENA", "B") === mix.channels.ENA.factor, "없는 등급은 채널 배율");
ok(factorFor(mix, "OLIFE", "A") === 1 && factorFor(null, "ENA", "A") === 1, "모르는 채널·보정 없음은 1");
// 4) 범위 제한
const wild = learnCalibration(Array.from({ length: 6 }, (_, i) => obs(`2026-0${i + 1}-01`, "X", "C", 1, 0.01, 500)).flat());
ok(wild.channels.X.factor >= 0.5, "하한 0.5");
// 5) 적용 — 예상·범위 함께 곱하고 null 유지
const s = applyCalibration([{ expected: 0.1, low: 0.05, high: null, grade: "B" }], two, "ONCE")[0];
ok(Math.abs(s.expected! - 0.1 * factorFor(two, "ONCE", "B")) < 1e-9 && s.high === null && s.low! < 0.05, "적용");
// 6) 검증 — 한 주뿐이면 판단 보류, 같은 방향 편향이 이어지면 개선, 방향이 바뀌면 개선 아님
ok(validateCalibration(obs("2026-10-26", "ONCE", "B", 0.12, 0.1, 30)).status === "INSUFFICIENT", "한 주는 보류");
ok(validateCalibration([...obs("2026-10-26", "ONCE", "B", 0.12, 0.1, 30), ...obs("2026-11-02", "ONCE", "B", 0.12, 0.1, 30)]).status === "IMPROVES", "이어지는 편향은 개선");
ok(validateCalibration([...obs("2026-10-26", "ONCE", "B", 0.12, 0.1, 30), ...obs("2026-11-02", "ONCE", "B", 0.1, 0.12, 30)]).status === "NO_GAIN", "뒤집힌 편향은 개선 아님");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
