// 주간 순위 하락 배경(2026-10-26, 사용자 요청: ONCE 주간 순위가 56위→94위로 떨어진 원인을 분석해 주간 보고 [이번 주 인사이트]와 ONCE 일일 보고서에 반영).
// 새 판정·합격선 없이 DB 원본 행(닐슨 기간 순위, 프로그램 방영, 등록 경쟁채널 일별 시청률)만으로 "무엇이 빠지고 무엇이 들어왔는가"를 문장으로 옮긴다.
// 계산은 순수 함수(rankSlideOf), DB 읽기는 load.ts. 문구는 서버 고정(LLM 없음) — 원인을 단정하지 않고 확인된 사실과 확인하지 못한 범위를 구분해 쓴다.
import { dedupeAirings, type WorkAiring } from "@/lib/programPerformance/metrics";
import { josaEunNeun, josaIga } from "@/lib/josa";
import { formatRatingValue } from "@/lib/ui/metricFormat";

export interface RankWeek {
  /** 닐슨 주간 기간의 시작일(월요일) */
  weekStart: string;
  rank: number | null;
  rating: number | null;
}

export interface SlideAiring {
  programId: string;
  name: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  rating: number | null;
  createdAt: string | null;
}

export interface CompetitorDay {
  name: string;
  date: string;
  rating: number | null;
}

export interface RankSlide {
  channelCode: string;
  channelName: string;
  /** 비교 기준 주(기간 안 최고 순위 주)와 이번 주의 시작일 */
  fromWeek: string;
  toWeek: string;
  fromRank: number;
  toRank: number;
  /** 내려간 계단 수(양수) */
  drop: number;
  /** 기준 주 대비 이번 주 시청률 변화(%) */
  ratingPct: number | null;
  /** 화면에 그대로 나열하는 문장(최대 6줄) */
  lines: string[];
}

/** 순위가 이만큼 이상 내려가고 시청률이 이만큼 이상 줄었을 때만 만든다(작은 흔들림은 쓰지 않는다) */
export const SLIDE_MIN_DROP = 15;
export const SLIDE_MIN_RATING_DROP_PCT = 20;
/** 방영 시간 기준으로 자료가 이 이상(초) 모여야 그 주의 프로그램 분석을 쓴다 — 40시간 */
const MIN_COVERED_SEC = 40 * 3600;
/** 이탈·신규로 부르는 편성 비중(시간 기준) */
const BIG_SHARE = 0.05;
const GONE_SHARE = 0.01;
/** 가장 약한 신규 프로그램으로 지목하는 최소 편성 비중 */
const HEAVY_SHARE = 0.1;

const DAY_SEC = 86_400;

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 날짜가 속한 주의 월요일(닐슨 주간 기간과 같은 월~일) */
export function mondayOf(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  return addDays(d, -((t.getUTCDay() + 6) % 7));
}

const secOf = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

/** 방영 길이(초). 시작·종료가 없으면 null, 자정을 넘기면 하루를 더한다 */
function durationOf(a: { startTime: string | null; endTime: string | null }): number | null {
  if (!a.startTime || !a.endTime) return null;
  let d = secOf(a.endTime) - secOf(a.startTime);
  if (d <= 0) d += DAY_SEC;
  return d;
}

const label = (weekStart: string) => {
  const [, m, d] = weekStart.split("-").map(Number);
  return `${m}/${d}주`;
};
const fmtPct = (p: number) => `${p >= 0 ? "▲" : "▼"}${Math.abs(p).toFixed(0)}%`;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 최근 구간에서 순위가 가장 좋았던 주(동률이면 가장 최근)보다 이번 주가 얼마나 내려갔는지. 조건에 못 미치면 null */
export function detectSlide(weeks: RankWeek[]): { from: RankWeek; to: RankWeek; drop: number; ratingPct: number | null } | null {
  const to = weeks[weeks.length - 1];
  if (!to || to.rank === null) return null;
  const earlier = weeks.slice(0, -1).filter((w) => w.rank !== null);
  if (earlier.length < 2) return null;
  const best = earlier.reduce((a, b) => (b.rank! <= a.rank! ? b : a));
  const drop = to.rank - best.rank!;
  if (drop < SLIDE_MIN_DROP) return null;
  const ratingPct = best.rating !== null && best.rating > 0 && to.rating !== null ? (to.rating / best.rating - 1) * 100 : null;
  if (ratingPct === null || ratingPct > -SLIDE_MIN_RATING_DROP_PCT) return null;
  return { from: best, to, drop, ratingPct };
}

