// 콘텐츠 적합도 v1 — 레퍼런스 구현(JS). 운영 TS 엔진(src/lib/contentFit/engine.ts)과 같은 결과가 나와야 한다(parity.mts로 대조).
// 설계 근거·상수의 이유는 docs/content-fit/CONTENT_FIT_LOGIC.md.
import { makeUniverseL, LEVELS, sums, shrunkIndex, toScore, trendOf, byDaypart, clamp } from "../lib_cf.mjs";

export const CFG = {
  windowDays: 84, kappa: 2, minOtherAirings: 15,
  lambdaScale: 0.5, wEngagement: 0.2, wTrend: 0.2, capUp: 10, capDown: 15,
  minDays: 3, fullDays: 8, minWeight: 0.5,
  cut: { strengthen: 1.5, keepLow: 0.85, watchLow: 0.55 }, // 슬롯 대비 지수 L 기준 판정선
  trendDown: -0.5, moveTargetL: 1.0, moveMinAirings: 3, moveSlotStrength: 1.2,
};

/** snap(harness.buildSnapshot) → Map(programId → { tier: "A"|"B"|"C", score, tag, moveTo, parts }). A=정식, B=참고, C=보류. */
export function computeFinal(snap, C = CFG) {
  const out = new Map();
  const Ur = makeUniverseL(snap.all, "rating", LEVELS.cur(C.minOtherAirings));
  const Uc = makeUniverseL(snap.all, "reach", LEVELS.cur(C.minOtherAirings));
  const Ut = makeUniverseL(snap.all, "tss", LEVELS.cur(C.minOtherAirings));
  const mu = Ur.channelMean;
  const m0 = C.kappa * mu;
  for (const p of snap.programs.values()) {
    const nDays = p.nDays;
    if (nDays < C.minDays) { out.set(p.id, { tier: "C", score: null, tag: null, parts: { n: nDays } }); continue; }
    const sr = sums(p, Ur);
    if (!sr.n || m0 + sr.E <= 0) { out.set(p.id, { tier: "C", score: null, tag: null, parts: { n: nDays } }); continue; }
    const w = sr.E / (sr.E + m0);
    const L = shrunkIndex(sr, m0); // 슬롯 대비 성과
    const A = (sr.R + m0) / (sr.n * mu + m0); // 시청 규모(채널 평균 방영 대비)
    const SL = toScore(L), SA = toScore(A);
    const sc = sums(p, Uc), st = sums(p, Ut);
    const Lc = shrunkIndex(sc, C.kappa * Uc.channelMean), Lt = shrunkIndex(st, C.kappa * Ut.channelMean);
    const Seng = toScore(Math.sqrt(Lc * Lt)); // 시청 몰입도
    const tr = trendOf(p, Ur, snap.T, m0);
    const Str = tr.ok ? 50 + 25 * clamp(tr.delta, -2, 2) : 50;
    const core = (1 - C.lambdaScale) * SL + C.lambdaScale * SA;
    const adj = clamp(C.wEngagement * (Seng - 50) + C.wTrend * (Str - 50), -C.capDown, C.capUp);
    const score = clamp(core + adj, 0, 100);
    const tierA = nDays >= C.fullDays && w >= C.minWeight;
    let tag = "TEST", moveTo = null;
    if (tierA) {
      if (L >= C.cut.strengthen) tag = tr.ok && tr.delta <= C.trendDown ? "KEEP" : "STRENGTHEN";
      else if (L >= C.cut.keepLow) tag = tr.ok && tr.delta <= C.trendDown ? "WATCH" : "KEEP";
      else if (L >= C.cut.watchLow) tag = "WATCH";
      else {
        tag = "REPLACE";
        // 더 좋은 시간대(기대 시청률이 현재의 1.2배 이상)에서 슬롯 평균 이상을 낸 적이 있으면 교체 대신 이동 검토
        const dps = byDaypart(p, Ur, m0, C.moveMinAirings);
        const cur = Object.entries(dps).sort((a, b) => b[1].n - a[1].n)[0];
        const alt = Object.entries(dps)
          .filter(([d, v]) => cur && d !== cur[0] && v.L >= C.moveTargetL && v.Eper >= cur[1].Eper * C.moveSlotStrength)
          .sort((a, b) => b[1].L - a[1].L)[0];
        if (alt) { tag = "MOVE"; moveTo = alt[0]; }
      }
    }
    out.set(p.id, {
      tier: tierA ? "A" : "B", score, tag, moveTo,
      parts: { L: +L.toFixed(3), A: +A.toFixed(3), Seng: +Seng.toFixed(1), trend: tr.ok ? +tr.delta.toFixed(2) : null, w: +w.toFixed(2), n: nDays, SL: +SL.toFixed(1), SA: +SA.toFixed(1) },
    });
  }
  return out;
}

/** harness.evaluate()용 후보 어댑터 */
export const candidate = {
  name: "신규 적합도(content-fit-v1)",
  score(snap) {
    const m = new Map();
    for (const [k, v] of computeFinal(snap)) if (v.score != null) m.set(k, { score: v.score, parts: v.parts, verdict: v.tag });
    return m;
  },
};
