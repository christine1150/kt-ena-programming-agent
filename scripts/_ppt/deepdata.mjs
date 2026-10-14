// q1~q13 SQL 결과를 심층 덱이 쓰기 좋은 형태로 정규화한다.
// 모든 값은 실제 쿼리 결과에서만 온다. 이 파일에서 추정·보정하지 않는다.
import { readQ } from "./readq.mjs";

const Q = {};
for (const n of ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13", "q14"]) {
  Q[n] = readQ(n);
}

const A = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const pct = (a, b) => (b ? +(((a - b) / b) * 100).toFixed(1) : null);
export const mmss = (sec) => `${Math.floor(sec / 60)}분 ${String(Math.round(sec % 60)).padStart(2, "0")}초`;
const DOW = ["", "월", "화", "수", "목", "금", "토", "일"];
const platName = (s) => s.replace(" 가구","").replace("가구","").replace("SKY","위성");
const shortSeg = (s) => s.replace("유료방송 ", "").replace("이상", "+").replace("60대+", "60대+");

/* ---------- 1. 채널 총괄 ---------- */
const yrRows = A(Q.q1.year).map((r) => ({
  y: r.y, n: r.n, rating: num(r.rating), share: num(r.share), reach: num(r.reach), ats: num(r.ats),
}));
export const YEAR = Object.fromEntries(yrRows.map((r) => [r.y, r]));
export const MONTH33 = A(Q.q1.month).map((r) => ({
  ym: r.ym, rating: num(r.rating), share: num(r.share), reach: num(r.reach), ats: num(r.ats),
}));
export const MA_PEAK = (A(Q.q1.ma_peak)[0] || {});
export const MA_SERIES = A(Q.q1.ma_series).map((r) => ({ d: r.period_date, v: num(r.ma56) }));
export const DAILY_TOP = A(Q.q1.daily_top).map((r) => ({ d: r.period_date, rating: num(r.rating), reach: num(r.reach), ats: num(r.ats) }));
export const COVERAGE = (A(Q.q1.coverage)[0] || {});

export const GROWTH = {
  rating: pct(YEAR[2026].rating, YEAR[2024].rating),
  share: pct(YEAR[2026].share, YEAR[2024].share),
  reach: pct(YEAR[2026].reach, YEAR[2024].reach),
  ats: pct(YEAR[2026].ats, YEAR[2024].ats),
};

/* ---------- 2. 시장 순위 ---------- */
const olHH = A(Q.q4.olife).find((r) => r.tl === "유료방송가구");
const ol2049 = A(Q.q4.olife).find((r) => r.tl === "수도권2049");
const uni = A(Q.q4.universe).find((r) => r.tl === "유료방송가구");
export const MARKET = {
  rank: olHH.rank, rating: num(olHH.rating), share: num(olHH.share), ats: num(olHH.ats), atsr: num(olHH.atsr),
  total: uni.n, from: olHH.date_from, to: olHH.date_to,
  atsRank: (A(Q.q4.olife_ats_rank)[0] || {}).ats_rank,
  pctile: +((olHH.rank / uni.n) * 100).toFixed(1),
  rank2049: ol2049.rank, rating2049: num(ol2049.rating),
};
export const TOP20 = A(Q.q4.top20).map((r) => ({ cn: r.cn, rank: r.rank, rating: num(r.rating), ats: num(r.ats) }));
export const NEIGHBORS = A(Q.q4.neighbors).map((r) => ({ cn: r.cn, rank: r.rank, rating: num(r.rating), ats: num(r.ats) }));
export const ATS_TOP = A(Q.q4.ats_top15).map((r) => ({ cn: r.cn, rank: r.rank, rating: num(r.rating), ats: num(r.ats), atsRank: r.ats_rn }));
export const SCATTER40 = A(Q.q4.scatter40).map((r) => ({ cn: r.cn, rating: num(r.rating), ats: num(r.ats) }));

/* ---------- 3. 순위 추이 ---------- */
const NAT = "National 유료방송가입가구";
export const RANK_MONTHLY = A(Q.q5.monthly).filter((r) => r.tl === NAT)
  .map((r) => ({ m: r.df.slice(0, 7), rank: r.rank, rating: num(r.rating), ats: num(r.ats) }));
