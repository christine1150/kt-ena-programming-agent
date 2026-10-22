// 콘텐츠 적합도(CONTENT FITS) 엔진 — 순수 결정론 함수(DB·시계·난수 없음, 같은 입력이면 같은 결과).
//
// 왜 다시 만들었나(2026-10-14): 기존 점수는 "타깃 성과/타깃 선호도/시청 몰입도"를 채널 내 순위(percentile)로
// 바꿔 단순 평균했다. 검증 결과 ① 타깃 선호도는 사실상 "30대 시청 비중이 낮을수록 높은 점수"(상관 -0.98)이고
// 이후 실적·편성 유지와 음의 관계였으며 ② 타깃 성과의 60%는 콘텐츠가 아니라 "편성된 슬롯의 좋고 나쁨"이었고
// ③ 높은 보조 점수가 낮은 시청률을 보상했다(시청률 4분의 1인 5일 방영 프로그램이 57일 방영 상위 프로그램을 앞섬).
//
// 새 논리(두 질문 + 신뢰도 + 보정):
//  1) 슬롯 대비 성과 L = 이 프로그램이 같은 요일·시간대의 "다른 프로그램 평균" 대비 몇 배의 시청률을 냈는가.
//     프로그램 자신을 뺀(LOO) 기대치를 쓰고, 표본이 얇으면 1.0(슬롯 평균)으로 수축한다 — L = (ΣR + m0) / (ΣE + m0).
//  2) 시청 규모 A = 채널 평균 방영 시청률 대비 몇 배인가(절대 수준, 같은 방식으로 수축).
//  3) 종합 = (슬롯 대비 성과 + 시청 규모) / 2 에 시청 몰입도·최근 추세를 제한된 폭(+10/-15점)으로만 보정.
//  4) 판정은 슬롯 대비 성과(L)와 표본 신뢰도로 내린다. 표본이 적으면(8일 미만 등) 점수는 참고용, 3일 미만은 판단 보류.
// 타깃 선호도(연령 구성)는 점수에서 제외했다 — 연령 구성은 "누가 보나"라는 설명 정보이지 "적합한가"의 근거가 아니다.
import { CONTENT_FIT_CONFIG, CONTENT_FIT_MODEL_VERSION, type ContentFitConfig } from "./config";
import type {
  BaselineLevel,
  ContentFitAiring,
  ContentFitItem,
  ContentFitResult,
  ContentFitTag,
  ContentFitTier,
  ContentFitTrend,
  Daypart,
} from "./types";

// ───────────────────────── 날짜·시간 유틸(문자열 기준, 시간대 변환 없음) ─────────────────────────

