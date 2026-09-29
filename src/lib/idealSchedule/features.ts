// 이상적 1주일 편성 — 12주 Feature 및 Expected KPI(설계 문서 E절). 순수 함수만 사용한다.
//
// 핵심 설계:
// 1) 정규화 지수(Normalized Performance Index) — 모든 성과를 "그 방영이 놓였던 요일×시간 슬롯의 채널
//    baseline" 대비 비율로 바꾼다. 같은 프로그램이 다른 슬롯에 갔을 때의 기대값을 "지수 × 목표 슬롯
//    baseline"으로 옮길 수 있고, 채널 간 raw rating을 직접 비교하지 않게 된다.
//    지수는 방영별 비율의 평균이 아니라 Σ(가중 시청률) ÷ Σ(가중 baseline)(비율의 합)으로 계산한다 —
//    새벽처럼 baseline이 0인 슬롯이 있어도 계산이 깨지지 않는다.
// 2) Expected KPI = 과거 성과 기반 기대값(예측모델 아님, expected_kpi_type='HISTORICAL_EXPECTED').
//    구체 → 일반 6단계(①프로그램+요일+시 ②프로그램+시 ③프로그램 전체 ④장르+요일+시 ⑤장르+시
//    ⑥채널 baseline)를 표본 수 기반으로 수축: idx_L = (n_L·idx_L + k·idx_{L+1}) / (n_L + k), idx_6 = 1.
//    k·최근 가중치·최소 표본 등 모든 상수는 ideal_schedule_config에서 온다(임의 보정값 없음).
// 3) rating NULL은 표본에서 제외, 0은 포함. 방송 없음은 행이 없는 것.
// 4) 본방/재방: 슬롯 적합도·후보 단위는 본/재/미표기를 나눈 "프로그램×방영유형", ③프로그램 전체
//    성과는 본+재 합산(rerun-tag 규칙, 기존 Fit Score와 동일).
import { addDays, daypartOfHour, hourBucket } from "./time";
import type { AiringType, Genre, OwnAiring, OwnAiringsBundle } from "./types";
import { UNCLASSIFIED } from "./types";

export type MetricKey = "r" | "s" | "ts";

export interface FeatureOptions {
  asOfDate: string;
  lookbackDays: number;
  recentDays: number;
  recentWeight: number;
  excludeHolidays: boolean;
  shrinkageK: number;
  minN: number;
  fullConfidenceN: number;
  composition: { num: string; den: string } | null;
  extraTargets: string[];
}

interface Acc {
  n: number;
  sumWR: number;
  sumWB: number;
}

export interface LevelDetail {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  n: number;
  index: number | null; // 해당 단계 원지수(수축 전)
}

export interface ExpectedResult {
  expected: number | null; // 기대값(같은 지표 단위)
  index: number; // 수축 후 지수
  baseline: number | null; // 목표 슬롯 baseline
  fallbackLevel: 1 | 2 | 3 | 4 | 5 | 6;
  sampleCount: number; // fallbackLevel의 표본 수(6이면 0)
  confidence: number; // 0~1
  levels: LevelDetail[];
}

export const unitKeyOf = (programId: string, airingType: AiringType) => `${programId}|${airingType}`;
const dh = (dow: number, hour: number) => `${dow}|${hour}`;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function addAcc(map: Map<string, Acc>, key: string, w: number, r: number, b: number) {
  const acc = map.get(key) ?? { n: 0, sumWR: 0, sumWB: 0 };
  acc.n += 1;
  acc.sumWR += w * r;
  acc.sumWB += w * b;
  map.set(key, acc);
}

const accIndex = (acc: Acc | undefined): number | null => (acc && acc.sumWB > 0 ? acc.sumWR / acc.sumWB : null);

/** 분석 창(as_of − lookback + 1 ~ as_of). */
export function featureWindow(opts: { asOfDate: string; lookbackDays: number }): { from: string; to: string } {
  return { from: addDays(opts.asOfDate, -(opts.lookbackDays - 1)), to: opts.asOfDate };
}

/** Feature 계산 대상 방영: 창 밖(as_of 이후·창 시작 이전) 제외 — RPC가 이미 막지만 입력이 어디서 왔든
 *  같은 창으로만 계산되도록 이중 방어. 설정 시 공휴일 제외, 날짜·시각 순 정렬. */
