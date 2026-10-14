// 개편 전 CONTENT FITS 점수의 결함을 숫자로 재검증한다(읽기 전용 덤프 사용, DB 접근 없음).
//   node scripts/content-fit-research/diagnose-legacy.mjs            (기준일 2026-10-13)
//   node scripts/content-fit-research/diagnose-legacy.mjs 2026-09-30 (다른 기준일)
// 섹션: 1) 타깃 선호도 정의 재현 2) 비율 지표의 소분모 잡음 3) 구성요소 상관 4) 우세 쌍 역전 5) 결측 중립(50) 채움
//       6) percentile 정보 손실 7) 선호도가 실제로 재는 것(연령대 비중) 8) 선호도 vs 이후 실적 9) 사례 연령 구성
import { loadAll, buildSnapshot, oldScores, spearman, addDays, forwardOutcome, EVAL_DATES } from "./harness.mjs";

const T = process.argv[2] ?? "2026-10-13";
const all = loadAll();
const METRO = ["ENA_DRAMA", "ENA_PLAY", "ENA"];
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const rng = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const DEMO4 = ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"];
const uniq = (as) => new Set(as.map((a) => a.date)).size;
const groupBy = (arr) => { const by = new Map(); for (const a of arr) (by.get(a.pid) ?? by.set(a.pid, []).get(a.pid)).push(a); return by; };

console.log(`기준일 ${T}\n`);
console.log("=== 1) 타깃 선호도 재현 (SQL 정의: 4개 연령대(여20·남20·여40·남40) 풀링 평균 ÷ 2049 평균) ===");
for (const code of METRO) {
  const ch = all[code];
  const win = ch.airings.filter((a) => a.date >= addDays(T, -83) && a.date <= T);
  const martBy = new Map(ch.markFit.filter((r) => r.as_of_date === T).map((r) => [r.program_id, r]));
  let maxErr = 0, n = 0;
  for (const [pid, as] of groupBy(win)) {
    const kpi = mean(as.map((a) => a.rating));
    const dv = []; for (const a of as) if (a.demo) for (const k of DEMO4) if (a.demo[k] != null) dv.push(a.demo[k]);
    // 마트에 같은 프로그램의 저장값(affinity_composition_ratio)이 있으면 재현 오차를 잰다
    const ratio = kpi > 0 && dv.length ? mean(dv) / kpi : null;
    const m = martBy.get(pid);
    if (m && ratio != null && m.evidence?.affinity_composition_ratio != null) { maxErr = Math.max(maxErr, Math.abs(ratio - m.evidence.affinity_composition_ratio)); n++; }
  }
  console.log(code, "재현 프로그램 수", n, "최대 오차", maxErr.toExponential(2));
}

console.log("\n=== 2) 비율 지표의 소분모 잡음: 방영 건을 복원추출(200회)해 비율의 변동계수 — 2049 시청률 3분위별 ===");
for (const code of METRO) {
  const ch = all[code];
  const win = ch.airings.filter((a) => a.date >= addDays(T, -83) && a.date <= T && a.demo);
  const prog = [];
  for (const as of groupBy(win).values()) {
    if (uniq(as) < 3) continue;
    const ratioOf = (arr) => { const kpi = mean(arr.map((a) => a.rating)); if (!(kpi > 0)) return null; const dv = []; for (const a of arr) for (const k of DEMO4) if (a.demo[k] != null) dv.push(a.demo[k]); return dv.length ? mean(dv) / kpi : null; };
    const base = ratioOf(as); if (base == null) continue;
    const r = rng(12345); const bs = [];
    for (let b = 0; b < 200; b++) { const res = []; for (let i = 0; i < as.length; i++) res.push(as[Math.floor(r() * as.length)]); const v = ratioOf(res); if (v != null) bs.push(v); }
    prog.push({ kpi: mean(as.map((a) => a.rating)), cv: bs.length > 20 ? sd(bs) / mean(bs) : null });
  }
  prog.sort((a, b) => a.kpi - b.kpi);
  const k = Math.floor(prog.length / 3);
  const tier = (xs) => `n=${xs.length} 평균시청률=${mean(xs.map((x) => x.kpi)).toFixed(4)} 비율 변동계수(부트스트랩)=${mean(xs.filter((x) => x.cv != null).map((x) => x.cv)).toFixed(2)}`;
  console.log(code, "\n  하위1/3:", tier(prog.slice(0, k)), "\n  중간1/3:", tier(prog.slice(k, 2 * k)), "\n  상위1/3:", tier(prog.slice(2 * k)));
}