export function addDaysStr(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function dowOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
/** 방송 시각(시): 01시대 이전(00~01시)은 전날 방송일의 연장이라 +24 (기존 마트의 hour_block 정의와 같다). */
function hourBlockOf(startTime: string | null): number | null {
  if (!startTime || startTime.length < 2) return null;
  const h = Number(startTime.slice(0, 2));
  if (!Number.isFinite(h)) return null;
  return h < 2 ? h + 24 : h;
}
function daypartOf(hb: number | null): Daypart | null {
  if (hb === null) return null;
  if (hb >= 2 && hb <= 8) return "새벽";
  if (hb >= 9 && hb <= 13) return "오전";
  if (hb >= 14 && hb <= 18) return "오후";
  return "저녁_심야";
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const log2 = (x: number) => Math.log(x) / Math.LN2;
/** 지수 → 0~100 점수: 기준(1.0배)=50, 2배=75, 절반=25(로그 척도). */
export const indexToScore = (index: number) => clamp(50 + 25 * log2(Math.max(index, 1e-6)), 0, 100);

// ───────────────────────── 내부 구조 ─────────────────────────

interface Rec {
  pid: string;
  date: string;
  start: string;
  dow: number;
  hb: number | null;
  dp: Daypart | null;
  rating: number;
  reach: number | null;
  tss: number | null;
  firstRun: boolean | null;
}
type ValueKey = "rating" | "reach" | "tss";

interface CellStat {
  n: number;
  s: number;
  byProgram: Map<string, { n: number; s: number }>;
}
interface LevelDef {
  name: BaselineLevel;
  key: (a: Rec) => string | null;
}

const LEVELS: LevelDef[] = [
  { name: "slot", key: (a) => (a.hb === null ? null : `${a.dow}|${a.hb}`) },
  { name: "dowDaypart", key: (a) => (a.dp === null ? null : `${a.dow}|${a.dp}`) },
  { name: "daypart", key: (a) => a.dp },
];

/** 값 종류(시청률/도달률/시청시간비율)별 "프로그램 자신을 뺀" 슬롯 기대치 계산기. */
class Universe {
  readonly channelMean: number;
  private readonly cells: Map<string, CellStat>[];
  private readonly totS: number;
  private readonly totN: number;
  private readonly progTotals = new Map<string, { n: number; s: number }>();

  constructor(
    airings: Rec[],
    private readonly valueKey: ValueKey,
    private readonly minOther: number
  ) {
    this.cells = LEVELS.map(() => new Map<string, CellStat>());
    let totS = 0;
    let totN = 0;
    for (const a of airings) {
      const v = a[valueKey];
      if (v === null) continue;
      LEVELS.forEach((lv, i) => {
        const k = lv.key(a);
        if (k === null) return;
        let cell = this.cells[i].get(k);
        if (!cell) {
          cell = { n: 0, s: 0, byProgram: new Map() };
          this.cells[i].set(k, cell);
        }
        cell.n++;
        cell.s += v;
        const q = cell.byProgram.get(a.pid) ?? { n: 0, s: 0 };
        q.n++;
        q.s += v;
        cell.byProgram.set(a.pid, q);
      });
      totS += v;
      totN++;
      const pt = this.progTotals.get(a.pid) ?? { n: 0, s: 0 };
      pt.n++;
      pt.s += v;
      this.progTotals.set(a.pid, pt);
    }
    this.totS = totS;
    this.totN = totN;
    this.channelMean = totN > 0 ? totS / totN : 0;
  }

  /** 이 방영 1건의 기대값(프로그램 자신 제외). 칸이 얇으면 더 넓은 수준으로 넘어간다. */
  expected(a: Rec, pid: string): { exp: number; level: BaselineLevel } | null {
    for (let i = 0; i < LEVELS.length; i++) {
      const k = LEVELS[i].key(a);
      if (k === null) continue;
      const cell = this.cells[i].get(k);
      if (!cell) continue;
      const own = cell.byProgram.get(pid);
      const otherN = cell.n - (own?.n ?? 0);
      if (otherN >= this.minOther) return { exp: (cell.s - (own?.s ?? 0)) / otherN, level: LEVELS[i].name };
    }
    const pt = this.progTotals.get(pid);
    const otherN = this.totN - (pt?.n ?? 0);
    if (otherN >= 1) return { exp: (this.totS - (pt?.s ?? 0)) / otherN, level: "channel" };
    return null;
  }
}

interface Sums {
  R: number;
  E: number;
  n: number;
  levels: Record<BaselineLevel, number>;
}
function sumsOf(recs: Rec[], pid: string, U: Universe, key: ValueKey, filt?: (a: Rec) => boolean): Sums {
  const out: Sums = { R: 0, E: 0, n: 0, levels: { slot: 0, dowDaypart: 0, daypart: 0, channel: 0 } };
  for (const a of recs) {
    if (filt && !filt(a)) continue;
    const v = a[key];
    if (v === null) continue;
    const x = U.expected(a, pid);
    if (!x) continue;
    out.R += v;
    out.E += x.exp;
    out.n++;
    out.levels[x.level]++;
  }
  return out;
}
/** 수축 지수: 사전분포 = 슬롯 평균(1.0배), 사전 질량 m0. 질량이 0이면 null. */
function shrunk(s: Sums, m0: number): number | null {
  const den = s.E + m0;
  return den > 0 ? (s.R + m0) / den : null;
}
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ───────────────────────── 본체 ─────────────────────────

/**
 * 채널 KPI 타깃의 프로그램 단위 방영 행(윈도우 내 전체)으로 프로그램별 적합도를 계산한다.
 * 윈도우 밖(asOf 이후/windowDays 이전) 행은 무시한다 — 미래 데이터가 섞이지 않는다.
 */
export function computeContentFit(
  airings: ContentFitAiring[],
  asOf: string,
  config: ContentFitConfig = CONTENT_FIT_CONFIG
): ContentFitResult {
  const windowFrom = addDaysStr(asOf, -(config.windowDays - 1));
  const recs: Rec[] = [];
  for (const a of airings) {
    if (a.date < windowFrom || a.date > asOf) continue;
    if (!Number.isFinite(a.rating)) continue;
    const hb = hourBlockOf(a.startTime);
    recs.push({
      pid: a.programId,
      date: a.date,
      start: a.startTime ?? "",
      dow: dowOf(a.date),
      hb,
      dp: daypartOf(hb),
      rating: a.rating,
      reach: a.reach !== null && Number.isFinite(a.reach) ? a.reach : null,
      tss: a.timeSpentShare !== null && Number.isFinite(a.timeSpentShare) ? a.timeSpentShare : null,
      firstRun: a.firstRun,
    });
  }

  // 입력 순서와 무관하게 같은 결과가 나오도록(부동소수점 합산 순서까지) 정규 순서로 정렬한 뒤 계산한다.
  recs.sort((x, y) => cmpStr(x.date, y.date) || cmpStr(x.start, y.start) || cmpStr(x.pid, y.pid) || x.rating - y.rating || (x.reach ?? -1) - (y.reach ?? -1) || (x.tss ?? -1) - (y.tss ?? -1));

  const byProgram = new Map<string, Rec[]>();
  for (const r of recs) {
    const list = byProgram.get(r.pid);
    if (list) list.push(r);
    else byProgram.set(r.pid, [r]);
  }

  const Ur = new Universe(recs, "rating", config.minOtherAirings);
  const Uc = new Universe(recs, "reach", config.minOtherAirings);
  const Ut = new Universe(recs, "tss", config.minOtherAirings);
  const mu = Ur.channelMean;
  const m0 = config.kappa * mu;
  const recentCut = addDaysStr(asOf, -(config.trendRecentDays - 1));

  const items: ContentFitItem[] = [];
  // 프로그램 ID 순으로 처리해 결과 순서까지 결정론적으로 만든다(동률은 아래 정렬에서 id 오름차순).
  for (const pid of [...byProgram.keys()].sort()) {
    const rs = byProgram.get(pid)!;
    const days = new Set(rs.map((r) => r.date));
    const sampleDays = days.size;
    const sortedDays = [...days].sort();
    const lastAiredDate = sortedDays[sortedDays.length - 1];
    const avgRating = mean(rs.map((r) => r.rating));
    const avgReach = mean(rs.flatMap((r) => (r.reach === null ? [] : [r.reach])));
    const avgTss = mean(rs.flatMap((r) => (r.tss === null ? [] : [r.tss])));
    const currentDaypart = modeDaypart(rs);

    const base: ContentFitItem = {
      programId: pid,
      tier: "HOLD",
      tag: null,
      score: null,
      slotIndex: null,
      scaleIndex: null,
      slotScore: null,
      scaleScore: null,
      engagementScore: null,
      reachIndex: null,
      timeSpentIndex: null,
      trend: null,
      reliability: 0,
      confidencePct: Math.min(49, Math.round((100 * Math.min(1, sampleDays / config.fullConfidenceDays)))),
      sampleDays,
      airings: rs.length,
      avgRating,
      avgReach,
      avgTimeSpentShare: avgTss,
      currentDaypart,
      moveTo: null,
      lean: null,
      baselineShare: { slot: 0, dowDaypart: 0, daypart: 0, channel: 0 },
      lastAiredDate,
    };

    if (sampleDays < config.minDays) {
      items.push(base);
      continue;
    }
    const sr = sumsOf(rs, pid, Ur, "rating");
    const L = shrunk(sr, m0);
    if (sr.n === 0 || L === null || sr.E + m0 <= 0) {
      items.push(base);
      continue;
    }
    const reliability = sr.E / (sr.E + m0);
    const A = (sr.R + m0) / (sr.n * mu + m0);
    const slotScore = indexToScore(L);
    const scaleScore = indexToScore(A);

    // 몰입도: 도달률·시청시간 비율을 같은 시간대 다른 프로그램과 견준 지수의 기하평균
    const sc = sumsOf(rs, pid, Uc, "reach");
    const st = sumsOf(rs, pid, Ut, "tss");
    const Lc = shrunk(sc, config.kappa * Uc.channelMean);
    const Lt = shrunk(st, config.kappa * Ut.channelMean);
    const engagementScore = Lc !== null && Lt !== null ? indexToScore(Math.sqrt(Lc * Lt)) : null;

    // 추세: 최근 N일 vs 그 이전(양쪽 모두 방영 최소 일수가 있어야 계산)
    const recent = sumsOf(rs, pid, Ur, "rating", (a) => a.date >= recentCut);
    const prior = sumsOf(rs, pid, Ur, "rating", (a) => a.date < recentCut);
    const dRecent = new Set(rs.filter((r) => r.date >= recentCut).map((r) => r.date)).size;
    const dPrior = new Set(rs.filter((r) => r.date < recentCut).map((r) => r.date)).size;
    let trend: ContentFitTrend | null = null;
    if (dRecent >= config.trendMinDays && dPrior >= config.trendMinDays) {
      const lr = shrunk(recent, m0);
      const lp = shrunk(prior, m0);
      if (lr !== null && lp !== null && lr > 0 && lp > 0) {
        trend = { delta: log2(lr / lp), recentIndex: lr, priorIndex: lp, recentDays: dRecent, priorDays: dPrior };
      }
    }
    const trendScore = trend ? 50 + 25 * clamp(trend.delta, -2, 2) : 50;

    const core = (1 - config.scaleWeight) * slotScore + config.scaleWeight * scaleScore;
    const adjust = clamp(
      config.engagementWeight * ((engagementScore ?? 50) - 50) + config.trendWeight * (trendScore - 50),
      -config.adjustCapDown,
      config.adjustCapUp
    );
    const score = clamp(core + adjust, 0, 100);

    const formal = sampleDays >= config.fullDays && reliability >= config.minReliability;
    const tier: ContentFitTier = formal ? "FORMAL" : "REFERENCE";
    let tag: ContentFitTag = "TEST";
    let moveTo: Daypart | null = null;
    if (formal) {
      const falling = trend !== null && trend.delta <= config.trendDownDelta;
      if (L >= config.cut.strengthen) tag = falling ? "KEEP" : "STRENGTHEN";
      else if (L >= config.cut.keep) tag = falling ? "WATCH" : "KEEP";
      else if (L >= config.cut.watch) tag = "WATCH";
      else {
        tag = "REPLACE";
        moveTo = betterDaypart(rs, pid, Ur, m0, config);
        if (moveTo) tag = "MOVE";
      }
    }
    const lean: ContentFitItem["lean"] = formal ? null : L >= config.leanBand.above ? "ABOVE" : L <= config.leanBand.below ? "BELOW" : "NEAR";
    const levelTotal = sr.n || 1;
    items.push({
      ...base,
      tier,
      tag,
      score,
      slotIndex: L,
      scaleIndex: A,
      slotScore,
      scaleScore,
      engagementScore,
      reachIndex: Lc,
      timeSpentIndex: Lt,
      trend,
      reliability,
      confidencePct: formal ? Math.round(100 * Math.min(1, sampleDays / config.fullConfidenceDays)) : base.confidencePct,
      moveTo,
      lean,
      baselineShare: {
        slot: sr.levels.slot / levelTotal,
        dowDaypart: sr.levels.dowDaypart / levelTotal,
        daypart: sr.levels.daypart / levelTotal,
        channel: sr.levels.channel / levelTotal,
      },
    });
  }

  // 정식·참고는 점수 내림차순(동률은 id 오름차순), 보류는 맨 뒤(방영 일수 내림차순 → id)
  items.sort((x, y) => {
    const hx = x.score === null ? 1 : 0;
    const hy = y.score === null ? 1 : 0;
    if (hx !== hy) return hx - hy;
    if (x.score !== null && y.score !== null && x.score !== y.score) return y.score - x.score;
    if (x.score === null && y.score === null && x.sampleDays !== y.sampleDays) return y.sampleDays - x.sampleDays;
    return x.programId < y.programId ? -1 : x.programId > y.programId ? 1 : 0;
  });

  return {
    modelVersion: CONTENT_FIT_MODEL_VERSION,
    asOf,
    windowFrom,
    windowDays: config.windowDays,
    channelMeanRating: mu,
    airingCount: recs.length,
    items,
  };
}

/** 주로 방영되는 시간대 — 재방(<재>)을 제외하고, 없으면 전체. 건수 동률은 이른 시간대 우선(결정론). */
function modeDaypart(rs: Rec[]): Daypart | null {
  const pick = (list: Rec[]): Daypart | null => {
    const cnt = new Map<Daypart, number>();
    for (const r of list) if (r.dp) cnt.set(r.dp, (cnt.get(r.dp) ?? 0) + 1);
    const order: Daypart[] = ["새벽", "오전", "오후", "저녁_심야"];
    let best: Daypart | null = null;
    for (const d of order) if ((cnt.get(d) ?? 0) > (best ? (cnt.get(best) ?? 0) : 0)) best = d;
    return best;
  };
  return pick(rs.filter((r) => r.firstRun !== false)) ?? pick(rs);
}

/** MOVE 후보: 현재(가장 많이 방영된) 시간대보다 "더 좋은 슬롯"이면서 거기서는 슬롯 평균 이상을 낸 다른 시간대. */
function betterDaypart(rs: Rec[], pid: string, Ur: Universe, m0: number, config: ContentFitConfig): Daypart | null {
  const per = new Map<Daypart, { L: number; n: number; Eper: number }>();
  for (const dp of ["새벽", "오전", "오후", "저녁_심야"] as Daypart[]) {
    const s = sumsOf(rs, pid, Ur, "rating", (a) => a.dp === dp);
    if (s.n >= config.move.minAirings) {
      const L = shrunk(s, m0);
      if (L !== null) per.set(dp, { L, n: s.n, Eper: s.E / s.n });
    }
  }
  let cur: [Daypart, { L: number; n: number; Eper: number }] | null = null;
  for (const e of per) if (!cur || e[1].n > cur[1].n) cur = e;
  if (!cur) return null;
  let best: [Daypart, { L: number; n: number; Eper: number }] | null = null;
  for (const e of per) {
    if (e[0] === cur[0]) continue;
    if (e[1].L < config.move.minIndex) continue;
    if (e[1].Eper < cur[1].Eper * config.move.minSlotStrength) continue;
    if (!best || e[1].L > best[1].L) best = e;
  }
  return best ? best[0] : null;
}

// ───────────────────────── 작품 단위 슬롯 비교(프로그램 성과 화면용, 2026-10-22 추가) ─────────────────────────
// 위 computeContentFit의 결과·산식은 바꾸지 않는다. 같은 Universe(같은 요일·시 → 요일·시간대 → 시간대 → 채널, "자기 자신 제외"
// 기대치)와 같은 수축(m0 = κ × 채널 평균)을 "임의 조회 기간 + 여러 program_id를 한 작품으로 묶은 경우"에 쓰도록 열어 둔 것이다.
// 한 작품이 채널 안에서 program_id 여러 개(표기 변형)로 나뉘어 있으면 그 전부를 한 묶음으로 보고 비교군(다른 프로그램)에서 함께 뺀다.

const WORK_PID = "__WORK__";

export interface SlotComparisonResult {
  /** 비교에 쓴 작품 방영 수(시청률 값이 있고 기대치를 구한 것) */
  airings: number;
  /** 작품 방영 시청률 합 / 같은 칸 다른 프로그램 기대치 합 */
  sumActual: number;
  sumExpected: number;
  /** 수축 전 배율 ΣR/ΣE. ΣE가 0이면 null(산출 불가) */
  rawIndex: number | null;
  /** 콘텐츠 적합도와 같은 수축 배율 (ΣR + m0)/(ΣE + m0) */
  shrunkIndex: number | null;
  /** 데이터 반영 비중 ΣE/(ΣE + m0) */
  reliability: number;
  m0: number;
  /** 비교 창 전체 방영 1건당 평균(채널 방영평균, 채널 하루 시청률과 다름) */
  channelAiringMean: number;
  /** 기대치를 어느 수준에서 구했는지(건수) */
  levels: Record<BaselineLevel, number>;
  /** 비교군(작품이 아닌 방영) 건수 */
  comparisonAirings: number;
}

/**
 * 채널 KPI 타깃 방영 행(비교 창 전체, 모든 프로그램)에서 작품(workProgramIds)의 슬롯 대비 성과를 구한다.
 * include로 작품 방영 중 일부(본방만·재방만)만 분자에 넣을 수 있다 — 비교군 기대치는 본재와 무관하게 같은 칸의 다른 프로그램 전체다(기존 엔진과 같음).
 */
export function computeSlotComparison(
  airings: ContentFitAiring[],
  workProgramIds: readonly string[],
  include: (a: ContentFitAiring) => boolean = () => true,
  config: ContentFitConfig = CONTENT_FIT_CONFIG
): SlotComparisonResult {
  const work = new Set(workProgramIds);
  const recs: (Rec & { keep: boolean })[] = [];
  for (const a of airings) {
    if (!Number.isFinite(a.rating)) continue;
    const hb = hourBlockOf(a.startTime);
    const isWork = work.has(a.programId);
    recs.push({
      pid: isWork ? WORK_PID : a.programId,
      date: a.date,
      start: a.startTime ?? "",
      dow: dowOf(a.date),
      hb,
      dp: daypartOf(hb),
      rating: a.rating,
      reach: null,
      tss: null,
      firstRun: a.firstRun,
      keep: isWork && include(a),
    });
  }
  recs.sort((x, y) => cmpStr(x.date, y.date) || cmpStr(x.start, y.start) || cmpStr(x.pid, y.pid) || x.rating - y.rating);
  const U = new Universe(recs, "rating", config.minOtherAirings);
  const m0 = config.kappa * U.channelMean;
  const s = sumsOf(
    recs.filter((r) => r.pid === WORK_PID),
    WORK_PID,
    U,
    "rating",
    (a) => (a as Rec & { keep: boolean }).keep
  );
  const comparisonAirings = recs.filter((r) => r.pid !== WORK_PID).length;
  const den = s.E + m0;
  return {
    airings: s.n,
    sumActual: s.R,
    sumExpected: s.E,
    rawIndex: s.n > 0 && s.E > 0 ? s.R / s.E : null,
    shrunkIndex: s.n > 0 && den > 0 ? (s.R + m0) / den : null,
    reliability: den > 0 ? s.E / den : 0,
    m0,
    channelAiringMean: U.channelMean,
    levels: s.levels,
    comparisonAirings,
  };
}