export const RANK_WEEKLY = A(Q.q5.weekly).filter((r) => r.tl === NAT)
  .map((r) => ({ w: r.df.slice(5), rank: r.rank, rating: num(r.rating) }));
export const RANK_MONTHLY_CAP = A(Q.q5.monthly).filter((r) => r.tl === "수도권 유료방송가입가구")
  .map((r) => ({ m: r.df.slice(0, 7), rank: r.rank, rating: num(r.rating) }));

/* ---------- 4. 성·연령 ---------- */
export const SEG_DELTA = A(Q.q2.seg_delta)
  .filter((r) => r.lb !== "유료방송가구")
  .map((r) => ({
    lb: shortSeg(r.lb), r24: num(r.r24), r26: num(r.r26), abs: num(r.abs_delta),
    pct: num(r.pct_delta), ats24: num(r.ats24), ats26: num(r.ats26), atsPct: num(r.ats_pct),
  }));
export const SEG_SERIES = (() => {
  const by = {};
  for (const r of A(Q.q2.seg_series)) {
    const k = shortSeg(r.lb);
    (by[k] = by[k] || []).push({ ym: r.ym, rating: num(r.rating), ats: num(r.ats) });
  }
  return by;
})();
export const SEG_MIX = (() => {
  const by = {};
  for (const r of A(Q.q2.seg_mix)) (by[shortSeg(r.lb)] = by[shortSeg(r.lb)] || {})[r.year] = num(r.mix_pct);
  return by;
})();
export const SENIOR_MIX = [2024, 2025, 2026].map((y) =>
  +((SEG_MIX["남 60대+"][y] || 0) + (SEG_MIX["여 60대+"][y] || 0)).toFixed(1));

/* ---------- 5. 플랫폼 / 평일·주말 ---------- */
const platBy = {};
for (const r of A(Q.q3.plat_year)) (platBy[r.lb] = platBy[r.lb] || {})[r.year] = { rating: num(r.rating), ats: num(r.ats), reach: num(r.reach) };
export const PLATFORM = Object.entries(platBy)
  .filter(([k]) => !/아날로그|^유료방송가구$/.test(k))
  .map(([lb, v]) => ({ lb: platName(lb), r24: v[2024].rating, r26: v[2026].rating, pct: pct(v[2026].rating, v[2024].rating), ats24: v[2024].ats, ats26: v[2026].ats }))
  .sort((a, b) => b.pct - a.pct);
export const PLATFORM_SERIES = (() => {
  const by = {};
  for (const r of A(Q.q3.plat_series)) {
    if (/아날로그|^유료방송가구$/.test(r.lb)) continue;
    const k = platName(r.lb);
    (by[k] = by[k] || []).push({ ym: r.ym, rating: num(r.rating) });
  }
  return by;
})();
const wkBy = {};
for (const r of A(Q.q3.wk_year)) (wkBy[r.lb] = wkBy[r.lb] || {})[r.year] = { rating: num(r.rating), ats: num(r.ats), reach: num(r.reach) };
export const WEEKEND = {
  rows: ["근무주", "주말"].map((lb) => ({ lb, ...Object.fromEntries([2024, 2025, 2026].map((y) => [y, wkBy[lb][y]])) })),
  premium: [2024, 2025, 2026].map((y) => +(wkBy["주말"][y].rating / wkBy["근무주"][y].rating).toFixed(3)),
};

