// 시간 순서(rolling-origin) 예측 검증 하네스(OPT02) — 순수 함수. DB·네트워크·난수 없음.
//
// 원칙
//  · 목표 주 W를 예측할 때 모델은 "그 시점에 알 수 있던" 방영만 본다: date ≤ W시작 − 1 − leadDays. leadDays = 0은 현재 백테스트의 가정(전날까지 모두 안다),
//    실제 편성 작업은 보통 대상 주가 시작되기 1~2주 전에 하므로 leadDays 7·14의 성능을 함께 본다(데이터 부족을 낙관적으로 숨기지 않는다).
//  · 무작위 분할은 쓰지 않는다. 시간 순서로 origin을 옮겨 가며 예측하고, 하이퍼파라미터는 앞쪽 origin(튜닝)에서만 고르고 뒤쪽 origin(최종 holdout)에서 한 번 보고한다.
//  · 오차는 시청률 %p 단위의 MAE·bias·RMSE로 본다(0 근처에서 불안정한 MAPE는 쓰지 않는다). 구간은 이전 origin 잔차의 실증 분위수에서 만들고 이후 origin에서 적중률을 센다.
//  · 결과는 표본 건수 외에 고유 프로그램·방송일 수, origin 수를 함께 낸다(한 프로그램·며칠에 쏠린 표본을 숨기지 않는다).
import { buildFeatureSet, type FeatureOptions } from "./features";
import { addDays, hourBucket } from "./time";
import { withOptimizeTarget } from "./mapping";
import type { Genre, OwnAiring, OwnAiringsBundle } from "./types";
import { UNCLASSIFIED } from "./types";

export type PredictFn = (a: OwnAiring) => number | null;

export interface TrainContext {
  /** 예측 시점에 알 수 있는 방영(date ≤ asOf)만 담긴 묶음 */
  bundle: OwnAiringsBundle;
  train: OwnAiring[];
  asOf: string;
  genreOf: (programName: string) => Genre;
}

export interface ModelSpec {
  id: string;
  label: string;
  /** 학습 자료로 예측 함수를 만든다. 학습 자료 밖 정보를 쓰면 안 된다. */
  build(ctx: TrainContext): PredictFn;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const hourOf = (a: OwnAiring) => hourBucket(a.startMin);
const valueOf = (a: OwnAiring): number | null => (a.kpi.r === null || !Number.isFinite(a.kpi.r) ? null : a.kpi.r);
const sameSlot = (a: OwnAiring, b: OwnAiring) => a.dow === b.dow && hourOf(a) === hourOf(b);

// ───────────── 모델 ─────────────

/** 현재 엔진의 기대값(6단계 수축). 옵션을 바꿔 변형을 만들 수 있다. */
export function existingModel(id: string, label: string, over: Partial<FeatureOptions> = {}): ModelSpec {
  return {
    id,
    label,
    build({ bundle, asOf, genreOf }) {
      const opts: FeatureOptions = {
        asOfDate: asOf,
        lookbackDays: 91,
        recentDays: 28,
        recentWeight: 2,
        excludeHolidays: true,
        shrinkageK: 4,
        minN: 3,
        fullConfidenceN: 12,
        composition: null,
        extraTargets: [],
        ...over,
      };
      const fs = buildFeatureSet(bundle, opts, genreOf);
      return (a) => fs.rating.expected(a.programId, a.airingType, genreOf(a.programName), a.dow, hourOf(a)).expected;
    },
  };
}

function recentOf(train: OwnAiring[], asOf: string, weeks: number, excludeHolidays = true): OwnAiring[] {
  const from = addDays(asOf, -(weeks * 7 - 1));
  return train.filter((a) => a.date >= from && a.date <= asOf && valueOf(a) !== null && !(excludeHolidays && a.isHoliday));
}

/** 기준 B0: 채널 최근 평균 */
export function channelRecentModel(weeks = 4): ModelSpec {
  return {
    id: `channel${weeks}w`,
    label: `채널 최근 ${weeks}주 평균`,
    build({ train, asOf }) {
      const m = mean(recentOf(train, asOf, weeks).map((a) => valueOf(a) as number));
      return () => m;
    },
  };
}

/** 기준 B1: 같은 요일·시간대 최근 평균(없으면 같은 시 평균 → 채널 평균) */
export function slotRecentModel(weeks = 4): ModelSpec {
  return {
    id: `slot${weeks}w`,
    label: `같은 요일·시간대 최근 ${weeks}주 평균`,
    build({ train, asOf }) {
      const recent = recentOf(train, asOf, weeks);
      const all = mean(recent.map((a) => valueOf(a) as number));
      return (a) => {
        const s = recent.filter((x) => sameSlot(x, a)).map((x) => valueOf(x) as number);
        if (s.length > 0) return mean(s);
        const h = recent.filter((x) => hourOf(x) === hourOf(a)).map((x) => valueOf(x) as number);
        return h.length > 0 ? mean(h) : all;
      };
    },
  };
}

/** 기준 B2: 같은 프로그램(같은 방영유형 우선) 최근 n회 평균 — 슬롯을 보지 않는다. 이력 없으면 B1로 대체. */
export function programRecentModel(n = 4, weeks = 12): ModelSpec {
  const fallback = slotRecentModel(4);
  return {
    id: `program${n}`,
    label: `같은 프로그램 최근 ${n}회 평균`,
    build(ctx) {
      const fb = fallback.build(ctx);
      const pool = recentOf(ctx.train, ctx.asOf, weeks);
      return (a) => {
        const same = pool.filter((x) => x.programId === a.programId && x.airingType === a.airingType);
        const rows = (same.length > 0 ? same : pool.filter((x) => x.programId === a.programId)).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)).slice(0, n);
        return rows.length > 0 ? mean(rows.map((x) => valueOf(x) as number)) : fb(a);
      };
    },
  };
}

