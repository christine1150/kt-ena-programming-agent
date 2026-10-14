// 콘텐츠 적합도 레퍼런스 구현(JS)의 공용 부품: 값 종류별(시청률/도달률/시청시간비율) 슬롯 기대치, 수축 지수, 추세, 시간대별 지수.
// 운영 엔진(src/lib/contentFit/engine.ts)과 같은 결과가 나와야 하며, parity.mts가 실데이터로 그 일치를 대조한다.
import { addDays } from "./harness.mjs";

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const log2 = (x) => Math.log(x) / Math.LN2;

/**
 * 계층형 슬롯 기대치. levels = [{ name, key:(a)=>string, min }]을 위에서부터 시도하고, 마지막은 항상 채널 전체다.
 * 기대치는 "프로그램 자신을 뺀(LOO) 같은 칸의 다른 프로그램 평균"이며, 칸에 다른 프로그램 방영이 min건 미만이면 한 단계 넓힌다.
 */
export function makeUniverseL(airings, valueKey, levels) {
  const maps = levels.map(() => new Map());
  const prog = new Map();
  let totS = 0, totN = 0;
  for (const a of airings) {
    const v = a[valueKey] ?? 0;
    levels.forEach((lv, i) => {
      const k = lv.key(a);
      let e = maps[i].get(k);
      if (!e) { e = { s: 0, n: 0, p: new Map() }; maps[i].set(k, e); }
      e.s += v; e.n++;
      const q = e.p.get(a.pid) ?? { s: 0, n: 0 };
      q.s += v; q.n++; e.p.set(a.pid, q);
    });
    totS += v; totN++;
    const q = prog.get(a.pid) ?? { s: 0, n: 0 };
    q.s += v; q.n++; prog.set(a.pid, q);
  }
  const loo = (e, pid) => {
    if (!e) return { mean: null, n: 0 };
    const q = e.p.get(pid) ?? { s: 0, n: 0 };
    const n = e.n - q.n;
    return n > 0 ? { mean: (e.s - q.s) / n, n } : { mean: null, n: 0 };
  };
  return {
    key: valueKey,
    channelMean: totN ? totS / totN : 0,
    expected(a, pid) {
      for (let i = 0; i < levels.length; i++) {
        const g = loo(maps[i].get(levels[i].key(a)), pid);
        if (g.mean != null && g.n >= levels[i].min) return { exp: g.mean, level: levels[i].name };
      }
      const q = prog.get(pid) ?? { s: 0, n: 0 };
      const n = totN - q.n;
      return n > 0 ? { exp: (totS - q.s) / n, level: "ch" } : { exp: null, level: "none" };
    },
  };
}
// 좁은 순: 같은 요일·시(slot) → 같은 요일·시간대(dowDp) → 시간대(dp). M은 칸 평균을 믿기 위한 '다른 프로그램' 방영 최소 건수.
export const LEVELS = {
  cur: (M) => [
    { name: "slot", key: (a) => `${a.dow}|${a.hb}`, min: M },
    { name: "dowDp", key: (a) => `${a.dow}|${a.dp}`, min: M },
    { name: "dp", key: (a) => a.dp, min: M },
  ],
};

// 프로그램의 실제/기대 합과 건수, 기대치 폴백 수준 분포
export function sums(p, U, filt = () => true) {
  let R = 0, E = 0, n = 0;
  const lv = { slot: 0, dowDp: 0, dp: 0, ch: 0 };
  for (const a of p.airings) {
    if (!filt(a)) continue;
    const x = U.expected(a, p.id);
    if (x.exp == null) continue;
    R += a[U.key] ?? 0; E += x.exp; n++; lv[x.level]++;
  }
  return { R, E, n, lv };
}

// 수축(사전 질량 m0) 지수: 사전분포 = 슬롯 평균(1.0). m0는 "채널 평균 시청률 × 가상 방영 건수 κ"
export function shrunkIndex({ R, E }, m0) { return (R + m0) / (E + m0); }

// 점수 사상: 슬롯 평균 = 50, 2배 = 75, 절반 = 25 (로그 척도, 0~100 절단)
export const toScore = (L) => clamp(50 + 25 * log2(Math.max(L, 1e-6)), 0, 100);

// 최근 4주 vs 이전 8주 지수(각각 수축). 양쪽에 방영 3일 이상이 있어야 계산한다.
export function trendOf(p, U, T, m0) {
  const cut = addDays(T, -27);
  const rec = sums(p, U, (a) => a.date >= cut), pri = sums(p, U, (a) => a.date < cut);
  const dRec = new Set(p.airings.filter((a) => a.date >= cut).map((a) => a.date)).size;
  const dPri = new Set(p.airings.filter((a) => a.date < cut).map((a) => a.date)).size;
  if (dRec < 3 || dPri < 3) return { ok: false, delta: 0, dRec, dPri };
  const lr = shrunkIndex(rec, m0), lp = shrunkIndex(pri, m0);
  return { ok: true, delta: log2(lr / lp), lRecent: lr, lPrior: lp, dRec, dPri };
}

// 시간대(데이파트)별 지수: 이동 vs 교체 구분용
export function byDaypart(p, U, m0, minAir = 3) {
  const out = {};
  for (const dp of ["새벽", "오전", "오후", "저녁_심야"]) {
    const s = sums(p, U, (a) => a.dp === dp);
    if (s.n >= minAir) out[dp] = { L: shrunkIndex(s, m0), n: s.n, Eper: s.E / s.n };
  }
  return out;
}