export function eligibleAirings(bundle: OwnAiringsBundle, opts: FeatureOptions): OwnAiring[] {
  const win = featureWindow(opts);
  return bundle.airings
    .filter((a) => a.date >= win.from && a.date <= win.to && !(opts.excludeHolidays && a.isHoliday))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin || (a.programId < b.programId ? -1 : 1)));
}

/** 한 지표(r/s/ts)에 대한 채널 baseline + 단계별 지수 집계. */
export class MetricModel {
  readonly channelMean: number | null;
  private readonly hourMean = new Map<number, { n: number; mean: number }>();
  private readonly dowHourMean = new Map<string, { n: number; mean: number }>();
  private readonly acc = new Map<string, Acc>();
  private readonly perAiringRatios = new Map<string, number[]>(); // 프로그램×방영유형 → 방영별 지수(안정성용)

  constructor(
    airings: OwnAiring[],
    private readonly metric: MetricKey,
    private readonly opts: FeatureOptions,
    genreOf: (a: OwnAiring) => Genre
  ) {
    const valid = airings.filter((a) => a.kpi[metric] !== null);
    const values = valid.map((a) => a.kpi[metric] as number);
    this.channelMean = mean(values);

    const hourVals = new Map<number, number[]>();
    const dowHourVals = new Map<string, number[]>();
    for (const a of valid) {
      const h = hourBucket(a.startMin);
      const v = a.kpi[metric] as number;
      (hourVals.get(h) ?? hourVals.set(h, []).get(h)!).push(v);
      const key = dh(a.dow, h);
      (dowHourVals.get(key) ?? dowHourVals.set(key, []).get(key)!).push(v);
    }
    for (const [h, vs] of hourVals) this.hourMean.set(h, { n: vs.length, mean: mean(vs)! });
    for (const [k, vs] of dowHourVals) this.dowHourMean.set(k, { n: vs.length, mean: mean(vs)! });

    const recentFrom = addDays(opts.asOfDate, -(opts.recentDays - 1));
    for (const a of valid) {
      const h = hourBucket(a.startMin);
      const b = this.baseline(a.dow, h);
      if (b === null) continue;
      const r = a.kpi[metric] as number;
      const w = a.date >= recentFrom ? opts.recentWeight : 1;
      const unit = unitKeyOf(a.programId, a.airingType);
      addAcc(this.acc, `u|${unit}|${dh(a.dow, h)}`, w, r, b);
      addAcc(this.acc, `u|${unit}|h${h}`, w, r, b);
      addAcc(this.acc, `u|${unit}|all`, w, r, b);
      addAcc(this.acc, `u|${unit}|dow${a.dow}`, w, r, b);
      addAcc(this.acc, `u|${unit}|dp${daypartOfHour(h)}`, w, r, b);
      if (a.date >= recentFrom) addAcc(this.acc, `u|${unit}|recent`, 1, r, b);
      if (a.date >= addDays(opts.asOfDate, -(2 * opts.recentDays - 1))) addAcc(this.acc, `u|${unit}|recent8`, 1, r, b);
      addAcc(this.acc, `p|${a.programId}`, w, r, b);
      const genre = genreOf(a);
      if (genre !== UNCLASSIFIED) {
        addAcc(this.acc, `g|${genre}|${dh(a.dow, h)}`, w, r, b);
        addAcc(this.acc, `g|${genre}|h${h}`, w, r, b);
      }
      // 안정성은 본방/재방을 섞지 않고 "프로그램×방영유형" 단위로 본다(재방은 같은 슬롯 대비 성과 수준이
      // 달라 섞으면 변동성이 부풀려진다 — 2026-09-30 실데이터 점검).
      if (b > 0) (this.perAiringRatios.get(unit) ?? this.perAiringRatios.set(unit, []).get(unit)!).push(r / b);
    }
  }

  /** 요일×시 baseline — 요일×시 평균을 시 평균으로, 시 평균을 채널 평균으로 수축(같은 k). 데이터 없으면 null. */
  baseline(dow: number, hour: number): number | null {
    if (this.channelMean === null) return null;
    const k = this.opts.shrinkageK;
    const hm = this.hourMean.get(hour);
    const hourB = hm ? (hm.n * hm.mean + k * this.channelMean) / (hm.n + k) : this.channelMean;
    const dm = this.dowHourMean.get(dh(dow, hour));
    return dm ? (dm.n * dm.mean + k * hourB) / (dm.n + k) : hourB;
  }