console.log("\n=== 3) 점수 구성요소 vs 시청률·표본·슬롯 (수도권 3개 채널 합산, 방영일 3일 이상) ===");
const pool = [];
for (const code of METRO) {
  const snap = buildSnapshot(code, T); const old = oldScores(code, T);
  const ch = all[code]; const martBy = new Map(ch.markFit.filter((r) => r.as_of_date === T).map((r) => [r.program_id, r]));
  for (const p of snap.programs.values()) {
    if (p.nDays < 3) continue; const o = old?.get(p.id); if (!o) continue; const L = snap.lift(p); if (L.index == null) continue;
    const m = martBy.get(p.id);
    pool.push({ code, name: p.name, n: p.nDays, rate: mean(p.airings.map((a) => a.rating)), lift: L.index, reach: mean(p.airings.map((a) => a.reach)), tbl: o.table, perf: o.perf, aff: o.aff, eng: o.eng, fit: o.fit, slotP: m?.evidence?.same_slot_pctl, dpP: m?.evidence?.same_daypart_pctl, rP: m?.evidence?.program_rating_pctl });
  }
}
const col = (k) => pool.map((x) => x[k]);
const rho = (a, b) => spearman(col(a), col(b)).toFixed(2);
console.log("표본 프로그램 수", pool.length);
console.log("aff  vs 시청률:", rho("aff", "rate"), "| vs 방영일수:", rho("aff", "n"), "| vs 슬롯보정지수:", rho("aff", "lift"));
console.log("perf vs 시청률:", rho("perf", "rate"), "| vs 슬롯보정지수:", rho("perf", "lift"), "| vs 슬롯품질(same_slot_pctl):", rho("perf", "slotP"), "| vs 데이파트품질:", rho("perf", "dpP"));
console.log("eng  vs 시청률:", rho("eng", "rate"), "| vs 슬롯보정지수:", rho("eng", "lift"));
console.log("화면 종합 vs 시청률:", rho("tbl", "rate"), "| vs 슬롯보정지수:", rho("tbl", "lift"), "| vs 방영일수:", rho("tbl", "n"));

console.log("\n=== 4) 역전 사례: A가 B보다 시청률 3배↑·슬롯보정지수↑·도달률↑·방영일수↑ 인데 화면 종합이 낮은 쌍(같은 채널) ===");
const inv = [];
for (const A of pool) for (const B of pool) {
  if (A === B || A.code !== B.code) continue;
  if (B.rate > 0 && A.rate >= 3 * B.rate && A.lift >= B.lift && A.reach >= B.reach && A.n >= B.n && A.tbl < B.tbl) inv.push({ code: A.code, hi: `${A.name}(종합 ${A.tbl.toFixed(0)}, 시청률 ${A.rate.toFixed(4)}, ${A.n}일)`, lo: `${B.name}(종합 ${B.tbl.toFixed(0)}, 시청률 ${B.rate.toFixed(4)}, ${B.n}일)`, gap: B.tbl - A.tbl });
}
inv.sort((a, b) => b.gap - a.gap);
console.log("역전 쌍", inv.length, `(표본 ${pool.length}개 프로그램)`); for (const x of inv.slice(0, 12)) console.log(` ${x.code} | ${x.hi}  <  ${x.lo}  (격차 ${x.gap.toFixed(0)}점)`);

console.log("\n=== 5) 결측/0 처리: 선호도가 50(중립 채움)인 프로그램 ===");
for (const code of METRO) {
  const ch = all[code]; const mart = ch.markFit.filter((r) => r.as_of_date === T);
  const live = mart.filter((r) => ch.airings.some((a) => a.pid === r.program_id && a.date >= addDays(T, -13)));
  const n50 = live.filter((r) => r.target_affinity_score === 50); const zero = live.filter((r) => (r.evidence?.avg_rating ?? 0) === 0);
  console.log(code, "현재 편성(14일 내 방영)", live.length, "| 선호도=50 정확히", n50.length, "| 평균 시청률 0", zero.length, "| 그중 선호도=50", zero.filter((r) => r.target_affinity_score === 50).length);
}

console.log("\n=== 6) percentile의 정보 손실: ENA Drama 시청률 상위 15개 — 실제 시청률 vs program_rating_pctl ===");
for (const r of pool.filter((x) => x.code === "ENA_DRAMA").sort((a, b) => b.rate - a.rate).slice(0, 15)) console.log(` ${r.name.slice(0, 16).padEnd(16)} 시청률 ${r.rate.toFixed(4)}  rating_pctl ${r.rP}`);

