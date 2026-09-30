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
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

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
  /** 순환 편성 판정 기준(설정 repeat_rules.rotation_series가 켜진 채널만) — 없으면 판정 안 함 */
  rotation?: { minDays: number; minRatio: number } | null;
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
  programSampleCount: number; // 프로그램 자체 단계(1~3) 중 최소 표본을 만족한 가장 구체적 단계의 표본 수
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
  private readonly perAiringBase = new Map<string, number[]>(); // 같은 순서의 방영별 슬롯 baseline(예상 범위 필터용)

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
      if (b > 0) {
        (this.perAiringRatios.get(unit) ?? this.perAiringRatios.set(unit, []).get(unit)!).push(r / b);
        (this.perAiringBase.get(unit) ?? this.perAiringBase.set(unit, []).get(unit)!).push(b);
      }
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

  /** 학습 기간 방영별 상대 변동 — 방영 지수 ÷ 그 프로그램×방영유형 평균 지수(방영 minPerUnit회 이상 단위만).
   *  백테스트 잔차가 없을 때 예상 범위의 대용(uncertainty.ts, 표본 안 변동이라 실제 오차보다 좁음). */
  relativeSpread(minPerUnit = 3): number[] {
    // 백테스트 잔차와 같은 기준: 슬롯 baseline이 채널 평균의 10% 미만인 방영(새벽 등 시청률 0 근처)은 비율이 폭주해 제외
    const floor = (this.channelMean ?? 0) * 0.1;
    const out: number[] = [];
    for (const [unit, ratios] of [...this.perAiringRatios]) {
      const bases = this.perAiringBase.get(unit) ?? [];
      const kept = ratios.filter((_, i) => (bases[i] ?? 0) >= floor);
      if (kept.length < minPerUnit) continue;
      const m = mean(kept);
      if (m === null || m <= 0) continue;
      for (const x of kept) out.push(x / m);
    }
    return out;
  }

  /** 요일×시 적합도: 그 프로그램이 이 요일×시에서 낸 지수 ÷ 프로그램 전체 지수(표본 수로 1쪽 수축).
   *  이 슬롯에 방영 이력이 없으면 근거 없음 → null. */
  weekdaySlotFit(programId: string, airingType: AiringType, dow: number, hour: number): { n: number; fit: number } | null {
    const l1 = this.rawIndex(`u|${unitKeyOf(programId, airingType)}|${dh(dow, hour)}`);
    const l3 = this.rawIndex(`p|${programId}`);
    if (l1.index === null || l1.n === 0 || l3.index === null || l3.index <= 0) return null;
    const k = this.opts.shrinkageK;
    return { n: l1.n, fit: (l1.n * (l1.index / l3.index) + k) / (l1.n + k) };
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
    // 신뢰도 = 프로그램 자체 표본 충족도 × 안정성. 장르·채널 단계(4~6)로 폴백한 기대값은 그 프로그램에 대한
    // 직접 근거가 아니므로 신뢰도에 넣지 않는다(2026-09-30 실데이터 점검: 장르 표본이 많아 신뢰도 1.0이
    // 나오던 문제). 안정성을 계산할 수 없으면(표본 2 미만) 곱하지 않는다 — 이때는 표본 충족도가 이미 낮다.
    const programHit = levels.find((l) => l.level <= 3 && l.index !== null && l.n >= this.opts.minN);
    const programSampleCount = programHit?.n ?? 0;
    const confidence = Math.min(1, programSampleCount / this.opts.fullConfidenceN) * (stab ?? 1);
    levels.push({ level: 6, n: 0, index: 1 });
    return {
      expected: base === null ? null : idx * base,
      index: idx,
      baseline: base,
      fallbackLevel,
      sampleCount,
      programSampleCount,
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
  last_aired: string; // 창 안 마지막 방영일
  max_weekly_airings: number; // 한 주(월~일)에 가장 많이 방영된 횟수
  observed_slots: { dow: number; hour: number; n: number }[];
}

export interface AdjacencyStat {
  n: number;
  synergy: number | null; // 조건부 평균 지수 ÷ 전체 평균 지수(관측 연관, 효과 아님)
}

export interface FeatureSet {
  /** 회차가 다른 에피소드를 하루에도 여러 번 트는 시리즈(programId) — 프로그램 단위 반복 제한·연속 편성 감점 제외 */
  multiEpisodePrograms: Set<string>;
  /** 그중 회차 정보 없이 "하루 여러 번 도는" 패턴으로 판정한 순환 편성 프로그램(설정으로 켠 채널만) */
  rotationPrograms: Set<string>;
  /** 같은 시리즈 다음 회차를 바로 이어 붙였을 때(연속·연결 편성)의 관측 연관 — programId 기준 */
  selfLead: Map<string, AdjacencyStat>;
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

/** 회차가 다른 에피소드를 하루에도 여러 번 트는 시리즈 자동 판정(사용자 확인 2026-09-30: OLIFE 〈세계테마기행〉 주 43회·
 *  하루 7회, 〈극한직업〉 주 38회는 모두 다른 회차). 방영의 80% 이상에 회차·부제가 있고, 서로 다른 회차 수가 하루 최대
 *  방영 수 이상이면 해당. 이런 시리즈는 "같은 프로그램" 단위 반복 제한·연속 편성 감점을 적용하지 않는다 — 반복 규칙은
 *  같은 회차 기준(24시간 안 3회, 부제 반영 모드)이고, 이어지는 회차의 연속·연결 편성은 OLIFE의 강점 전략이다(사용자 설명).
 *  연속 편성이 실제로 잘 됐는지는 selfLead(관측 연관)로만 반영한다 — 임의 가산점 없음. */
export function detectMultiEpisodePrograms(airings: OwnAiring[]): Set<string> {
  // 회차 정보가 아예 수집되지 않은 날(원자료에 부제 열이 없던 기간 등)은 판정에서 뺀다 — 실데이터 확인(2026-09-30):
  // OLIFE 〈극한직업〉·〈한국기행〉은 7월 중순 며칠이 통째로 회차 정보 없음이라 12주 전체 비율이 70~77%로 낮게 나왔다.
  const infoDates = new Set(airings.filter((a) => a.episodeSubtitle || a.episodeNumber !== null).map((a) => a.date));
  const by = new Map<string, OwnAiring[]>();
  for (const a of airings) if (infoDates.has(a.date)) (by.get(a.programId) ?? by.set(a.programId, []).get(a.programId)!).push(a);
  const out = new Set<string>();
  for (const [pid, list] of by) {
    const withInfo = list.filter((a) => a.episodeSubtitle || a.episodeNumber !== null);
    if (list.length < 2 || withInfo.length < list.length * 0.8) continue;
    const eps = new Set(withInfo.map((a) => (a.episodeSubtitle ? normalizeProgramCanonicalName(a.episodeSubtitle) : "") || `#${a.episodeNumber}`));
    const perDay = new Map<string, number>();
    for (const a of list) perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
    const maxDaily = Math.max(...perDay.values());
    if (maxDaily >= 2 && eps.size >= maxDaily) out.add(pid);
  }
  return out;
}

/** 순환 편성 프로그램 판정(회차 정보 없는 채널용, 설정으로 켠 채널만). ENA STORY 주간편성표 확인(2026-09-30):
 *  〈기막힌 이야기 실제상황〉·〈한블리〉는 같은 회차를 하루 3~4회 돌리고 다음 날 다음 회로, 〈인간극장〉은 3회 묶음을
 *  저녁에 새로 편성하고 다음 날 아침 재방(하루 6회) — 닐슨에는 회차·본/재 표시가 없어 회차 기준 판정이 불가하다.
 *  그래서 "방영한 날 중 하루 2회 이상인 날"이 minDays일 이상이고 그 비율이 minRatio 이상이면 순환 편성으로 본다. */
export function detectRotationPrograms(airings: OwnAiring[], minDays: number, minRatio: number): Set<string> {
  const perProgDay = new Map<string, Map<string, number>>();
  for (const a of airings) {
    const m = perProgDay.get(a.programId) ?? perProgDay.set(a.programId, new Map()).get(a.programId)!;
    m.set(a.date, (m.get(a.date) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [pid, days] of perProgDay) {
    const multi = [...days.values()].filter((n) => n >= 2).length;
    if (multi >= minDays && multi / days.size >= minRatio) out.add(pid);
  }
  return out;
}

/** 같은 시리즈 다음 회차를 "이어 붙였다"고 보는 최대 간격(분). 실데이터(OLIFE)에서 연결 편성 사이에 10~18분짜리
 *  짧은 편성물이 끼는 경우가 대부분이라 20분으로 둔다(그 사이 다른 프로그램이 있어도 같은 시리즈의 연결 편성). */
export const EPISODE_CHAIN_GAP_MIN = 20;

/** 인접 방영(앞 방영 종료 ~ 다음 방영 시작 간격 5분 이내) 쌍의 관측 연관. */
function buildAdjacency(airings: OwnAiring[], rating: MetricModel, minN: number, multiEp: Set<string> = new Set(), rotation: Set<string> = new Set()) {
  const byDate = new Map<string, OwnAiring[]>();
  for (const a of airings) (byDate.get(a.date) ?? byDate.set(a.date, []).get(a.date)!).push(a);
  const idxOf = (a: OwnAiring): number | null => {
    if (a.kpi.r === null) return null;
    const b = rating.baseline(a.dow, hourBucket(a.startMin));
    return b !== null && b > 0 ? a.kpi.r / b : null;
  };
  const unitIdx = new Map<string, number[]>();
  const inRaw = new Map<string, Map<string, number[]>>();
  const progIdx = new Map<string, number[]>(); // programId → 방영별 지수(연속 회차 연관의 기준)
  const selfRaw = new Map<string, number[]>(); // programId → 같은 시리즈 앞 회차 바로 뒤에 나온 방영의 지수
  const outRaw = new Map<string, Map<string, number[]>>();
  for (const list of byDate.values()) {
    const sorted = [...list].sort((x, y) => x.startMin - y.startMin);
    for (const a of sorted) {
      const i = idxOf(a);
      if (i !== null) (unitIdx.get(unitKeyOf(a.programId, a.airingType)) ?? unitIdx.set(unitKeyOf(a.programId, a.airingType), []).get(unitKeyOf(a.programId, a.airingType))!).push(i);
      if (i !== null && multiEp.has(a.programId)) (progIdx.get(a.programId) ?? progIdx.set(a.programId, []).get(a.programId)!).push(i);
    }
    // 회차 시리즈의 다음 회차 연결 편성(같은 시리즈 앞 회차가 끝나고 EPISODE_CHAIN_GAP_MIN분 안에 다른 회차가 시작)
    const bySeries = new Map<string, OwnAiring[]>();
    for (const a of sorted) if (multiEp.has(a.programId)) (bySeries.get(a.programId) ?? bySeries.set(a.programId, []).get(a.programId)!).push(a);
    for (const [pid, s] of bySeries) {
      for (let j = 1; j < s.length; j++) {
        const p0 = s[j - 1];
        const n0 = s[j];
        if (p0.endMin === null || n0.startMin - p0.endMin < -5 || n0.startMin - p0.endMin > EPISODE_CHAIN_GAP_MIN) continue;
        // 순환 편성 프로그램은 회차 정보가 없어도 바로 이어 붙인 같은 프로그램을 다른 회차로 본다(같은 회를 연달아 틀지 않음)
        const noInfo = !p0.episodeSubtitle && p0.episodeNumber === null && !n0.episodeSubtitle && n0.episodeNumber === null;
        const differs = noInfo && rotation.has(pid) ? true : (p0.episodeSubtitle ?? `#${p0.episodeNumber}`) !== (n0.episodeSubtitle ?? `#${n0.episodeNumber}`);
        const ni0 = idxOf(n0);
        if (differs && ni0 !== null) (selfRaw.get(pid) ?? selfRaw.set(pid, []).get(pid)!).push(ni0);
      }
    }
    for (let j = 1; j < sorted.length; j++) {
      const prev = sorted[j - 1];
      const next = sorted[j];
      if (prev.endMin === null || Math.abs(next.startMin - prev.endMin) > 5) continue;
      const pu = unitKeyOf(prev.programId, prev.airingType);
      const nu = unitKeyOf(next.programId, next.airingType);
      if (prev.programId === next.programId && multiEp.has(next.programId)) continue; // 연결 편성은 아래에서 따로 센다
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
  const selfLead = new Map<string, AdjacencyStat>();
  for (const [pid, vals] of selfRaw) {
    const overall = mean(progIdx.get(pid) ?? []);
    const cond = mean(vals);
    selfLead.set(pid, { n: vals.length, synergy: vals.length >= minN && cond !== null && overall !== null && overall > 0 ? cond / overall : null });
  }
  return { leadIn: finalize(inRaw), leadOut: finalize(outRaw), selfLead };
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
    const perWeek = new Map<string, number>();
    for (const a of list) perWeek.set(mondayKey(a.date), (perWeek.get(mondayKey(a.date)) ?? 0) + 1);
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
      last_aired: list[list.length - 1].date,
      max_weekly_airings: Math.max(...perWeek.values()),
      observed_slots: [...slotDates]
        .map(([key, s]) => {
          const [dow, hour] = key.split("|").map(Number);
          return { dow, hour, n: s.size };
        })
        .sort((a, b) => a.dow - b.dow || a.hour - b.hour),
    });
  }

  const rotationPrograms = opts.rotation ? detectRotationPrograms(airings, opts.rotation.minDays, opts.rotation.minRatio) : new Set<string>();
  const multiEpisodePrograms = new Set([...detectMultiEpisodePrograms(airings), ...rotationPrograms]);
  const { leadIn, leadOut, selfLead } = buildAdjacency(airings, rating, opts.minN, multiEpisodePrograms, rotationPrograms);
  return {
    multiEpisodePrograms,
    rotationPrograms,
    selfLead,
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