  slotSample(dow: number, hour: number): number {
    return this.dowHourMean.get(dh(dow, hour))?.n ?? 0;
  }

  rawIndex(key: string): { n: number; index: number | null } {
    const a = this.acc.get(key);
    return { n: a?.n ?? 0, index: accIndex(a) };
  }

  /** 프로그램×방영유형의 방영별 지수 변동계수 기반 안정성(표본 2 미만이면 계산하지 않음 → null). */
  stability(unitKey: string): { volatility: number | null; stability: number | null } {
    const ratios = this.perAiringRatios.get(unitKey) ?? [];
    if (ratios.length < 2) return { volatility: null, stability: null };
    const m = mean(ratios)!;
    if (m <= 0) return { volatility: null, stability: null };
    const sd = Math.sqrt(ratios.reduce((s, x) => s + (x - m) ** 2, 0) / (ratios.length - 1));
    const cv = sd / m;
    return { volatility: cv, stability: 1 - Math.min(cv, 1) };
  }

  /** 6단계 수축 Expected. unit은 programId|airingType. */
  expected(programId: string, airingType: AiringType, genre: Genre, dow: number, hour: number): ExpectedResult {
    const unit = unitKeyOf(programId, airingType);
    const k = this.opts.shrinkageK;
    const levelKeys: { level: 1 | 2 | 3 | 4 | 5; key: string | null }[] = [
      { level: 1, key: `u|${unit}|${dh(dow, hour)}` },
      { level: 2, key: `u|${unit}|h${hour}` },
      { level: 3, key: `p|${programId}` },
      { level: 4, key: genre !== UNCLASSIFIED ? `g|${genre}|${dh(dow, hour)}` : null },
      { level: 5, key: genre !== UNCLASSIFIED ? `g|${genre}|h${hour}` : null },
    ];
    const levels: LevelDetail[] = levelKeys.map(({ level, key }) => {
      const raw = key ? this.rawIndex(key) : { n: 0, index: null };
      return { level, n: raw.n, index: raw.index };
    });
    let idx = 1; // ⑥ 채널 baseline = 지수 1
    for (let i = levels.length - 1; i >= 0; i--) {
      const l = levels[i];
      if (l.index !== null && l.n > 0) idx = (l.n * l.index + k * idx) / (l.n + k);
    }
    const hit = levels.find((l) => l.index !== null && l.n >= this.opts.minN);
    const fallbackLevel = (hit?.level ?? 6) as ExpectedResult["fallbackLevel"];
    const sampleCount = hit?.n ?? 0;
    const base = this.baseline(dow, hour);
    const stab = this.stability(unit).stability;
    // 신뢰도 = 표본 충족도 × 안정성. 안정성을 계산할 수 없으면(표본 2 미만) 곱하지 않는다 — 이때는
    // 표본 충족도 자체가 이미 낮다.
    const confidence = Math.min(1, sampleCount / this.opts.fullConfidenceN) * (stab ?? 1);
    levels.push({ level: 6, n: 0, index: 1 });
    return {
      expected: base === null ? null : idx * base,
      index: idx,
      baseline: base,
      fallbackLevel,
      sampleCount,
      confidence,
      levels,
    };
  }
}

export interface UnitFeatures {
  unitKey: string;
  programId: string;
  programName: string;
  airingType: AiringType;
  genre: Genre;
  sample_count: number;
  valid_measurement_count: number;
  avg_rating_12w: number | null;
  avg_share_12w: number | null;
  avg_view_time_12w: number | null; // 초
  target_ratings: Record<string, number | null>; // 보조 타깃별 평균
  index_12w: number | null;
  recent_4w_performance: number | null; // 지수
  recent_8w_performance: number | null;
  trend_index: number | null; // 최근 4주 지수 ÷ 12주 지수
  volatility: number | null;
  stability_index: number | null;
  weekday_fit: Record<number, { n: number; index: number | null }>;
  daypart_fit: Record<string, { n: number; index: number | null }>;
  target_fit: number | null; // 구성비 지수(채널 평균=1)
  runtime_median_min: number | null;
  weekly_repeat_avg: number;
  daily_repeat_max: number;
  same_slot_repeat_max: number; // 같은 요일×시에 나온 서로 다른 날짜 수의 최대
  observed_slots: { dow: number; hour: number; n: number }[];
}

