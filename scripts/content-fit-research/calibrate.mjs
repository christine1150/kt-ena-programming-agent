// 상수 보정: κ(표본 보정 강도)와 슬롯 기대치 구조(칸 최소 표본 M, 대안 구조)를 "이후 28일 실제 슬롯 대비 지수를 가장 잘 맞추는 값"으로 정한다.
//   node scripts/content-fit-research/calibrate.mjs
// 지표는 평균제곱오차(MSE, 작을수록 좋다): 과거 시점 T의 보정 지수(0~4로 절단)와 이후 28일 실제 지수(같은 절단)의 차이.
// κ=0은 보정 없는 원지수(Σ실제 ÷ Σ기대)다. 대상은 방영 3일 이상이고 이후 28일에 3일 이상 방영된 프로그램이다.
import { buildSnapshot, forwardOutcome, EVAL_DATES, CHANNELS } from "./harness.mjs";
import { makeUniverseL, LEVELS, sums, shrunkIndex } from "./lib_cf.mjs";

const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const isWeekend = (dow) => dow === 0 || dow === 6;
// 탐색했던 대안 구조(운영에는 쓰지 않음): 평일/주말×시, 세분 칸+평일/주말 폴백, 시각만
const ALT = {
  "평일/주말×시": (M) => [{ name: "wkSlot", key: (a) => `${isWeekend(a.dow) ? "E" : "D"}|${a.hb}`, min: M }, { name: "wkDp", key: (a) => `${isWeekend(a.dow) ? "E" : "D"}|${a.dp}`, min: M }, { name: "dp", key: (a) => a.dp, min: M }],
  "요일×시+평일/주말×시": (M) => [{ name: "slot", key: (a) => `${a.dow}|${a.hb}`, min: M }, { name: "wkSlot", key: (a) => `${isWeekend(a.dow) ? "E" : "D"}|${a.hb}`, min: M }, { name: "dowDp", key: (a) => `${a.dow}|${a.dp}`, min: M }, { name: "dp", key: (a) => a.dp, min: M }],
  "시각만": (M) => [{ name: "hb", key: (a) => `${a.hb}`, min: M }, { name: "dp", key: (a) => a.dp, min: M }],
};

const kappas = [0, 1, 2, 3, 4, 6];
function run(label, mkLevels) {
  const acc = Object.fromEntries(kappas.map((k) => [k, { se: 0, n: 0 }]));
  for (const code of CHANNELS) {
    for (const T of EVAL_DATES[code]) {
      const snap = buildSnapshot(code, T);
      const fw = forwardOutcome(code, T);
      if (!fw) continue;
      const U = makeUniverseL(snap.all, "rating", mkLevels());
      for (const p of snap.programs.values()) {
        if (p.nDays < 3) continue;
        const f = fw.get(p.id);
        if (!f || f.nDays < 3 || f.lift == null) continue;
        const s = sums(p, U);
        if (!s.n) continue;
        const target = clip(f.lift, 0, 4);
        for (const k of kappas) {
          const L = k === 0 ? (s.E > 0 ? s.R / s.E : 1) : shrunkIndex(s, k * U.channelMean);
          const e = clip(L, 0, 4) - target;
          acc[k].se += e * e; acc[k].n++;
        }
      }
    }
  }
  const mse = (k) => acc[k].se / acc[k].n;
  const best = kappas.map((k) => [k, mse(k)]).sort((a, b) => a[1] - b[1])[0];
  console.log(label.padEnd(26), kappas.map((k) => `κ${k}:${mse(k).toFixed(4)}`).join(" "), `→ 최적 κ=${best[0]} (MSE ${best[1].toFixed(4)}, n=${acc[best[0]].n})`);
}

console.log("[1] 요일×시 → 요일×시간대 → 시간대 구조에서 칸 최소 표본 M(다른 프로그램 방영 건수)별");
for (const M of [6, 10, 15, 20, 30, 50]) run(`현행 구조 M=${M}`, () => LEVELS.cur(M));
console.log("\n[2] 대안 구조(각 M)");
for (const [name, mk] of Object.entries(ALT)) for (const M of [10, 20, 30]) run(`${name} M=${M}`, () => mk(M));
