// 실제 편성 유지(PD의 결정, 드러난 선호)와 점수·판정의 관계.
//   node scripts/content-fit-research/retention.mjs
// 과거 시점 T마다 "그날까지의 데이터만"으로 점수를 만들고, 이후 28일(T+1~T+28) 안에 그 프로그램이 한 번이라도 다시 방영됐는지로 대조한다.
// 대상은 T 직전 14일 안에 방영된 프로그램(= 그때 편성 중이던 프로그램)이다. 시즌 종영·계약 만료도 '유지 안 됨'으로 잡히므로
// 절대값보다 점수·판정 사이의 상대 비교(판별력, 판정별 유지율 서열)로 읽어야 한다.
import { buildSnapshot, loadAll, addDays, CHANNELS, EVAL_DATES, oldScores } from "./harness.mjs";
import { computeFinal } from "./candidates/final.mjs";

const all = loadAll();
const pct = (x) => (x * 100).toFixed(0) + "%";
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  let w = 0;
  for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

const rows = [];
for (const code of CHANNELS) {
  for (const T of EVAL_DATES[code]) {
    const snap = buildSnapshot(code, T);
    const res = computeFinal(snap);
    const old = oldScores(code, T);
    const fwd = new Set();
    for (const a of all[code].airings) if (a.date >= addDays(T, 1) && a.date <= addDays(T, 28)) fwd.add(a.pid);
    for (const p of snap.programs.values()) {
      if (!p.airings.some((a) => a.date >= addDays(T, -13))) continue; // 그때 편성 중이던 프로그램만
      const r = res.get(p.id);
      if (!r || r.score == null) continue; // 방영 3일 미만(판단 보류)은 점수가 없다
      const o = old?.get(p.id);
      rows.push({
        code, T, nDays: p.nDays, retained: fwd.has(p.id),
        tier: r.tier, verdict: r.tier === "A" ? r.tag : "TEST", score: r.score, L: r.parts.L,
        tbl: o?.table ?? null, fit: o?.fit ?? null, aff: o?.aff ?? null, perf: o?.perf ?? null, eng: o?.eng ?? null, oldTag: o ? o.tag : undefined,
      });
    }
  }
}

console.log(`점수가 있는(방영 3일 이상) 편성 중 프로그램-시점 ${rows.length}건, 이후 28일 편성 유지율 ${pct(rows.filter((r) => r.retained).length / rows.length)}`);

// 1) 점수별 '유지 vs 이탈' 판별력(AUC): 방영 8일 이상, 개편 전 점수도 있는 같은 표본
const cmp = rows.filter((r) => r.nDays >= 8 && r.tbl != null);
console.log(`\n[1] 같은 표본(방영 8일↑ · 개편 전 점수 있음) ${cmp.length}건, 유지율 ${pct(cmp.filter((r) => r.retained).length / cmp.length)} — 유지 판별 AUC(0.5=동전 던지기)`);
for (const [k, label] of [["tbl", "기존 화면 종합(3개 평균)"], ["fit", "기존 fit_score(6항 가중)"], ["perf", "기존 타깃 성과"], ["aff", "기존 타깃 선호도"], ["eng", "기존 시청 몰입도"], ["L", "신규 슬롯 대비 성과(L)만"], ["score", "신규 적합도"]]) {
  const sub = cmp.filter((r) => r[k] != null);
  const a = auc(sub.filter((r) => r.retained).map((r) => r[k]), sub.filter((r) => !r.retained).map((r) => r[k]));
  console.log(" ", label.padEnd(24), a == null ? "n/a" : a.toFixed(3));
}

// 2) 판정별 유지율 — 신규 판정 vs 개편 전 태그(개편 전 태그가 있는 행만)
function table(title, list, keyOf, order) {
  console.log(`\n${title} (표본 ${list.length}건)`);
  for (const k of order) {
    const b = list.filter((r) => keyOf(r) === k);
    if (b.length) console.log(" ", String(k).padEnd(11), "n=" + String(b.length).padStart(3), "비중", pct(b.length / list.length).padStart(4), " 이후 28일 유지율", pct(b.filter((r) => r.retained).length / b.length));
  }
}
table("[2-1] 신규 판정별", rows, (r) => r.verdict, ["STRENGTHEN", "KEEP", "WATCH", "MOVE", "REPLACE", "TEST"]);
const withOld = rows.filter((r) => r.oldTag !== undefined);
table("[2-2] 개편 전 태그별(같은 프로그램-시점 중 개편 전 점수가 저장돼 있던 행)", withOld, (r) => r.oldTag ?? "null", ["STRENGTHEN", "KEEP", "MOVE", "REPLACE", "TEST", "null"]);
table("[2-3] 신규 판정별(개편 전 점수가 있던 행만 — 위 2-2와 같은 표본)", withOld, (r) => r.verdict, ["STRENGTHEN", "KEEP", "WATCH", "MOVE", "REPLACE", "TEST"]);

// 3) 슬롯 대비 성과(L) 구간별 유지율 — 판정선(0.55 / 0.85 / 1.5)의 근거. 방영 8일 이상.
console.log("\n[3] 슬롯 대비 성과(L, 표본 수축 후) 구간별 이후 28일 편성 유지율 — 방영 8일 이상");
const full = rows.filter((r) => r.nDays >= 8);
for (const [lo, hi] of [[0, 0.4], [0.4, 0.55], [0.55, 0.7], [0.7, 0.9], [0.9, 1.1], [1.1, 1.5], [1.5, 99]]) {
  const b = full.filter((r) => r.L >= lo && r.L < hi);
  console.log(`  L ${lo}~${hi === 99 ? "" : hi}`.padEnd(14), "n=" + String(b.length).padStart(3), "유지율", b.length ? pct(b.filter((r) => r.retained).length / b.length) : "-");
}