export interface AdjacencyStat {
  n: number;
  synergy: number | null; // 조건부 평균 지수 ÷ 전체 평균 지수(관측 연관, 효과 아님)
}

export interface FeatureSet {
  options: FeatureOptions;
  channelCode: string;
  kpiLabel: string;
  weeksWithData: number;
  rating: MetricModel;
  share: MetricModel;
  timeSpent: MetricModel;
  units: UnitFeatures[];
  unitsByKey: Map<string, UnitFeatures>;
  /** leadIn.get(B).get(A): A 다음에 B가 나왔을 때 B의 관측 연관 */
  leadIn: Map<string, Map<string, AdjacencyStat>>;
  /** leadOut.get(A).get(B): A 뒤에 B가 나왔을 때 A의 관측 연관 */
  leadOut: Map<string, Map<string, AdjacencyStat>>;
}

function mondayKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(dateStr, -(dow - 1));
}

/** 인접 방영(앞 방영 종료 ~ 다음 방영 시작 간격 5분 이내) 쌍의 관측 연관. */
function buildAdjacency(airings: OwnAiring[], rating: MetricModel, minN: number) {
  const byDate = new Map<string, OwnAiring[]>();
  for (const a of airings) (byDate.get(a.date) ?? byDate.set(a.date, []).get(a.date)!).push(a);
  const idxOf = (a: OwnAiring): number | null => {
    if (a.kpi.r === null) return null;
    const b = rating.baseline(a.dow, hourBucket(a.startMin));
    return b !== null && b > 0 ? a.kpi.r / b : null;
  };
  const unitIdx = new Map<string, number[]>();
  const inRaw = new Map<string, Map<string, number[]>>();
  const outRaw = new Map<string, Map<string, number[]>>();
  for (const list of byDate.values()) {
    const sorted = [...list].sort((x, y) => x.startMin - y.startMin);
    for (const a of sorted) {
      const i = idxOf(a);
      if (i !== null) (unitIdx.get(unitKeyOf(a.programId, a.airingType)) ?? unitIdx.set(unitKeyOf(a.programId, a.airingType), []).get(unitKeyOf(a.programId, a.airingType))!).push(i);
    }
    for (let j = 1; j < sorted.length; j++) {
      const prev = sorted[j - 1];
      const next = sorted[j];
      if (prev.endMin === null || Math.abs(next.startMin - prev.endMin) > 5) continue;
      const pu = unitKeyOf(prev.programId, prev.airingType);
      const nu = unitKeyOf(next.programId, next.airingType);
      if (pu === nu) continue; // 같은 프로그램 연속 편성은 조합 연관이 아니라 반복 편성
      const ni = idxOf(next);
      const pi = idxOf(prev);
      if (ni !== null) {
        const m = inRaw.get(nu) ?? inRaw.set(nu, new Map()).get(nu)!;
        (m.get(pu) ?? m.set(pu, []).get(pu)!).push(ni);
      }
      if (pi !== null) {
        const m = outRaw.get(pu) ?? outRaw.set(pu, new Map()).get(pu)!;
        (m.get(nu) ?? m.set(nu, []).get(nu)!).push(pi);
      }
    }
  }
  const finalize = (raw: Map<string, Map<string, number[]>>) => {
    const out = new Map<string, Map<string, AdjacencyStat>>();
    for (const [self, partners] of raw) {
      const overall = mean(unitIdx.get(self) ?? []);
      const m = new Map<string, AdjacencyStat>();
      for (const [partner, vals] of partners) {
        const cond = mean(vals);
        m.set(partner, {
          n: vals.length,
          synergy: vals.length >= minN && cond !== null && overall !== null && overall > 0 ? cond / overall : null,
        });
      }
      out.set(self, m);
    }
    return out;
  };
  return { leadIn: finalize(inRaw), leadOut: finalize(outRaw) };
}