/* ---------- 6. 시간대 ---------- */
const dpBy = {};
for (const r of A(Q.q6.daypart_year)) (dpBy[r.daypart] = dpBy[r.daypart] || {})[r.yr] = { slots: r.slots, rating: num(r.rating), ats: num(r.ats), reach: num(r.reach) };
const DP_ORDER = ["새벽 02-08", "오전 09-13", "오후 14-18", "저녁심야 19-25"];
const slotTot = (y) => DP_ORDER.reduce((s, d) => s + dpBy[d][y].slots, 0);
export const DAYPART = DP_ORDER.map((d) => ({
  d, r25: dpBy[d][2025].rating, r26: dpBy[d][2026].rating, pct: pct(dpBy[d][2026].rating, dpBy[d][2025].rating),
  ats25: dpBy[d][2025].ats, ats26: dpBy[d][2026].ats,
  w25: +((dpBy[d][2025].slots / slotTot(2025)) * 100).toFixed(1),
  w26: +((dpBy[d][2026].slots / slotTot(2026)) * 100).toFixed(1),
}));
const hrBy = {};
for (const r of A(Q.q6.hour_year)) (hrBy[r.hh] = hrBy[r.hh] || {})[r.yr] = { rating: num(r.rating), ats: num(r.ats), slots: r.slots };
export const HOURS = Object.keys(hrBy).map(Number).filter((h) => Number.isFinite(h)).sort((a, b) => a - b)
  .map((h) => ({ h, label: `${h % 24}시`, r25: hrBy[h][2025]?.rating ?? null, r26: hrBy[h][2026]?.rating ?? null }))
  .filter((r) => r.r25 !== null && r.r26 !== null);
const dowBy = {};
for (const r of A(Q.q6.dow_year)) (dowBy[r.dow] = dowBy[r.dow] || {})[r.yr] = { rating: num(r.rating), ats: num(r.ats) };
export const DOWS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
  d: DOW[d], r25: dowBy[d][2025].rating, r26: dowBy[d][2026].rating, pct: pct(dowBy[d][2026].rating, dowBy[d][2025].rating),
}));
function heatMatrix(all) {
  // start_time 이 없는 행은 시(hour)가 null 이 되므로 제외한다.
  const rows = all.filter((r) => Number.isFinite(r.hh) && Number.isFinite(r.dow));
  const hrs = [...new Set(rows.map((r) => r.hh))].sort((a, b) => a - b);
  const m = {};
  for (const r of rows) (m[r.dow] = m[r.dow] || {})[r.hh] = num(r.rating);
  return { hrs, m };
}
const h26 = heatMatrix(A(Q.q6.heat26)), h25 = heatMatrix(A(Q.q6.heat25));
export const HEAT26 = {
  categories: h26.hrs.map((h) => `${h % 24}시`),
  series: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ name: DOW[d], values: h26.hrs.map((h) => h26.m[d]?.[h] ?? null) })),
};
export const HEAT_DIFF = {
  categories: h26.hrs.map((h) => `${h % 24}시`),
  series: [1, 2, 3, 4, 5, 6, 7].map((d) => ({
    name: DOW[d],
    values: h26.hrs.map((h) => {
      const a = h26.m[d]?.[h], b = h25.m[d]?.[h];
      return a != null && b != null ? +(a - b).toFixed(5) : null;
    }),
  })),
};
export const TOP_SLOTS = A(Q.q6.top_slots).map((r) => ({ label: `${DOW[r.dow]} ${r.hh % 24}시`, rating: num(r.rating), n: r.n }));
export const DAWN57 = Object.fromEntries(A(Q.q6.dawn57).map((r) => [r.yr, { rating: num(r.rating), ats: num(r.ats), slots: r.slots }]));

/* ---------- 7. 프로그램 ---------- */
export const CHANNEL_YEAR = Object.fromEntries(A(Q.q7.channel_year).map((r) => [r.yr, { slots: r.slots, rating: num(r.ch_rating) }]));
export const PGM_TOP = A(Q.q7.top_rating).map((r) => ({ nm: r.nm, slots: r.slots, rating: num(r.rating), ats: num(r.ats) }));
export const PGM_MASS = A(Q.q7.top_mass).map((r) => ({ nm: r.nm, slots: r.slots, rating: num(r.rating), mass: num(r.contrib_mass) }));
export const DECOMP = A(Q.q7.decomp)
  .filter((r) => Math.abs(num(r.total_contrib)) >= 0.0001)
  .map((r) => ({
    nm: r.nm, s25: r.s25, s26: r.s26, r25: num(r.r25), r26: num(r.r26),
    w25: num(r.w25p), w26: num(r.w26p),
    total: num(r.total_contrib), mix: num(r.mix_effect), perf: num(r.perf_effect),
  }));