interface ProgramAgg {
  name: string;
  sec: number;
  rs: number;
}
interface WeekAgg {
  covered: number;
  programs: Map<string, ProgramAgg>;
  /** 시작 시각 구간별(시간 가중) 시청률 합 */
  bands: Map<string, { sec: number; rs: number }>;
}

const BANDS: { key: string; label: string; from: number; to: number }[] = [
  { key: "am", label: "오전 5~12시", from: 5, to: 12 },
  { key: "day", label: "낮 12~18시", from: 12, to: 18 },
  { key: "eve", label: "저녁 18~21시", from: 18, to: 21 },
  { key: "night", label: "밤 21~24시", from: 21, to: 24 },
  { key: "late", label: "심야 24~29시", from: 24, to: 29 },
];

function aggregateWeeks(airings: SlideAiring[]): Map<string, WeekAgg> {
  const names = new Map(airings.map((a) => [a.programId, a.name]));
  const deduped = dedupeAirings(
    airings.map((a): WorkAiring => ({ programId: a.programId, date: a.date, startTime: a.startTime, endTime: a.endTime, rating: a.rating, firstRun: null, episode: null, createdAt: a.createdAt }))
  );
  const out = new Map<string, WeekAgg>();
  for (const a of deduped) {
    const dur = durationOf(a);
    if (dur === null || a.rating === null || !Number.isFinite(a.rating) || !a.startTime) continue;
    const wk = mondayOf(a.date);
    const w = out.get(wk) ?? { covered: 0, programs: new Map<string, ProgramAgg>(), bands: new Map<string, { sec: number; rs: number }>() };
    w.covered += dur;
    const p = w.programs.get(a.programId) ?? { name: names.get(a.programId) ?? a.programId, sec: 0, rs: 0 };
    p.sec += dur;
    p.rs += a.rating * dur;
    w.programs.set(a.programId, p);
    const h0 = Number(a.startTime.slice(0, 2));
    const h = h0 < 5 ? h0 + 24 : h0;
    const band = BANDS.find((b) => h >= b.from && h < b.to);
    if (band) {
      const b = w.bands.get(band.key) ?? { sec: 0, rs: 0 };
      b.sec += dur;
      b.rs += a.rating * dur;
      w.bands.set(band.key, b);
    }
    out.set(wk, w);
  }
  return out;
}

const shareOf = (w: WeekAgg, id: string) => (w.programs.get(id)?.sec ?? 0) / w.covered;
const avgOf = (p: ProgramAgg | undefined) => (p && p.sec > 0 ? p.rs / p.sec : null);
const contribOf = (w: WeekAgg, id: string) => (w.programs.get(id)?.rs ?? 0) / w.covered;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 6) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** 등록 경쟁채널의 한 주 평균 시청률 — 그 주에 5일 이상 자료가 있는 채널만 */
function competitorWeekMeans(rows: CompetitorDay[], weekStart: string): Map<string, number> {
  const end = addDays(weekStart, 6);
  const byName = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    if (r.rating === null || !Number.isFinite(r.rating) || r.date < weekStart || r.date > end) continue;
    const days = byName.get(r.name) ?? new Map<string, number[]>();
    days.set(r.date, [...(days.get(r.date) ?? []), r.rating]);
    byName.set(r.name, days);
  }
  const out = new Map<string, number>();
  for (const [name, days] of byName) {
    if (days.size < 5) continue;
    const perDay = [...days.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
    out.set(name, perDay.reduce((a, b) => a + b, 0) / perDay.length);
  }
  return out;
}