export function buildFeatureSet(
  bundle: OwnAiringsBundle,
  opts: FeatureOptions,
  genreOfProgram: (programName: string) => Genre
): FeatureSet {
  const airings = eligibleAirings(bundle, opts);
  const genreOf = (a: OwnAiring) => genreOfProgram(a.programName);
  const rating = new MetricModel(airings, "r", opts, genreOf);
  const share = new MetricModel(airings, "s", opts, genreOf);
  const timeSpent = new MetricModel(airings, "ts", opts, genreOf);
  const win = featureWindow(opts);
  const weeks = new Set(bundle.datesWithData.filter((d) => d >= win.from && d <= win.to).map(mondayKey));
  const weeksWithData = Math.max(1, weeks.size);

  // 채널 전체 구성비(Target Audience 기준값)
  const compRatio = (list: OwnAiring[]): number | null => {
    if (!opts.composition) return null;
    let num = 0;
    let den = 0;
    for (const a of list) {
      const n = a.metrics[opts.composition.num]?.r;
      const d = a.metrics[opts.composition.den]?.r;
      if (n === null || n === undefined || d === null || d === undefined) continue;
      num += n;
      den += d;
    }
    return den > 0 ? num / den : null;
  };
  const channelComp = compRatio(airings);

  const grouped = new Map<string, OwnAiring[]>();
  for (const a of airings) {
    const key = unitKeyOf(a.programId, a.airingType);
    (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(a);
  }

  const units: UnitFeatures[] = [];
  for (const [unitKey, list] of [...grouped].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const first = list[0];
    const valid = list.filter((a) => a.kpi.r !== null);
    const numVals = (key: "r" | "s" | "ts") => list.map((a) => a.kpi[key]).filter((v): v is number => v !== null);
    const target_ratings: Record<string, number | null> = {};
    for (const label of opts.extraTargets) {
      target_ratings[label] = mean(list.map((a) => a.metrics[label]?.r).filter((v): v is number => v !== null && v !== undefined));
    }
    const weekday_fit: UnitFeatures["weekday_fit"] = {};
    for (let d = 1; d <= 7; d++) {
      const r = rating.rawIndex(`u|${unitKey}|dow${d}`);
      if (r.n > 0) weekday_fit[d] = r;
    }
    const daypart_fit: UnitFeatures["daypart_fit"] = {};
    for (const dp of ["새벽", "오전", "오후", "저녁_심야"]) {
      const r = rating.rawIndex(`u|${unitKey}|dp${dp}`);
      if (r.n > 0) daypart_fit[dp] = r;
    }
    const overall = rating.rawIndex(`u|${unitKey}|all`).index;
    const recent = rating.rawIndex(`u|${unitKey}|recent`);
    const recent8 = rating.rawIndex(`u|${unitKey}|recent8`);
    const perDay = new Map<string, number>();
    const slotDates = new Map<string, Set<string>>();
    for (const a of list) {
      perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
      const key = dh(a.dow, hourBucket(a.startMin));
      (slotDates.get(key) ?? slotDates.set(key, new Set()).get(key)!).add(a.date);
    }
    const unitComp = compRatio(list);
    const stab = rating.stability(unitKey);
    units.push({
      unitKey,
      programId: first.programId,
      programName: first.programName,
      airingType: first.airingType,
      genre: genreOfProgram(first.programName),
      sample_count: list.length,
      valid_measurement_count: valid.length,
      avg_rating_12w: mean(numVals("r")),
      avg_share_12w: mean(numVals("s")),
      avg_view_time_12w: mean(numVals("ts")),
      target_ratings,
      index_12w: overall,
      recent_4w_performance: recent.index,
      recent_8w_performance: recent8.index,
      trend_index: recent.index !== null && overall !== null && overall > 0 ? recent.index / overall : null,
      volatility: stab.volatility,
      stability_index: stab.stability,
      weekday_fit,
      daypart_fit,
      target_fit: unitComp !== null && channelComp !== null && channelComp > 0 ? unitComp / channelComp : null,
      runtime_median_min: median(list.map((a) => a.durationMin).filter((v): v is number => v !== null)),
      weekly_repeat_avg: list.length / weeksWithData,
      daily_repeat_max: Math.max(...perDay.values()),
      same_slot_repeat_max: Math.max(...[...slotDates.values()].map((s) => s.size)),
      observed_slots: [...slotDates]
        .map(([key, s]) => {
          const [dow, hour] = key.split("|").map(Number);
          return { dow, hour, n: s.size };
        })
        .sort((a, b) => a.dow - b.dow || a.hour - b.hour),
    });
  }

  const { leadIn, leadOut } = buildAdjacency(airings, rating, opts.minN);
  return {
    options: opts,
    channelCode: bundle.channelCode,
    kpiLabel: bundle.kpiLabel,
    weeksWithData,
    rating,
    share,
    timeSpent,
    units,
    unitsByKey: new Map(units.map((u) => [u.unitKey, u])),
    leadIn,
    leadOut,
  };
}