export const DECOMP_SUM = DECOMP.reduce((a, r) => ({ total: a.total + r.total, mix: a.mix + r.mix, perf: a.perf + r.perf }), { total: 0, mix: 0, perf: 0 });
export const UNDERUSED = A(Q.q7.underused).map((r) => ({ nm: r.nm, slots: r.slots, rating: num(r.rating) }));

/* ---------- 8. 편성 구조 ---------- */
export const CONC = A(Q.q8.monthly).map((r) => ({ ym: r.ym, uniq: r.uniq, slots: r.slots, top1: num(r.top1), top3: num(r.top3), top5: num(r.top5), top10: num(r.top10) }));
export const CONC_FULL = CONC.filter((r) => r.slots >= 400);
export const CONC_YEAR = Object.fromEntries(A(Q.q8.year_summary).map((r) => [r.yr, { uniq: r.uniq, slots: r.slots }]));
export const GONE = A(Q.q8.gone).map((r) => ({ nm: r.nm, n: r.c25 }));
export const NEWIN = A(Q.q8.new).map((r) => ({ nm: r.nm, n: r.c26 }));
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const CONC_AVG = {
  uniq25: +avg(CONC_FULL.filter((r) => r.ym.startsWith("25")).map((r) => r.uniq)).toFixed(1),
  uniq26: +avg(CONC_FULL.filter((r) => r.ym.startsWith("26")).map((r) => r.uniq)).toFixed(1),
  top5_25: +avg(CONC_FULL.filter((r) => r.ym.startsWith("25")).map((r) => r.top5)).toFixed(1),
  top5_26: +avg(CONC_FULL.filter((r) => r.ym.startsWith("26")).map((r) => r.top5)).toFixed(1),
  top3_25: +avg(CONC_FULL.filter((r) => r.ym.startsWith("25")).map((r) => r.top3)).toFixed(1),
  top3_26: +avg(CONC_FULL.filter((r) => r.ym.startsWith("26")).map((r) => r.top3)).toFixed(1),
};

/* ---------- 9. 반복 / 회차 ---------- */
export const REPEAT24 = { pct: num((A(Q.q9.repeat24_total)[0] || {}).pct), n: (A(Q.q9.repeat24_total)[0] || {}).n };
export const REPEAT_PGM = A(Q.q9.repeat24_by_pgm).map((r) => ({ nm: r.nm, pct: num(r.pct), n: r.n }));
export const EP_REUSE = A(Q.q9.ep_reuse).map((r) => ({ nm: r.nm, yr: r.yr, slots: r.slots, eps: r.eps, reuse: num(r.reuse) }));
export const EP_COVER = A(Q.q9.ep_coverage).map((r) => ({ yr: r.yr, slots: r.slots, withEp: r.with_ep, pct: num(r.pct) }));
export const CATALOG_COUNTRY = A(Q.q9.catalog_country).filter((r) => r.cty !== "미상").map((r) => ({ cty: r.cty, n: r.n }));
export const CATALOG_SERIES = A(Q.q9.catalog_series).map((r) => ({ sn: r.sn, n: r.n, cty: r.cty }));
export const FIRSTRUN = A(Q.q9.firstrun).map((r) => ({ yr: r.yr, fr: r.fr, slots: r.slots }));

/* ---------- 10. 흐름 ---------- */
export const FLOW_KIND = A(Q.q10.by_kind).map((r) => ({ kind: r.kind, n: r.n, avg: num(r.avg_ratio), med: num(r.med_ratio) }));
export const FLOW_KIND_YEAR = A(Q.q10.by_kind_year).map((r) => ({ kind: r.kind, yr: r.yr, n: r.n, med: num(r.med_ratio) }));
export const FLOW_DAYPART = A(Q.q10.by_daypart).map((r) => ({ d: r.daypart, n: r.n, med: num(r.med_ratio) }));
export const FLOW_BEST = A(Q.q10.best_pairs).map((r) => ({ from: r.cur_nm, to: r.next_nm, n: r.n, ratio: num(r.avg_ratio) }));
export const FLOW_WORST = A(Q.q10.worst_pairs).map((r) => ({ from: r.cur_nm, to: r.next_nm, n: r.n, ratio: num(r.avg_ratio) }));