/**
 * 기준 B3(단순한 두 기준의 보정 조합, 부분풀링): 프로그램 최근 평균과 슬롯 최근 평균을 근거 건수로 섞는다.
 *  α = n/(n+k) (n = 같은 프로그램 최근 방영 수), 예측 = α·프로그램평균 + (1−α)·슬롯평균. 프로그램 이력이 없으면 슬롯 평균으로 수축한다.
 *  프로그램 평균은 다른 슬롯에서의 값이라 슬롯 차이를 섞지 않도록 "프로그램 평균 ÷ 그 방영들의 슬롯 평균"인 비율을 목표 슬롯 평균에 곱하는 대신
 *  단순화하여 직접 평균을 쓴다(이 단순 기준을 이기지 못하면 더 복잡한 구조를 쓸 이유가 없다).
 */
export function pooledModel(k = 3, n = 6): ModelSpec {
  const slot = slotRecentModel(4);
  return {
    id: `pooled_k${k}`,
    label: `프로그램·슬롯 부분풀링(k=${k})`,
    build(ctx) {
      const slotFn = slot.build(ctx);
      const pool = recentOf(ctx.train, ctx.asOf, 12);
      return (a) => {
        const s = slotFn(a);
        const rows = pool.filter((x) => x.programId === a.programId).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)).slice(0, n);
        if (rows.length === 0) return s;
        const p = mean(rows.map((x) => valueOf(x) as number)) as number;
        if (s === null) return p;
        const alpha = rows.length / (rows.length + k);
        return alpha * p + (1 - alpha) * s;
      };
    },
  };
}

// ───────────── 검증 ─────────────

export interface EvalRow {
  originWeek: string;
  model: string;
  programId: string;
  date: string;
  dow: number;
  hour: number;
  airingType: string;
  genre: Genre;
  /** 학습 자료에 이 프로그램이 한 번도 없음 */
  newProgram: boolean;
  /** 이 프로그램을 알지만 같은 요일·시간대 이력은 없음(이동·타 슬롯) */
  knownOtherSlot: boolean;
  /** 학습 자료의 이 프로그램 방영 수 */
  programHistory: number;
  actual: number;
  predicted: number | null;
  /** 채널 평균 대비 매우 낮은 실측(저시청, 0 포함) */
  lowRating: boolean;
}

export interface ValidationOptions {
  /** 목표 주(월요일) 목록 — 시간 순서 */
  targetWeeks: string[];
  /** 데이터 마감과 목표 주 사이의 간격(일). 0 = 목표 주 시작 전날까지 모두 안다(현재 백테스트 가정) */
  leadDays: number;
  genreOf: (programName: string) => Genre;
  /** 이 방영의 실제 값 = bundle.kpi.r (타깃은 호출자가 withOptimizeTarget으로 정한다) */
  models: ModelSpec[];
  /** 공휴일 목표 방영을 평가에서 뺀다(기본 true — 공휴일은 학습에서도 빠진다) */
  skipHolidayTargets?: boolean;
}