export function rankSlideOf(i: {
  channelCode: string;
  channelName: string;
  weeks: RankWeek[];
  airings: SlideAiring[];
  competitors: CompetitorDay[];
  /** 등록 경쟁채널 이름 전체(스포츠 채널 유무 확인용) */
  registeredCompetitorNames: string[];
  /** 자사 채널 이름 — 경쟁채널 비교에서 뺀다 */
  ownChannelNames: string[];
}): RankSlide | null {
  const det = detectSlide(i.weeks);
  if (!det) return null;
  const { from, to, drop, ratingPct } = det;
  const code = i.channelCode;
  const name = i.channelName;
  const r3 = (v: number | null) => formatRatingValue(v, code);
  const lines: string[] = [];

  lines.push(`${name} 주간 순위가 ${label(from.weekStart)} ${from.rank}위(시청률 ${r3(from.rating)})에서 이번 주 ${to.rank}위(${r3(to.rating)})로 ${drop}계단 내려갔고, 같은 기간 시청률은 ${fmtPct(ratingPct!)}입니다.`);

  // ── 프로그램 구성 변화 ───────────────────────────────
  const agg = aggregateWeeks(i.airings);
  const aFrom = agg.get(from.weekStart);
  const aTo = agg.get(to.weekStart);
  let weakest: { id: string; name: string; share: number; avg: number } | null = null;
  if (aFrom && aTo && aFrom.covered >= MIN_COVERED_SEC && aTo.covered >= MIN_COVERED_SEC) {
    const ids = new Set([...aFrom.programs.keys(), ...aTo.programs.keys()]);
    const exits = [...ids].filter((id) => shareOf(aFrom, id) >= BIG_SHARE && shareOf(aTo, id) < GONE_SHARE).sort((a, b) => contribOf(aFrom, b) - contribOf(aFrom, a)).slice(0, 3);
    const entries = [...ids].filter((id) => shareOf(aTo, id) >= BIG_SHARE && shareOf(aFrom, id) < GONE_SHARE).sort((a, b) => shareOf(aTo, b) - shareOf(aTo, a)).slice(0, 3);
    const groupText = (w: WeekAgg, group: string[]) => {
      const sec = group.reduce((s, id) => s + (w.programs.get(id)?.sec ?? 0), 0);
      const rs = group.reduce((s, id) => s + (w.programs.get(id)?.rs ?? 0), 0);
      return { share: sec / w.covered, avg: sec > 0 ? rs / sec : null };
    };
    const quote = (w: WeekAgg, group: string[]) => group.map((id) => `‘${w.programs.get(id)!.name}’`).join("·");
    if (exits.length > 0 && entries.length > 0) {
      const ge = groupText(aFrom, exits);
      const gn = groupText(aTo, entries);
      const chg = ge.avg !== null && ge.avg > 0 && gn.avg !== null ? (gn.avg / ge.avg - 1) * 100 : null;
      lines.push(
        `편성 구성이 바뀌었습니다. 빠진 ${quote(aFrom, exits)}(${label(from.weekStart)} 편성 시간의 ${(ge.share * 100).toFixed(0)}%, 평균 ${r3(ge.avg)}) 자리를 새로 들어온 ${quote(aTo, entries)}(이번 주 ${(gn.share * 100).toFixed(0)}%, 평균 ${r3(gn.avg)})가 채우면서 평균 시청률이 ${chg === null ? "달라졌" : `${fmtPct(chg)} ${chg < 0 ? "낮아졌" : "높아졌"}`}습니다.`
      );
      // 새로 들어온 프로그램 중 편성 비중이 크면서 평균이 다른 신규 편성보다 뚜렷이 낮은 것
      const heavy = entries.filter((id) => shareOf(aTo, id) >= HEAVY_SHARE && avgOf(aTo.programs.get(id)) !== null);
      if (heavy.length > 0) {
        const lowest = heavy.reduce((a, b) => (avgOf(aTo.programs.get(b))! < avgOf(aTo.programs.get(a))! ? b : a));
        const others = entries.filter((id) => id !== lowest);
        const og = others.length ? groupText(aTo, others) : null;
        const lowAvg = avgOf(aTo.programs.get(lowest))!;
        if (og && og.avg !== null && lowAvg < og.avg * 0.8) {
          const nm = aTo.programs.get(lowest)!.name;
          weakest = { id: lowest, name: nm, share: shareOf(aTo, lowest), avg: lowAvg };
          // 같은 방식(한 작품 다편성)이던 이전 주력과의 비교 — 집중 편성 자체가 아니라 그 작품의 시청 기반 차이인지 사실로 나란히 보인다
          const bigExit = [...exits].sort((a, b) => shareOf(aFrom, b) - shareOf(aFrom, a))[0];
          const exitNote = shareOf(aFrom, bigExit) >= HEAVY_SHARE ? ` 이전 주력 ‘${aFrom.programs.get(bigExit)!.name}’${josaEunNeun(aFrom.programs.get(bigExit)!.name)} ${label(from.weekStart)}에 ${(shareOf(aFrom, bigExit) * 100).toFixed(0)}%를 차지하며 평균 시청률은 ${r3(avgOf(aFrom.programs.get(bigExit)))}이었습니다.` : "";
          lines.push(`특히 ‘${nm}’${josaIga(nm)} 이번 주 편성 시간의 ${(weakest.share * 100).toFixed(0)}%를 차지하는데 평균 시청률은 ${r3(lowAvg)}로, 함께 들어온 다른 신규 편성 평균(${r3(og.avg)})의 ${((lowAvg / og.avg) * 100).toFixed(0)}% 수준입니다.${exitNote}`);
        }
      }
    }
  }

  // ── 하락 시점 ───────────────────────────────────────
  const idxFrom = i.weeks.findIndex((w) => w.weekStart === from.weekStart);
  let stepText: string | null = null;
  {
    let best: { prev: RankWeek; cur: RankWeek; step: number } | null = null;
    for (let k = idxFrom + 1; k < i.weeks.length; k++) {
      const prev = i.weeks[k - 1];
      const cur = i.weeks[k];
      if (prev.rank === null || cur.rank === null || addDays(prev.weekStart, 7) !== cur.weekStart) continue;
      const step = cur.rank - prev.rank;
      if (!best || step > best.step) best = { prev, cur, step };
    }
    if (best && best.step >= 8) {
      const ap = agg.get(best.prev.weekStart);
      const ac = agg.get(best.cur.weekStart);
      let who = "";
      if (ap && ac && ap.covered >= MIN_COVERED_SEC && ac.covered >= MIN_COVERED_SEC) {
        const ids = [...new Set([...ap.programs.keys(), ...ac.programs.keys()])];
        const loser = ids.filter((id) => shareOf(ap, id) - shareOf(ac, id) >= 0.1).sort((a, b) => contribOf(ac, a) - contribOf(ap, a) - (contribOf(ac, b) - contribOf(ap, b)))[0];
        if (loser) {
          const nm = ap.programs.get(loser)!.name;
          who = ` — ‘${nm}’${josaIga(nm)} ${shareOf(ac, loser) < GONE_SHARE ? "빠진" : "줄어든"} 주입니다`;
        }
      }
      stepText = `한 주 낙폭이 가장 컸던 때는 ${label(best.cur.weekStart)}(${best.prev.rank}위→${best.cur.rank}위)${who}.`;
    }
    if (weakest && aTo) {
      // 약한 신규 프로그램이 처음 편성 비중을 차지한 주부터 이어진 순위
      const firstIdx = i.weeks.findIndex((w) => (agg.get(w.weekStart) ? shareOf(agg.get(w.weekStart)!, weakest!.id) : 0) >= BIG_SHARE);
      if (firstIdx > idxFrom && firstIdx >= 1) {
        const ranks = i.weeks.slice(firstIdx - 1).map((w) => w.rank);
        if (ranks.every((r) => r !== null)) stepText = `${stepText ? `${stepText} ` : ""}‘${weakest.name}’ 편성이 시작된 ${label(i.weeks[firstIdx].weekStart)}부터는 ${ranks.map((r) => `${r}위`).join(" → ")}로 이어졌습니다.`;
      }
    }
  }
  if (stepText) lines.push(stepText);

  // ── 시간대별 변화 ───────────────────────────────────
  if (aFrom && aTo) {
    const rows = BANDS.map((b) => {
      const f = aFrom.bands.get(b.key);
      const t = aTo.bands.get(b.key);
      if (!f || !t || f.sec < 3 * 3600 || t.sec < 3 * 3600) return null;
      const fa = f.rs / f.sec;
      const ta = t.rs / t.sec;
      return fa > 0 ? { label: b.label, pct: (ta / fa - 1) * 100 } : null;
    }).filter((x): x is { label: string; pct: number } => x !== null);
    if (rows.length >= 3) {
      const sorted = [...rows].sort((a, b) => a.pct - b.pct);
      const worst = sorted.slice(0, 2);
      const best = sorted[sorted.length - 1];
      lines.push(`시간대별 시청률 변화는 ${worst.map((w) => `${w.label} ${fmtPct(w.pct)}`).join(", ")}에서 가장 컸고, ${best.label}는 ${fmtPct(best.pct)}로 가장 작았습니다.`);
    }
  }

  // ── 시장·경쟁 ───────────────────────────────────────
  const own = new Set(i.ownChannelNames.map((n) => n.toLowerCase()));
  const comp = i.competitors.filter((c) => !own.has(c.name.toLowerCase()));
  const cFrom = competitorWeekMeans(comp, from.weekStart);
  const cTo = competitorWeekMeans(comp, to.weekStart);
  const common = [...cFrom.keys()].filter((n) => cTo.has(n) && cFrom.get(n)! > 0);
  const parts: string[] = [];
  if (common.length >= 5) {
    const changes = common.map((n) => ({ n, pct: (cTo.get(n)! / cFrom.get(n)! - 1) * 100 }));
    const med = median(changes.map((c) => c.pct))!;
    parts.push(`같은 기간 등록 경쟁채널 ${common.length}곳의 시청률 변화 중앙값은 ${fmtPct(med)}${Math.abs(med) < 15 ? "로 큰 변화가 없었는데" : "이고"} ${name}는 ${fmtPct(ratingPct!)}입니다.`);
    const passed = common.filter((n) => cFrom.get(n)! < from.rating! && cTo.get(n)! > to.rating!).sort((a, b) => cTo.get(b)! - cTo.get(a)!);
    if (passed.length > 0) {
      const medPassed = median(passed.map((n) => (cTo.get(n)! / cFrom.get(n)! - 1) * 100))!;
      parts.push(
        `${name}보다 낮았다가 지금은 높은 곳이 ${passed.length}곳(${passed.slice(0, 3).join("·")}${passed.length > 3 ? " 등" : ""})인데 이들의 시청률 변화 중앙값은 ${fmtPct(medPassed)}입니다.`
      );
    } else {
      parts.push(`${name}를 새로 앞선 등록 경쟁채널은 없습니다.`);
    }
  }
  const valid = i.weeks.filter((w) => w.rank !== null && w.rating !== null);
  const r = pearson(valid.map((w) => w.rating!), valid.map((w) => w.rank!));
  if (r !== null && r <= -0.8) parts.push(`최근 ${valid.length}주 동안 주간 순위는 자체 시청률과 거의 같이 움직였습니다(상관 ${r.toFixed(2).replace("-", "−")}).`);
  if (parts.length > 0) lines.push(parts.join(" "));

  return { channelCode: code, channelName: name, fromWeek: from.weekStart, toWeek: to.weekStart, fromRank: from.rank!, toRank: to.rank!, drop, ratingPct, lines };
}