/* ---------- 11. 최근 모멘텀 / 리스크 ---------- */
export const MONTH_R = A(Q.q11.month_all).map((r) => ({ ym: r.ym, slots: r.slots, rating: num(r.rating), reach: num(r.reach), ats: num(r.ats) }));
export const WEEK26 = A(Q.q11.week_2026).map((r) => ({ w: r.wk.slice(5), rating: num(r.rating) }));
export const DEPENDENCY = A(Q.q11.dependency).map((r) => ({ ym: r.m.slice(2, 7), slotPct: num(r.top1_slot_pct), massPct: num(r.top1_mass_pct) }));
export const TREND_PGM = A(Q.q11.trend_pgm).map((r) => ({ nm: r.nm, prior: num(r.r_prior), recent: num(r.r_recent), delta: num(r.delta), pct: num(r.pct), nPrior: r.n_prior, nRecent: r.n_recent }))
  .sort((a, b) => b.pct - a.pct);
export const DAILY_TOP_R = A(Q.q11.daily_top15).map((r) => ({ d: r.bd, rating: num(r.rating), slots: r.slots }));
export const APR_JUL = (() => {
  const by = {};
  for (const r of A(Q.q11.jul_vs_apr)) {
    const k = r.m.slice(0, 7);
    (by[k] = by[k] || []).push({ nm: r.nm, c: r.c, r: num(r.r) });
  }
  return by;
})();

/* ---------- 12. EPG ---------- */
export const EPG_RUNTYPE = A(Q.q12.epg_runtype).map((r) => ({ rt: r.rt, n: r.n, pct: num(r.pct) }));
export const EPG_PGM = A(Q.q12.epg_pgm).map((r) => ({ nm: r.nm, n: r.n, rerun: r.rerun, eps: r.eps }));
export const EPG_HOUR = A(Q.q12.epg_hour).map((r) => ({ h: r.hh, label: `${r.hh % 24}시`, n: r.n, bon: r.bon, jae: r.jae }));
export const EPG_DAILY = A(Q.q12.epg_daily).map((r) => ({ d: r.bd, slots: r.slots, uniq: r.uniq }));

/* ---------- 13. 동일 콘텐츠 경쟁 비교 ---------- */
export const ONT_SAME = A(Q.q13.same_program)
  .filter((r) => r.olife_n >= 5 && r.ont_n >= 5)
  .map((r) => ({ nm: r.nm, mine: num(r.olife_rating), theirs: num(r.ont_rating), mult: num(r.multiple), nMine: r.olife_n, nTheirs: r.ont_n }))
  .sort((a, b) => b.mult - a.mult);
export const ONT_HOUR = A(Q.q13.hour_vs).map((r) => ({ h: r.hh, label: `${r.hh % 24}시`, mine: num(r.olife), theirs: num(r.ont) }));
export const ONT_AVG = { mine: num((A(Q.q13.channel_avg)[0] || {}).olife_avg), theirs: num((A(Q.q13.ont_avg)[0] || {}).ont_avg), n: (A(Q.q13.ont_avg)[0] || {}).n };

/* ---------- 14. 시장 내 위치: 시청률 순위 vs 체류 순위 ---------- */
const mk = (r) => ({ cn: r.cn, rank: r.rank, rating: num(r.rating), ats: num(r.ats), atsRank: r.ats_rank });
export const MKT_TOP40 = A(Q.q14.top40).map(mk);
export const ATS_TOP12 = A(Q.q14.ats_top12).map(mk);
export const ATS_NEAR = A(Q.q14.ats_near).map(mk);
export const MKT_OLIFE = mk(A(Q.q14.olife)[0] || {});
export const MKT_N = (A(Q.q14.universe)[0] || {}).n_with_ats;

// 발표용 비교 채널 — 널리 알려진 채널 + OLIFE
const PEERS = ["KBS1", "KBS2", "MBC", "SBS", "YTN", "TV CHOSUN", "JTBC", "MBN", "OLIFE", "tvN", "ENA", "채널A"];
export const ATS_PEERS = PEERS
  .map((n) => MKT_TOP40.find((r) => r.cn === n))
  .filter(Boolean)
  .sort((a, b) => b.ats - a.ats);
