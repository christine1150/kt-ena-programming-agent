// 외부 검증(ChatGPT 교차 확인, 2026-10-15) 대응: ① 시점 분할 검증 ② 작품 단위 부트스트랩 신뢰구간.
//   node scripts/content-fit-research/validate-holdout.mjs
// 읽기 전용(.cache/content-fit 덤프만 사용). 운영 코드와 무관하다.
//
// ① 시점 분할: 앞쪽 시점으로 κ·칸 최소 표본 M을 다시 고르고(calibrate.mjs와 같은 방식), 고른 값과 운영값(κ=2, M=15)을
//    "고르는 데 쓰지 않은" 뒤쪽 시점에서 평가한다. 반대 방향(뒤쪽으로 고르고 앞쪽에서 평가)도 본다.
//    판정선(0.55/0.85/1.5)은 전체 표본을 보고 정한 값이라 분할로 독립 검증이 안 된다 — 각 구간에서 판정별 유지율 서열이 같은지만 본다.
// ② 부트스트랩: 같은 작품이 여러 시점에 반복해 들어가므로 작품(채널+프로그램) 단위로 재표집해 AUC 차이의 95% 구간을 구한다.
import { buildSnapshot, forwardOutcome, loadAll, addDays, CHANNELS, EVAL_DATES, oldScores } from "./harness.mjs";
import { makeUniverseL, LEVELS, sums, shrunkIndex } from "./lib_cf.mjs";
import { computeFinal, CFG } from "./candidates/final.mjs";

const CUT = process.env.CF_SPLIT ?? "2026-07-15"; // 이 날짜 이하 = 앞쪽, 초과 = 뒤쪽
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(0) + "%");
const f3 = (x) => (x == null ? "n/a" : x.toFixed(3));
const all = loadAll();

// ---- 시점 목록과 스냅샷 캐시 ----
const points = [];
for (const code of CHANNELS) for (const T of EVAL_DATES[code]) points.push({ code, T, half: T <= CUT ? "early" : "late" });
const snapCache = new Map();
const snapOf = (code, T) => { const k = code + T; if (!snapCache.has(k)) snapCache.set(k, buildSnapshot(code, T)); return snapCache.get(k); };
const fwdCache = new Map();
const fwdOf = (code, T) => { const k = code + T; if (!fwdCache.has(k)) fwdCache.set(k, forwardOutcome(code, T)); return fwdCache.get(k); };

// ---- 순위 기반 AUC(동점은 평균 순위) ----
function aucOf(scores, labels) {
  const n = scores.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const rank = new Array(n);
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && scores[idx[j + 1]] === scores[idx[i]]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) rank[idx[k]] = r; i = j + 1; }
  let nPos = 0, sumPos = 0;
  for (let i = 0; i < n; i++) if (labels[i]) { nPos++; sumPos += rank[i]; }
  const nNeg = n - nPos;
  return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : null;
}