console.log("\n=== 7) 선호도(20·40대 4개 ÷ 2049)가 실제로 무엇을 재는가: 연령대 비중 분해(시청률>0.002, 방영 5일 이상) ===");
{
  const rows = [];
  for (const code of METRO) {
    const ch = all[code];
    const win = ch.airings.filter((a) => a.date >= addDays(T, -83) && a.date <= T && a.demo);
    for (const [pid, as] of groupBy(win)) {
      if (uniq(as) < 5) continue;
      const kpi = mean(as.map((a) => a.rating)); if (!(kpi > 0.002)) continue;
      const avg = (k) => mean(as.map((a) => a.demo[k] ?? 0));
      const c = { f20: avg("수도권 여20대"), m20: avg("수도권 남20대"), f30: avg("수도권 여30대"), m30: avg("수도권 남30대"), f40: avg("수도권 여40대"), m40: avg("수도권 남40대") };
      const tot = Object.values(c).reduce((a, b) => a + b, 0); if (!(tot > 0)) continue;
      rows.push({ name: ch.name[pid], kpi, r4: (c.f20 + c.m20 + c.f40 + c.m40) / 4 / kpi, r30: (c.f30 + c.m30) / 2 / kpi, sh20: (c.f20 + c.m20) / tot, sh30: (c.f30 + c.m30) / tot, sh40: (c.f40 + c.m40) / tot, shF: (c.f20 + c.f30 + c.f40) / tot });
    }
  }
  const c2 = (k) => rows.map((r) => r[k]); const r2 = (a, b) => spearman(c2(a), c2(b)).toFixed(2);
  console.log("프로그램", rows.length);
  console.log("선호도비율(r4) vs 30대 비율(r30):", r2("r4", "r30"), "| r4 vs 30대 비중:", r2("sh30", "r4"), "| r4 vs 20대 비중:", r2("sh20", "r4"), "| r4 vs 40대 비중:", r2("sh40", "r4"), "| r4 vs 여성 비중:", r2("shF", "r4"), "| r4 vs 시청률:", r2("kpi", "r4"));
  const hi = [...rows].sort((a, b) => b.r4 - a.r4).slice(0, 5), lo = [...rows].sort((a, b) => a.r4 - b.r4).slice(0, 5);
  const f = (r) => `${r.name.slice(0, 10)}(r4 ${r.r4.toFixed(2)}, 20대${(r.sh20 * 100).toFixed(0)}/30대${(r.sh30 * 100).toFixed(0)}/40대${(r.sh40 * 100).toFixed(0)}%)`;
  console.log("r4 상위:", hi.map(f).join(" ; "));
  console.log("r4 하위:", lo.map(f).join(" ; "));
}

console.log("\n=== 8) 마트에 저장돼 있던 기준일별 점수 vs 이후 28일 슬롯보정 지수의 순위상관(수도권 3채널, 방영 3일↑) ===");
console.log("(선호도는 2026-09-02 정의 변경 전 기준일에 상수라 계산할 수 없다 → n/a. 아래 8-b가 정의대로 매 시점 다시 계산한 값이다)");
const f2 = (v) => (v == null ? "n/a" : v.toFixed(2));
for (const code of METRO) {
  const out = [];
  for (const Tt of EVAL_DATES[code]) {
    const fw = forwardOutcome(code, Tt); if (!fw) continue;
    const m = all[code].markFit.filter((r) => r.as_of_date === Tt && r.sample_days >= 3 && fw.get(r.program_id)?.nDays >= 3 && fw.get(r.program_id)?.lift != null);
    if (m.length < 8) continue;
    const f = m.map((r) => fw.get(r.program_id).lift);
    out.push(`${Tt.slice(5)}: 선호도 ${f2(spearman(m.map((r) => r.target_affinity_score), f))} / 성과 ${f2(spearman(m.map((r) => r.target_performance_score), f))} / 몰입 ${f2(spearman(m.map((r) => r.audience_engagement_score), f))} (n=${m.length})`);
  }
  console.log(code, "\n  " + out.join("\n  "));
}