/** 목표 주별로 학습 자료를 자르고 각 모델의 예측을 모은다. 학습 자료는 date ≤ 목표 주 시작 − 1 − leadDays만 담긴다. */
export function runRollingOrigin(bundle: OwnAiringsBundle, opts: ValidationOptions): EvalRow[] {
  const rows: EvalRow[] = [];
  const skipHol = opts.skipHolidayTargets !== false;
  for (const week of opts.targetWeeks) {
    const asOf = addDays(week, -1 - opts.leadDays);
    const weekEnd = addDays(week, 6);
    const trainAll = bundle.airings.filter((a) => a.date <= asOf);
    const trainBundle: OwnAiringsBundle = { ...bundle, dateTo: asOf, airings: trainAll, datesWithData: bundle.datesWithData.filter((d) => d <= asOf) };
    const targets = bundle.airings.filter((a) => a.date >= week && a.date <= weekEnd && valueOf(a) !== null && !(skipHol && a.isHoliday));
    if (targets.length === 0 || trainAll.length === 0) continue;
    const ctx: TrainContext = { bundle: trainBundle, train: trainAll, asOf, genreOf: opts.genreOf };
    const channelMean = mean(recentOf(trainAll, asOf, 12).map((a) => valueOf(a) as number)) ?? 0;
    const history = new Map<string, number>();
    for (const a of trainAll) history.set(a.programId, (history.get(a.programId) ?? 0) + 1);
    const slotKnown = new Set(trainAll.map((a) => `${a.programId}|${a.dow}|${hourOf(a)}`));
    for (const m of opts.models) {
      const predict = m.build(ctx);
      for (const t of targets) {
        const actual = valueOf(t) as number;
        const h = history.get(t.programId) ?? 0;
        rows.push({
          originWeek: week,
          model: m.id,
          programId: t.programId,
          date: t.date,
          dow: t.dow,
          hour: hourOf(t),
          airingType: t.airingType,
          genre: opts.genreOf(t.programName),
          newProgram: h === 0,
          knownOtherSlot: h > 0 && !slotKnown.has(`${t.programId}|${t.dow}|${hourOf(t)}`),
          programHistory: h,
          actual,
          predicted: predict(t),
          lowRating: channelMean > 0 && actual < channelMean * 0.1,
        });
      }
    }
  }
  return rows;
}

export interface Metrics {
  n: number;
  /** 예측값이 없어 평가에서 빠진 건수 */
  missing: number;
  mae: number | null;
  bias: number | null; // 평균(예측 − 실측)
  rmse: number | null;
  uniquePrograms: number;
  uniqueDates: number;
  origins: number;
}

export function metricsOf(rows: EvalRow[]): Metrics {
  const used = rows.filter((r) => r.predicted !== null && Number.isFinite(r.predicted));
  const errs = used.map((r) => (r.predicted as number) - r.actual);
  return {
    n: used.length,
    missing: rows.length - used.length,
    mae: mean(errs.map(Math.abs)),
    bias: mean(errs),
    rmse: errs.length ? Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length) : null,
    uniquePrograms: new Set(used.map((r) => r.programId)).size,
    uniqueDates: new Set(used.map((r) => r.date)).size,
    origins: new Set(used.map((r) => r.originWeek)).size,
  };
}

export type GroupKey = "all" | "newProgram" | "knownOtherSlot" | "knownSameSlot" | "smallSample" | "lowRating" | "prime" | "nonPrime" | "firstRun" | "rerun";
export const GROUP_LABEL: Record<GroupKey, string> = {
  all: "전체",
  newProgram: "신규 프로그램(학습 이력 없음)",
  knownOtherSlot: "보유작 · 다른 슬롯(이동)",
  knownSameSlot: "보유작 · 같은 슬롯",
  smallSample: "소표본(학습 이력 3건 미만)",
  lowRating: "저시청(채널 평균의 10% 미만, 0 포함)",
  prime: "프라임(19~22시대 시작)",
  nonPrime: "프라임 밖",
  firstRun: "본방",
  rerun: "재방·미표기",
};
export const GROUPS: Record<GroupKey, (r: EvalRow) => boolean> = {
  all: () => true,
  newProgram: (r) => r.newProgram,
  knownOtherSlot: (r) => r.knownOtherSlot,
  knownSameSlot: (r) => !r.newProgram && !r.knownOtherSlot,
  smallSample: (r) => r.programHistory < 3,
  lowRating: (r) => r.lowRating,
  prime: (r) => r.hour >= 19 && r.hour <= 22,
  nonPrime: (r) => !(r.hour >= 19 && r.hour <= 22),
  firstRun: (r) => r.airingType === "FIRST",
  rerun: (r) => r.airingType !== "FIRST",
};

export interface ModelReport {
  model: string;
  groups: Record<GroupKey, Metrics>;
}

export function reportByModel(rows: EvalRow[], modelIds: string[]): ModelReport[] {
  return modelIds.map((id) => {
    const mine = rows.filter((r) => r.model === id);
    const groups = {} as Record<GroupKey, Metrics>;
    for (const g of Object.keys(GROUPS) as GroupKey[]) groups[g] = metricsOf(mine.filter(GROUPS[g]));
    return { model: id, groups };
  });
}

// ───────────── 실증 구간(coverage) ─────────────

