// CONTENT FITS 재설계 연구용 하네스 (읽기 전용 덤프 JSON만 사용, DB 접근 없음)
// 사용: import { loadAll, buildSnapshot, evaluate, oldScores, EVAL_DATES } from "./harness.mjs"
// 데이터 위치: 환경변수 CF_DATA_DIR(기본 .cache/content-fit). dump.mjs가 만든다. 닐슨 원자료라 커밋하지 않는다(.cache/는 gitignore).
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.CF_DATA_DIR ?? ".cache/content-fit");
const J = (f) => {
  const p = path.join(DATA_DIR, f);
  if (!fs.existsSync(p)) throw new Error(`연구용 덤프가 없습니다: ${p}\n먼저 node --env-file=.env scripts/content-fit-research/dump.mjs 를 실행하세요.`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
};
export const CHANNELS = ["ENA_DRAMA", "ENA_PLAY", "ENA", "ENA_STORY", "OLIFE", "ONCE"]; // 앞 3개=수도권 2049 KPI, 뒤 3개=전국 유료가구 KPI
export const NATIONAL = new Set(["ENA_STORY", "OLIFE", "ONCE"]);

// ---------- 시간 유틸 ----------
export const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();
const hourBlock = (st) => { const h = +st.slice(0, 2); return h < 2 ? h + 24 : h; };
const daypart = (hb) => (hb >= 2 && hb <= 8 ? "새벽" : hb >= 9 && hb <= 13 ? "오전" : hb >= 14 && hb <= 18 ? "오후" : "저녁_심야");
const secs = (t) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + s; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---------- 로딩 ----------
let CACHE = null;
export function loadAll() {
  if (CACHE) return CACHE;
  const { targets } = J("channels.json");
  const kpiMetro = targets.find((t) => t.label === "수도권 2049").id;
  const kpiInfo = J("kpi_info.json");
  const demoLabel = Object.fromEntries(targets.map((t) => [t.id, t.label]));
  const out = {};
  for (const code of CHANNELS) {
    const rows = J(`ratings_${code}.json`);
    const programs = J(`programs_${code}.json`);
    const name = Object.fromEntries(programs.map((p) => [p.id, p.canonical_name]));
    const airings = []; // KPI(수도권 2049) 방영 단위
    const demo = new Map(); // key -> {라벨: rating}
    const kpiId = NATIONAL.has(code) ? kpiInfo[code].targetId : kpiMetro;
    for (const r of rows) {
      const key = `${r.program_id}|${r.broadcast_date}|${r.start_time}`;
      if (r.target_id === kpiId) {
        if (r.rating == null) continue;
        const hb = hourBlock(r.start_time);
        airings.push({
          key, pid: r.program_id, date: r.broadcast_date, dow: dow(r.broadcast_date), hb, dp: daypart(hb),
          rating: r.rating, reach: r.reach ?? 0, tss: r.time_spent_share ?? 0,
          dur: Math.max(60, (secs(r.end_time) - secs(r.start_time) + 86400) % 86400), rerun: r.is_first_run === false, ep: r.episode_number,
        });
      } else {
        const m = demo.get(key) ?? {}; m[demoLabel[r.target_id]] = r.rating; demo.set(key, m);
      }
    }
    for (const a of airings) a.demo = demo.get(a.key) ?? null;
    airings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    out[code] = { code, name, airings, markFit: J(`mart_fit_${code}.json`) };
  }
  CACHE = out;
  return out;
}

// ---------- 스냅샷(과거 시점 T 기준, 미래 데이터 미사용) ----------
export function makeUniverse(airings) {
  // 칸(요일×시) / 요일×데이파트 / 데이파트 / 채널 전체 합계를 미리 만들어 프로그램 제외(LOO) 평균을 O(1)에 계산
  const cell = new Map(), dpd = new Map(), dpa = new Map(); let totS = 0, totN = 0;
  const add = (m, k, pid, r) => { let e = m.get(k); if (!e) { e = { s: 0, n: 0, p: new Map() }; m.set(k, e); } e.s += r; e.n++; const q = e.p.get(pid) ?? { s: 0, n: 0 }; q.s += r; q.n++; e.p.set(pid, q); };
  for (const a of airings) { add(cell, `${a.dow}|${a.hb}`, a.pid, a.rating); add(dpd, `${a.dow}|${a.dp}`, a.pid, a.rating); add(dpa, a.dp, a.pid, a.rating); totS += a.rating; totN++; }
  const prog = new Map(); for (const a of airings) { const q = prog.get(a.pid) ?? { s: 0, n: 0 }; q.s += a.rating; q.n++; prog.set(a.pid, q); }
  const loo = (e, pid) => { if (!e) return { mean: null, n: 0 }; const q = e.p.get(pid) ?? { s: 0, n: 0 }; const n = e.n - q.n; return n > 0 ? { mean: (e.s - q.s) / n, n } : { mean: null, n: 0 }; };
  const MIN = 6; // 칸 평균을 믿기 위한 '다른 프로그램' 방영 최소 건수
  return {
    slotMean: (dw, hb, pid) => loo(cell.get(`${dw}|${hb}`), pid),
    dpDowMean: (dw, dp, pid) => loo(dpd.get(`${dw}|${dp}`), pid),
    dpMean: (dp, pid) => loo(dpa.get(dp), pid),
    chMean: (pid) => { const q = prog.get(pid) ?? { s: 0, n: 0 }; const n = totN - q.n; return n > 0 ? { mean: (totS - q.s) / n, n } : { mean: null, n: 0 }; },
    // 기대 시청률(프로그램 자신 제외, 계층 폴백): 칸 → 요일×데이파트 → 데이파트 → 채널 전체
    expected(a, pid) {
      for (const [lv, g] of [["slot", this.slotMean(a.dow, a.hb, pid)], ["dowDp", this.dpDowMean(a.dow, a.dp, pid)], ["dp", this.dpMean(a.dp, pid)], ["ch", this.chMean(pid)]]) {
        if (g.mean != null && g.n >= (lv === "ch" ? 1 : MIN)) return { exp: g.mean, level: lv, n: g.n };
      }
      return { exp: null, level: "none", n: 0 };
    },
  };
}

const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
export function buildSnapshot(code, T, windowDays = 84, subsample = null) {
  const ch = loadAll()[code];
  const from = addDays(T, -(windowDays - 1));
  let win = ch.airings.filter((a) => a.date >= from && a.date <= T);
  if (subsample) win = win.filter((a) => fnv(a.key + "#" + subsample.seed) < subsample.keep); // 방영 건의 일부만 남겨 점수가 표본 변동에 얼마나 흔들리는지 본다
  const byProg = new Map();
  for (const a of win) { let p = byProg.get(a.pid); if (!p) { p = { id: a.pid, name: ch.name[a.pid], airings: [], days: new Set() }; byProg.set(a.pid, p); } p.airings.push(a); p.days.add(a.date); }
  for (const p of byProg.values()) p.nDays = p.days.size;
  const U = makeUniverse(win);
  // 프로그램 방영 전체에 대한 슬롯 보정 지수: Σ실제 ÷ Σ기대(프로그램 제외 기대)
  const lift = (p, filt = () => true) => {
    let s = 0, e = 0, n = 0;
    for (const a of p.airings) { if (!filt(a)) continue; const x = U.expected(a, p.id); if (x.exp == null) continue; s += a.rating; e += x.exp; n++; }
    return n && e > 0 ? { index: s / e, n, actual: s / n, expected: e / n } : { index: null, n: 0, actual: null, expected: null };
  };
  return { code, T, from, windowDays, programs: byProg, all: win, U, lift, channel: ch };
}

// ---------- 이후 28일 실적(평가용 정답) ----------
export function forwardOutcome(code, T, horizon = 28) {
  const ch = loadAll()[code];
  const f0 = addDays(T, 1), f1 = addDays(T, horizon);
  const fw = ch.airings.filter((a) => a.date >= f0 && a.date <= f1);
  if (!fw.length) return null;
  const U = makeUniverse(fw);
  const byP = new Map();
  for (const a of fw) { let p = byP.get(a.pid); if (!p) { p = { airings: [], days: new Set() }; byP.set(a.pid, p); } p.airings.push(a); p.days.add(a.date); }
  const res = new Map();
  for (const [pid, p] of byP) {
    let s = 0, e = 0, n = 0, sch = 0;
    const chAvg = U.chMean(pid).mean;
    for (const a of p.airings) { const x = U.expected(a, pid); if (x.exp == null) continue; s += a.rating; e += x.exp; n++; if (chAvg != null) sch += chAvg; }
    res.set(pid, { nDays: p.days.size, nAir: p.airings.length, lift: n && e > 0 ? s / e : null, actual: mean(p.airings.map((a) => a.rating)), vsChannel: n && sch > 0 ? s / sch : null });
  }
  return res;
}

// ---------- 기존 점수(마트에 저장된 값) ----------
export function oldScores(code, T) {
  const ch = loadAll()[code];
  const rows = ch.markFit.filter((r) => r.as_of_date === T);
  if (!rows.length) return null;
  const m = new Map();
  for (const r of rows) {
    const v = [r.target_performance_score, r.target_affinity_score, r.audience_engagement_score].filter((x) => x != null);
    m.set(r.program_id, { table: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, fit: r.fit_score, perf: r.target_performance_score, aff: r.target_affinity_score, eng: r.audience_engagement_score, tag: r.tag, conf: r.confidence_pct });
  }
  return m;
}

// ---------- 통계 ----------
export function spearman(xs, ys) {
  const n = xs.length; if (n < 4) return null;
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let i = 0; i < n;) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const rk = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = rk; i = j + 1; } return r; };
  const rx = rank(xs), ry = rank(ys); const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