console.log("\n=== 8-b) 선호도를 매 시점 SQL 정의대로 다시 계산해 이후 실적·편성 유지와 대조 (수도권 3채널 전 평가 시점) ===");
{
  const auc = (pos, neg) => { if (!pos.length || !neg.length) return null; let w = 0; for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0; return w / (pos.length * neg.length); };
  const rhos = [], pooled = [];
  for (const code of METRO) {
    const ch = all[code];
    for (const Tt of EVAL_DATES[code]) {
      const snap = buildSnapshot(code, Tt); const fw = forwardOutcome(code, Tt); if (!fw) continue;
      const fwdSet = new Set(ch.airings.filter((a) => a.date >= addDays(Tt, 1) && a.date <= addDays(Tt, 28)).map((a) => a.pid));
      const rows = [];
      for (const p of snap.programs.values()) {
        if (p.nDays < 3) continue;
        const kpi = mean(p.airings.map((a) => a.rating));
        const dv = []; for (const a of p.airings) if (a.demo) for (const k of DEMO4) if (a.demo[k] != null) dv.push(a.demo[k]);
        if (!(kpi > 0) || !dv.length) continue; // 시청률 0이면 SQL이 50(중립)으로 채우는 경우 — 비율 자체를 검증하려고 제외
        rows.push({ pid: p.id, ratio: mean(dv) / kpi, nDays: p.nDays, live: p.airings.some((a) => a.date >= addDays(Tt, -13)), fw: fw.get(p.id), retained: fwdSet.has(p.id) });
        }
      const ev = rows.filter((r) => r.fw && r.fw.nDays >= 3 && r.fw.lift != null);
      if (ev.length >= 8) { const r = spearman(ev.map((x) => x.ratio), ev.map((x) => x.fw.lift)); if (r != null) rhos.push({ code, Tt, r, n: ev.length }); }
      for (const r of rows) if (r.nDays >= 8 && r.live) pooled.push(r);
    }
  }
  const byCode = (c) => rhos.filter((x) => x.code === c).map((x) => x.r);
  console.log(`이후 28일 슬롯보정 지수와의 순위상관: 시점 ${rhos.length}개 평균 ${mean(rhos.map((x) => x.r)).toFixed(2)} (양수 ${rhos.filter((x) => x.r > 0).length}개 / 음수 ${rhos.filter((x) => x.r < 0).length}개)`);
  for (const c of METRO) console.log(`  ${c}: 시점 ${byCode(c).length}개 평균 ${mean(byCode(c)).toFixed(2)}`);
  const a = auc(pooled.filter((r) => r.retained).map((r) => r.ratio), pooled.filter((r) => !r.retained).map((r) => r.ratio));
  console.log(`이후 28일 편성 유지 판별 AUC(방영 8일 이상·편성 중 ${pooled.length}건, 유지율 ${(pooled.filter((r) => r.retained).length / pooled.length * 100).toFixed(0)}%): ${a?.toFixed(3)}  (0.5 = 동전 던지기)`);
}
console.log("\n(참고) 전국 유료가구 KPI 채널의 마트 선호도는 가구 KPI용 정의라 이 덤프로 다시 계산하지 않는다. 마트 저장값 기준 최근 기준일 상관은 evaluate의 기존 target_affinity만 행 참고.");
console.log("\n전국 유료가구 KPI 채널의 마트 선호도 분포(가장 최근 기준일):");
for (const code of ["ENA_STORY", "OLIFE", "ONCE"]) {
  const ch = all[code]; const d = [...new Set(ch.markFit.map((r) => r.as_of_date))].sort().at(-1);
  const m = ch.markFit.filter((r) => r.as_of_date === d);
  const vals = m.map((r) => r.target_affinity_score).filter((v) => v != null);
  console.log(code, d, "행", m.length, "| 선호도=50", m.filter((r) => r.target_affinity_score === 50).length, "| null", m.length - vals.length, "| 서로 다른 값 수", new Set(vals).size);
}

console.log("\n=== 9) 사용자 제기 사례의 연령 구성(ENA Drama, 최근 12주) ===");
{
  const ch = all.ENA_DRAMA;
  for (const nm of ["벌거벗은세계사", "ENA케이팝업차트쇼", "착한여자부세미", "라이딩인생", "신병4사보타주", "나혼자산다"]) {
    const pid = Object.keys(ch.name).find((k) => ch.name[k] === nm);
    const as = ch.airings.filter((a) => a.pid === pid && a.date >= addDays(T, -83) && a.date <= T && a.demo);
    if (!as.length) { console.log(nm, "연령 자료 없음"); continue; }
    const avg = (k) => mean(as.map((a) => a.demo[k] ?? 0)); const kpi = mean(as.map((a) => a.rating));
    const c = { 여20: avg("수도권 여20대"), 남20: avg("수도권 남20대"), 여30: avg("수도권 여30대"), 남30: avg("수도권 남30대"), 여40: avg("수도권 여40대"), 남40: avg("수도권 남40대") };
    const tot = Object.values(c).reduce((a, b) => a + b, 0);
    console.log(nm.padEnd(16), "2049시청률", kpi.toFixed(4), "| 연령별", Object.entries(c).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(" "), "| 30대 비중", (((c.여30 + c.남30) / tot) * 100).toFixed(0) + "%", "| 20/40대4개÷2049 =", ((c.여20 + c.남20 + c.여40 + c.남40) / 4 / kpi).toFixed(2));
  }
}
