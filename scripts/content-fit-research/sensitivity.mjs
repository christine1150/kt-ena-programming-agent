// 민감도: 종합 비중·보정 비중·판정선을 흔들어도 결론이 유지되는지 본다(튜닝된 값이 아니라는 근거).
//   node scripts/content-fit-research/sensitivity.mjs
// [1] 점수 상수(규모 비중 λ, 몰입도 w, 추세 w): 한 번에 하나씩 바꿔 harness.evaluate 지표를 비교한다.
// [2] 판정선(강화/유지/관찰): 흔들어도 "강화 ≥ 유지 ≥ 관찰 ≥ 교체 검토"의 이후 편성 유지율 서열이 그대로인지 본다.
import { evaluate, buildSnapshot, loadAll, addDays, CHANNELS, EVAL_DATES } from "./harness.mjs";
import { CFG, computeFinal } from "./candidates/final.mjs";

const withCfg = (patch) => ({ ...CFG, ...patch, cut: { ...CFG.cut, ...(patch.cut ?? {}) } });
const cand = (name, C) => ({
  name,
  score(snap) {
    const m = new Map();
    for (const [k, v] of computeFinal(snap, C)) if (v.score != null) m.set(k, { score: v.score });
    return m;
  },
});

console.log("[1] 점수 상수 민감도 — 예측ρ(이후 28일 슬롯 보정 성과), 상하위차, 시점 안정성, 우세 역전율, 표본 편향");
const f = (v, d = 3) => (v == null ? "n/a" : v.toFixed(d));
const variants = [
  ["기준(λ0.5 몰입0.2 추세0.2)", {}],
  ...[0.3, 0.4, 0.6, 0.7].map((x) => [`규모 비중 λ=${x}`, { lambdaScale: x }]),
  ...[0, 0.3, 0.4].map((x) => [`몰입도 비중 ${x}`, { wEngagement: x }]),
  ...[0, 0.1, 0.3, 0.4].map((x) => [`추세 비중 ${x}`, { wTrend: x }]),
];
for (const [label, patch] of variants) {
  const r = evaluate(cand(label, withCfg(patch)));
  console.log(" ", label.padEnd(26), `예측ρ=${f(r.predictiveRho)} 상하위차=${f(r.spreadTopMinusBottom)} 안정성=${f(r.stability)} 우세역전=${f(r.dominanceViolationRate)} 표본편향=${f(r.sampleSizeBias)}`);
}

// ---- [2] 판정선 민감도 ----
const all = loadAll();
const snaps = [];
for (const code of CHANNELS) {
  for (const T of EVAL_DATES[code]) {
    const snap = buildSnapshot(code, T);
    const fwd = new Set();
    for (const a of all[code].airings) if (a.date >= addDays(T, 1) && a.date <= addDays(T, 28)) fwd.add(a.pid);
    snaps.push({ snap, fwd });
  }
}
function retentionByVerdict(C) {
  const rows = [];
  for (const { snap, fwd } of snaps) {
    const res = computeFinal(snap, C);
    for (const p of snap.programs.values()) {
      if (!p.airings.some((a) => a.date >= addDays(snap.T, -13))) continue;
      const r = res.get(p.id);
      if (!r || r.tier !== "A") continue; // 정식 판정 대상만
      rows.push({ tag: r.tag, retained: fwd.has(p.id) });
    }
  }
  const out = {};
  for (const t of ["STRENGTHEN", "KEEP", "WATCH", "MOVE", "REPLACE"]) {
    const b = rows.filter((x) => x.tag === t);
    out[t] = b.length ? { n: b.length, rate: b.filter((x) => x.retained).length / b.length } : null;
  }
  return out;
}
console.log("\n[2] 판정선 민감도 — 정식 판정 대상의 이후 28일 편성 유지율 (n)");
const cuts = [
  ["기준(1.5 / 0.85 / 0.55)", {}],
  ["강화선 1.3", { cut: { strengthen: 1.3 } }], ["강화선 1.7", { cut: { strengthen: 1.7 } }],
  ["유지선 0.80", { cut: { keepLow: 0.8 } }], ["유지선 0.90", { cut: { keepLow: 0.9 } }],
  ["관찰선 0.50", { cut: { watchLow: 0.5 } }], ["관찰선 0.60", { cut: { watchLow: 0.6 } }],
];
for (const [label, patch] of cuts) {
  const o = retentionByVerdict(withCfg(patch));
  const ordered = ["STRENGTHEN", "KEEP", "WATCH", "REPLACE"].map((t) => o[t]).filter(Boolean);
  const mono = ordered.every((x, i) => i === 0 || x.rate <= ordered[i - 1].rate + 1e-9);
  console.log(" ", label.padEnd(24), ["STRENGTHEN", "KEEP", "WATCH", "REPLACE"].map((t) => `${t} ${o[t] ? (o[t].rate * 100).toFixed(0) + "%(" + o[t].n + ")" : "-"}`).join("  "), mono ? "→ 서열 유지" : "→ 서열 깨짐");
}
{
  const o = Object.values(retentionByVerdict(CFG)).filter(Boolean);
  const n = o.reduce((a, x) => a + x.n, 0);
  console.log(`\n정식 판정 대상 전체(${n}건)의 이후 28일 편성 유지율: ${((o.reduce((a, x) => a + x.n * x.rate, 0) / n) * 100).toFixed(0)}%`);
}