export interface IntervalResult {
  model: string;
  /** 구간을 계산할 수 있었던 평가 건수 */
  n: number;
  /** 실측이 구간 안에 든 비율 — 앞선 origin의 잔차로 만든 구간을 이후 origin에서 센 값 */
  coverage: number | null;
  /** 평균 구간 폭(%p) */
  width: number | null;
  /** 구간 폭 ÷ 예측값 평균(상대 폭) */
  relativeWidth: number | null;
  /** 구간을 만들 수 없는 초기 origin의 건수(과거 잔차 부족) */
  noInterval: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 모델별 실증 예측구간. origin k의 구간은 origin < k의 "실측 ÷ 예측" 배율 분위수(lowQ~highQ)로 만든다(예측 > 하한 바닥인 건만).
 * 이는 *과거 오차의 경험적 범위*이며 미래 적중을 보장하는 예측분포가 아니다 — coverage는 이후 origin에서 센 held-out 값이다.
 */
export function empiricalIntervals(rows: EvalRow[], modelIds: string[], opts: { lowQ?: number; highQ?: number; minResiduals?: number; floorShare?: number } = {}): IntervalResult[] {
  const lowQ = opts.lowQ ?? 0.1;
  const highQ = opts.highQ ?? 0.9;
  const minRes = opts.minResiduals ?? 30;
  const floorShare = opts.floorShare ?? 0.1;
  const out: IntervalResult[] = [];
  for (const id of modelIds) {
    const mine = rows.filter((r) => r.model === id && r.predicted !== null);
    const origins = [...new Set(mine.map((r) => r.originWeek))].sort();
    const overall = mean(mine.map((r) => r.predicted as number)) ?? 0;
    let hit = 0;
    let n = 0;
    let width = 0;
    let predSum = 0;
    let noInterval = 0;
    for (let i = 0; i < origins.length; i++) {
      const prior = mine.filter((r) => r.originWeek < origins[i] && (r.predicted as number) >= overall * floorShare && (r.predicted as number) > 0).map((r) => r.actual / (r.predicted as number)).sort((a, b) => a - b);
      const cur = mine.filter((r) => r.originWeek === origins[i]);
      if (prior.length < minRes) {
        noInterval += cur.length;
        continue;
      }
      const qLo = quantile(prior, lowQ);
      const qHi = quantile(prior, highQ);
      for (const r of cur) {
        const p = r.predicted as number;
        n++;
        width += p * (qHi - qLo);
        predSum += p;
        if (r.actual >= p * qLo && r.actual <= p * qHi) hit++;
      }
    }
    out.push({ model: id, n, coverage: n ? hit / n : null, width: n ? width / n : null, relativeWidth: predSum > 0 ? width / predSum : null, noInterval });
  }
  return out;
}

// ───────────── 튜닝/최종 holdout ─────────────

export interface TuneResult {
  /** 튜닝 구간에서 MAE가 가장 낮은 모델 id */
  chosen: string;
  tuneMae: Record<string, number | null>;
  testMae: Record<string, number | null>;
}

/** origin을 앞 절반(튜닝)과 뒤 절반(최종 holdout)으로 나눠 후보 중 튜닝 MAE가 가장 낮은 모델을 고른다. 최종 holdout 값은 선택 뒤에 한 번만 본다. */
export function tuneAndHoldout(rows: EvalRow[], candidateIds: string[], splitFraction = 0.5): TuneResult {
  const origins = [...new Set(rows.map((r) => r.originWeek))].sort();
  const cut = Math.max(1, Math.floor(origins.length * splitFraction));
  const tuneSet = new Set(origins.slice(0, cut));
  const tune = rows.filter((r) => tuneSet.has(r.originWeek));
  const test = rows.filter((r) => !tuneSet.has(r.originWeek));
  const tuneMae: Record<string, number | null> = {};
  const testMae: Record<string, number | null> = {};
  let chosen = candidateIds[0];
  let best = Infinity;
  for (const id of candidateIds) {
    const m = metricsOf(tune.filter((r) => r.model === id)).mae;
    tuneMae[id] = m;
    if (m !== null && m < best) {
      best = m;
      chosen = id;
    }
  }
  for (const id of candidateIds) testMae[id] = metricsOf(test.filter((r) => r.model === id)).mae;
  return { chosen, tuneMae, testMae };
}

/** 평가에 쓰인 입력 중 시간 버전이 관리되지 않아 "현재 값"으로 과거를 재현하는 것들 — 검증 결과와 함께 반드시 밝힌다. */
export const UNVERSIONED_INPUTS = [
  "장르 맵(현재 값으로 과거 방영의 장르를 분류)",
  "채널 설정·가중치(현재 값)",
  "필수 편성·잠금 제약(현재 값)",
  "업로드 편성표의 회차·부제(업로드 시점 관리 없음)",
  "권리(Avail) 목록(현재 값)",
] as const;

export { UNCLASSIFIED };
export { withOptimizeTarget };