// 평가 시점: 마트(기존 점수)가 있는 날짜 중 4월~9월 사이 14일 간격
export function evalDates(code) {
  const ch = loadAll()[code];
  if (NATIONAL.has(code)) { const out = []; for (let d = "2026-04-22"; d <= "2026-09-08"; d = addDays(d, 14)) out.push(d); return out; }
  const ds = [...new Set(ch.markFit.map((r) => r.as_of_date))].sort().filter((d) => d >= "2026-04-01" && d <= "2026-09-14");
  const out = []; let last = null;
  for (const d of ds) { if (!last || (new Date(d) - new Date(last)) / 86400000 >= 14) { out.push(d); last = d; } }
  return out;
}
export const EVAL_DATES = Object.fromEntries(CHANNELS.map((c) => [c, evalDates(c)]));

/**
 * evaluate(candidate): candidate = { name, score(snap) -> Map(pid -> { score:number|null, ... }) }
 * 모든 채널·시점에서 (1) 이후 4주 실적과의 순위상관 (2) 점수 안정성 (3) 우세 쌍 역전율 (4) 표본 편향 (5) 상위/하위 3분위 차이
 */
export function evaluate(candidate, { minDays = 3, verbose = false } = {}) {
  const per = [];
  const prevScores = new Map();
  const cases = [];
  for (const code of CHANNELS) {
    for (const T of EVAL_DATES[code]) {
      const snap = buildSnapshot(code, T);
      const fw = forwardOutcome(code, T);
      if (!fw) continue;
      const sc = candidate.score(snap);
      const elig = [...snap.programs.values()].filter((p) => p.nDays >= minDays);
      // 1) 예측 타당도: 이후 4주에 3일 이상 방영된 프로그램의 슬롯 보정 지수와 순위상관
      const rows = elig.map((p) => ({ p, s: sc.get(p.id)?.score ?? null, f: fw.get(p.id) })).filter((x) => x.s != null && x.f && x.f.nDays >= 3 && x.f.lift != null);
      const rho = spearman(rows.map((x) => x.s), rows.map((x) => x.f.lift));
      const rhoCh = spearman(rows.map((x) => x.s), rows.map((x) => x.f.vsChannel ?? 0));
      // 상위/하위 3분위의 이후 4주 지수 평균 차이
      let spread = null;
      if (rows.length >= 9) { const o = [...rows].sort((a, b) => b.s - a.s); const k = Math.floor(o.length / 3); spread = mean(o.slice(0, k).map((x) => x.f.lift)) - mean(o.slice(-k).map((x) => x.f.lift)); }
      // 2) 안정성: 같은 채널 직전 평가시점과의 순위상관(공통 프로그램)
      const prev = prevScores.get(code);
      let stab = null;
      if (prev) { const common = elig.filter((p) => sc.get(p.id)?.score != null && prev.has(p.id)); stab = spearman(common.map((p) => sc.get(p.id).score), common.map((p) => prev.get(p.id))); }
      prevScores.set(code, new Map(elig.filter((p) => sc.get(p.id)?.score != null).map((p) => [p.id, sc.get(p.id).score])));
      // 3) 우세 쌍 역전: A가 B보다 시청률 1.5배 이상 + 슬롯 보정 지수 이상 + 도달률 이상 + 표본 이상인데 점수가 5점 넘게 낮은 쌍
      const feats = elig.map((p) => { const L = snap.lift(p); return { p, s: sc.get(p.id)?.score ?? null, lift: L.index, rate: mean(p.airings.map((a) => a.rating)), reach: mean(p.airings.map((a) => a.reach)), n: p.nDays }; }).filter((x) => x.s != null && x.lift != null);
      let dom = 0, viol = 0; const vlist = [];
      for (const A of feats) for (const B of feats) {
        if (A === B) continue;
        if (A.rate >= 1.5 * B.rate && B.rate > 0 && A.lift >= B.lift && A.reach >= B.reach && A.n >= B.n) { dom++; if (A.s < B.s - 5) { viol++; if (vlist.length < 3) vlist.push(`${A.p.name}(${A.s.toFixed(0)}) < ${B.p.name}(${B.s.toFixed(0)})`); } }
      }
      // 4) 표본 편향: 점수 순위와 표본 일수의 상관(절댓값이 클수록 '많이 틀기만 해도' 점수가 오름)
      // 6) 부분표본 강건성: 방영 건의 70%만 써도 같은 순서가 나오는가
      let robust = null;
      { const sub = buildSnapshot(code, T, 84, { seed: 7, keep: 0.7 }); const sc2 = candidate.score(sub); const common = elig.filter((p) => sc.get(p.id)?.score != null && sc2.get(p.id)?.score != null); robust = spearman(common.map((p) => sc.get(p.id).score), common.map((p) => sc2.get(p.id).score)); }
      const nBias = spearman(feats.map((x) => x.s), feats.map((x) => x.n));
      // 5) 표본 적은 프로그램(3~6일)이 상위 20%에 들어간 비율
      const top = [...feats].sort((a, b) => b.s - a.s).slice(0, Math.max(1, Math.round(feats.length * 0.2)));
      const lowN = top.filter((x) => x.n <= 6).length / top.length;
      per.push({ code, T, nElig: elig.length, nEval: rows.length, rho, rhoCh, spread, stab, dom, viol, nBias, lowNTop: lowN, robust, vlist });
      if (verbose) cases.push({ code, T, vlist });
    }
  }
  const avg = (k) => mean(per.map((x) => x[k]).filter((v) => v != null && Number.isFinite(v)));
  const sumD = per.reduce((a, x) => a + x.dom, 0), sumV = per.reduce((a, x) => a + x.viol, 0);
  return {
    name: candidate.name, snapshots: per.length,
    predictiveRho: avg("rho"), predictiveRhoVsChannel: avg("rhoCh"), spreadTopMinusBottom: avg("spread"),
    stability: avg("stab"), dominanceViolationRate: sumD ? sumV / sumD : null, dominancePairs: sumD,
    sampleSizeBias: avg("nBias"), lowSampleInTop20pct: avg("lowNTop"), subsampleRobustness: avg("robust"),
    perSnapshot: verbose ? per : undefined,
  };
}

export function fmt(r) {
  const f = (v, d = 3) => (v == null ? "n/a" : v.toFixed(d));
  return `${r.name.padEnd(28)} 예측ρ=${f(r.predictiveRho)} (채널대비 ${f(r.predictiveRhoVsChannel)}) 상하위차=${f(r.spreadTopMinusBottom)} 안정성=${f(r.stability)} 우세역전=${f(r.dominanceViolationRate)}(${r.dominancePairs}쌍) 표본편향=${f(r.sampleSizeBias)} 상위20%중소표본=${f(r.lowSampleInTop20pct)} 부분표본강건성=${f(r.subsampleRobustness)}`;
}