// ================= ① 시점 분할 =================
const KAPPAS = [0, 1, 2, 3, 4, 6], MS = [6, 10, 15, 20, 30];
function mseGrid(list) {
  const acc = {};
  for (const M of MS) for (const k of KAPPAS) acc[`${k}|${M}`] = { se: 0, n: 0 };
  for (const { code, T } of list) {
    const snap = snapOf(code, T), fw = fwdOf(code, T);
    if (!fw) continue;
    for (const M of MS) {
      const U = makeUniverseL(snap.all, "rating", LEVELS.cur(M));
      for (const p of snap.programs.values()) {
        if (p.nDays < 3) continue;
        const f = fw.get(p.id);
        if (!f || f.nDays < 3 || f.lift == null) continue;
        const s = sums(p, U);
        if (!s.n) continue;
        const target = clip(f.lift, 0, 4);
        for (const k of KAPPAS) {
          const L = k === 0 ? (s.E > 0 ? s.R / s.E : 1) : shrunkIndex(s, k * U.channelMean);
          const e = clip(L, 0, 4) - target;
          const a = acc[`${k}|${M}`]; a.se += e * e; a.n++;
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { mse: v.n ? v.se / v.n : null, n: v.n }]));
}

function retentionRows(list, cfg) {
  const rows = [];
  for (const { code, T } of list) {
    const snap = snapOf(code, T);
    const res = computeFinal(snap, cfg);
    const old = oldScores(code, T);
    const fwd = new Set();
    for (const a of all[code].airings) if (a.date >= addDays(T, 1) && a.date <= addDays(T, 28)) fwd.add(a.pid);
    for (const p of snap.programs.values()) {
      if (!p.airings.some((a) => a.date >= addDays(T, -13))) continue;
      const r = res.get(p.id);
      if (!r || r.score == null) continue;
      const o = old?.get(p.id);
      rows.push({ cluster: code + "|" + p.id, code, T, nDays: p.nDays, retained: fwd.has(p.id), verdict: r.tier === "A" ? r.tag : "TEST", score: r.score, L: r.parts.L, eng: o?.eng ?? null, tbl: o?.table ?? null });
    }
  }
  return rows;
}
const aucRows = (rows, key) => { const sub = rows.filter((r) => r[key] != null); return aucOf(sub.map((r) => r[key]), sub.map((r) => r.retained)); };

console.log(`분할 기준일 ${CUT}: 앞쪽 시점 ${points.filter((p) => p.half === "early").length}개 / 뒤쪽 ${points.filter((p) => p.half === "late").length}개 (채널×시점)\n`);

for (const [trainHalf, testHalf] of [["early", "late"], ["late", "early"]]) {
  const train = points.filter((p) => p.half === trainHalf), test = points.filter((p) => p.half === testHalf);
  console.log(`━━ ${trainHalf === "early" ? "앞쪽" : "뒤쪽"}으로 상수를 고르고 ${testHalf === "early" ? "앞쪽" : "뒤쪽"}에서 평가 ━━`);
  const gTrain = mseGrid(train), gTest = mseGrid(test);
  const best = Object.entries(gTrain).sort((a, b) => a[1].mse - b[1].mse)[0];
  const [bk, bM] = best[0].split("|").map(Number);
  const prodKey = `${CFG.kappa}|${CFG.minOtherAirings}`;
  console.log(`고르는 구간의 최적 (κ=${bk}, M=${bM}) MSE ${f3(best[1].mse)} n=${best[1].n}; 운영값(κ=${CFG.kappa}, M=${CFG.minOtherAirings}) MSE ${f3(gTrain[prodKey].mse)}`);
  console.log(`평가 구간 MSE — 고른 값 ${f3(gTest[best[0]].mse)} / 운영값 ${f3(gTest[prodKey].mse)} / 보정 없음(κ=0, M=15) ${f3(gTest[`0|${CFG.minOtherAirings}`].mse)} (n=${gTest[prodKey].n})`);
  // 평가 구간 격자 전체에서 운영값 순위
  const rankList = Object.entries(gTest).sort((a, b) => a[1].mse - b[1].mse).map(([k]) => k);
  console.log(`평가 구간 격자 ${rankList.length}칸 중 운영값 순위 ${rankList.indexOf(prodKey) + 1}위, 고른 값 순위 ${rankList.indexOf(best[0]) + 1}위`);

  const cfgChosen = { ...CFG, kappa: bk, minOtherAirings: bM };
  const rowsProd = retentionRows(test, CFG), rowsChosen = retentionRows(test, cfgChosen);
  const full = (rs) => rs.filter((r) => r.nDays >= 8);
  const fp = full(rowsProd), fc = full(rowsChosen);
  console.log(`평가 구간 편성 유지 AUC(방영 8일↑ n=${fp.length}, 유지율 ${pct(fp.filter((r) => r.retained).length / fp.length)}): 운영 상수 적합도 ${f3(aucRows(fp, "score"))} / 고른 상수 ${f3(aucRows(fc, "score"))} / L만 ${f3(aucRows(fp, "L"))}`);
  const cmp = fp.filter((r) => r.eng != null);
  console.log(`  개편 전 점수가 있는 표본 n=${cmp.length}: 적합도 ${f3(aucRows(cmp, "score"))} / 기존 몰입도 ${f3(aucRows(cmp, "eng"))} / 기존 종합 ${f3(aucRows(cmp, "tbl"))}`);
  // 판정별 유지율 서열
  const line = [];
  for (const v of ["STRENGTHEN", "KEEP", "WATCH", "MOVE", "REPLACE", "TEST"]) { const b = rowsProd.filter((r) => r.verdict === v); if (b.length) line.push(`${v} ${pct(b.filter((r) => r.retained).length / b.length)}(n=${b.length})`); }
  console.log(`  평가 구간 판정별 유지율(운영 상수): ${line.join(" · ")}\n`);
}

// ================= ② 부트스트랩 =================
console.log("━━ 작품 단위 부트스트랩(전체 시점, 방영 8일↑) ━━");
const rowsAll = retentionRows(points, CFG).filter((r) => r.nDays >= 8);
const clusters = new Map();
rowsAll.forEach((r, i) => { if (!clusters.has(r.cluster)) clusters.set(r.cluster, []); clusters.get(r.cluster).push(i); });
const clusterIds = [...clusters.keys()];
console.log(`행 ${rowsAll.length}건, 작품(채널+프로그램) ${clusterIds.length}개, 작품당 평균 ${(rowsAll.length / clusterIds.length).toFixed(1)}행`);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(20261015);
const REPS = Number(process.env.CF_BOOT ?? 2000);
function bootDiff(keyA, keyB, filter = () => true) {
  const base = rowsAll.filter(filter).filter((r) => r[keyA] != null && r[keyB] != null);
  const byC = new Map();
  base.forEach((r) => { if (!byC.has(r.cluster)) byC.set(r.cluster, []); byC.get(r.cluster).push(r); });
  const ids = [...byC.keys()];
  const point = aucOf(base.map((r) => r[keyA]), base.map((r) => r.retained)) - aucOf(base.map((r) => r[keyB]), base.map((r) => r.retained));
  const diffs = [];
  for (let b = 0; b < REPS; b++) {
    const sample = [];
    for (let i = 0; i < ids.length; i++) sample.push(...byC.get(ids[Math.floor(rand() * ids.length)]));
    const aA = aucOf(sample.map((r) => r[keyA]), sample.map((r) => r.retained)), aB = aucOf(sample.map((r) => r[keyB]), sample.map((r) => r.retained));
    if (aA != null && aB != null) diffs.push(aA - aB);
  }
  diffs.sort((x, y) => x - y);
  const q = (p) => diffs[Math.min(diffs.length - 1, Math.max(0, Math.floor(p * diffs.length)))];
  return { n: base.length, clusters: ids.length, aucA: aucOf(base.map((r) => r[keyA]), base.map((r) => r.retained)), aucB: aucOf(base.map((r) => r[keyB]), base.map((r) => r.retained)), diff: point, lo: q(0.025), hi: q(0.975), pBelow0: diffs.filter((d) => d <= 0).length / diffs.length };
}
const show = (label, r) => console.log(`${label.padEnd(28)} n=${String(r.n).padStart(4)} 작품 ${String(r.clusters).padStart(3)}개  AUC ${f3(r.aucA)} vs ${f3(r.aucB)}  차이 ${r.diff >= 0 ? "+" : ""}${f3(r.diff)}  95% 구간 [${f3(r.lo)}, ${f3(r.hi)}]  (차이≤0 비율 ${pct(r.pBelow0)})`);
show("적합도 − 기존 몰입도", bootDiff("score", "eng"));
show("적합도 − 기존 종합", bootDiff("score", "tbl"));
show("적합도 − L(슬롯 대비만)", bootDiff("score", "L"));
show("적합도 − L (기존점수 있는 행)", bootDiff("score", "L", (r) => r.eng != null));
