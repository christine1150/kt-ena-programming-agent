// 후보·블록 점수(설계 문서 G-3, H-3). 순수 함수 + 메모이제이션.
//
// 블록 가치 value = fitness_adj × 목표 슬롯 baseline × 방영 분 × (1 − 패널티 합)
//   - fitness = Σ w_i·c_i / Σ w_i  (근거 없는 항목은 빼고 남은 가중치로 재정규화 — 0으로 채우지 않음)
//     c_kpi = 기대 지수(Expected ÷ baseline), c_target = 구성비 지수, c_weekday_slot = 요일×시 적합도,
//     c_trend = 최근4주÷12주 지수(0~2), c_stability = 안정성 ÷ 채널 중앙값(0~2), c_lead = 앞 프로그램과의
//     관측 연관(lead-in/lead-out 시너지 평균). 모두 "채널 평균 = 1" 척도.
//   - fitness_adj = fitness × (1 + 전략 가중) — MATCH/COUNTER/MIX 모드에서 경쟁 강세 슬롯에만 적용
//   - 즉 fitness가 1이면 value = 기대 시청률 × 분(시청률-분). 프라임처럼 baseline이 큰 슬롯일수록 비중이 크다.
// 모든 상수(가중치·패널티·전략 가중)는 ideal_schedule_config에서 온다.
import type { IdealScheduleConfig } from "./config";
import type { CompetitorChannelFeature } from "./competitorFeatures";
import type { ExpectedResult, FeatureSet } from "./features";
import { addDays, hourBucket } from "./time";
import type { AiringType, Genre } from "./types";
import { UNCLASSIFIED, genreFamily } from "./types";
import { bandForLevel, standardError, type UncertaintyBasis, type UncertaintyModel } from "./uncertainty";

export type ContentType = "OWN" | "COMPETITOR_BENCHMARK" | "ARCHETYPE";
export type StrategyMode = "AUTO" | "MATCH" | "COUNTER" | "MIX";
export type StrategyType = "MATCH" | "COUNTER" | "NEUTRAL";

export interface EngineCandidate {
  key: string; // OWN: programId|airingType, BM:경쟁사|프로그램, AR:장르, NEW:프로그램명
  programKey: string; // 반복 cap·연속·같은 시 반복 판정 단위(자사는 programId — 본방/재방을 같은 프로그램으로 셈)
  contentType: ContentType;
  programId: string | null;
  programName: string;
  airingType: AiringType;
  genre: Genre;
  runtimeMin: number | null; // ARCHETYPE은 null(슬롯 길이에 맞춤)
  sourceChannel: string;
  /** AI가 새로 배치할 수 있는 후보인가. 표본 부족(최소 표본 미만)·종영된 본방은 false — 기존 틀 모드의 현재 편성
   *  프로그램(슬롯 점유)과 필수 편성으로만 쓰인다. */
  aiEligible: boolean;
  /** 이 후보 단위(본방 등)의 주간 최대 편성 수 — 본방은 관측된 주간 최대 방영 수 이내(신규 회차 공급 한계). null = 제한 없음 */
  weeklyLimit: number | null;
  benchmark?: {
    competitor: string;
    index: number; // 표본 수 수축 후 지수(기대값 계산에 사용)
    rawIndex: number; // 수축 전 원지수(설명용)
    n: number;
    targetKind: "2049" | "HOUSEHOLD";
    targetMatchesOwnKpi: boolean;
  };
}

export interface StrongSlotInfo {
  competitor: string;
  strength: number;
  dominantGenre: Genre;
  targetMatchesOwnKpi: boolean;
}

export interface ScoringContext {
  fs: FeatureSet;
  config: IdealScheduleConfig;
  strategyMode: StrategyMode;
  strongSlots: Map<string, StrongSlotInfo> | null; // "dow|hour" → 선택 경쟁사 중 최강(경쟁사 미선택이면 null)
  channelMedianStability: number | null;
  hasComposition: boolean;
  /** 예상 범위·표준오차용 오차 배율 분포(없으면 범위를 만들지 않는다) */
  uncertainty: UncertaintyModel | null;
}

export interface Reason {
  code: string;
  value: number | string | null;
  detail?: string;
}

export interface BlockEval {
  expected: number | null;
  expectedShare: number | null;
  expectedTimeSpent: number | null;
  expectedKpiType: "HISTORICAL_EXPECTED" | "BENCHMARK_TRANSFER";
  baseline: number | null;
  confidence: number;
  sampleCount: number;
  programSampleCount: number;
  fallbackLevel: number;
  /** 예상 범위(기대값 × 과거 오차 배율 분위) — 오차 자료가 없으면 null */
  range: { low: number; high: number; basis: UncertaintyBasis } | null;
  /** 평균 추정 표준오차(유지/교체 판단·확실도용) */
  se: number | null;
  components: Record<string, number | null>;
  fitness: number;
  strategy: {
    type: StrategyType;
    competitorSlotStrength: number | null;
    competitor: string | null;
    dominantGenre: Genre | null;
    benchmarkIndex: number | null;
    matchScore: number;
    counterScore: number;
    bonus: number;
  };
  penalties: Record<string, number>;
  value: number;
  reasons: Reason[];
}

export interface PlacementContext {
  weekday: number;
  startMin: number;
  endMin: number;
  prevKey: string | null; // 직전 블록 후보 key(lead 연관 조회용)
  prevProgramKey: string | null; // 직전 블록 프로그램 key(연속 편성 판정용)
  fixed: boolean; // 고정 블록은 패널티 없음
  sameSlotOtherDays: number; // 같은 후보가 다른 요일 같은 시에 놓인 횟수
  dayGenreShare: number; // 이 후보 장르의 그날 편성 분 비중(0~1, 미분류 0)
  /** 같은 프로그램이 EPISODE_CHAIN_GAP_MIN분 안에 앞에 있음(사이에 짧은 편성물이 있어도) — 회차 시리즈 연결 편성 판정용.
   *  없으면 바로 앞 블록이 같은 프로그램인지로 판정 */
  episodeChain?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildScoringContext(
  fs: FeatureSet,
  config: IdealScheduleConfig,
  strategyMode: StrategyMode,
  strongSlots: Map<string, StrongSlotInfo> | null,
  hasComposition: boolean,
  uncertainty: UncertaintyModel | null = null
): ScoringContext {
  const stabs = fs.units.map((u) => u.stability_index).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const mid = Math.floor(stabs.length / 2);
  const med = stabs.length === 0 ? null : stabs.length % 2 ? stabs[mid] : (stabs[mid - 1] + stabs[mid]) / 2;
  return { fs, config, strategyMode, strongSlots, channelMedianStability: med, hasComposition, uncertainty };
}

/** 경쟁 선택 시 강세 슬롯 맵(strongestCompetitorBySlot 결과를 threshold로 거른 것). */
export function strongSlotMap(
  strongest: Map<string, { competitor: string; strength: number; dominantGenre: Genre; targetMatchesOwnKpi: boolean }>,
  threshold: number
): Map<string, StrongSlotInfo> {
  const out = new Map<string, StrongSlotInfo>();
  for (const [k, v] of strongest) if (v.strength >= threshold) out.set(k, v);
  return out;
}

/** 후보 풀: 자사 프로그램 + (경쟁 선택 시) Benchmark·Archetype. 정렬 고정(결정론). */
export function buildCandidatePool(
  fs: FeatureSet,
  competitor: { channels: CompetitorChannelFeature[]; strong: Map<string, StrongSlotInfo>; minN: number; placeable: boolean; include: boolean } | null
): EngineCandidate[] {
  const pool: EngineCandidate[] = [];
  // 본방(<본>) 단위는 "지금 방영 중"(기준일 전 7일 안에 본방이 있었음)일 때만 AI 후보 — 종영 시리즈의 본방 성적으로
  // 재방 슬롯을 채우는 과대평가 방지(2026-09-30 실데이터 점검: 종영 드라마가 본방 성적으로 월 21시에 배치됨).
  const activeFrom = addDays(fs.options.asOfDate, -6);
  for (const u of fs.units) {
    if (u.valid_measurement_count === 0 || u.runtime_median_min === null) continue;
    const endedFirstRun = u.airingType === "FIRST" && u.last_aired < activeFrom;
    pool.push({
      key: u.unitKey,
      programKey: u.programId,
      contentType: "OWN",
      programId: u.programId,
      programName: u.programName,
      airingType: u.airingType,
      genre: u.genre,
      runtimeMin: u.runtime_median_min,
      sourceChannel: fs.channelCode,
      aiEligible: u.valid_measurement_count >= fs.options.minN && !endedFirstRun,
      weeklyLimit: u.airingType === "FIRST" ? u.max_weekly_airings : null,
    });
  }
  // 경쟁 프로그램·장르 원형은 사용자가 Benchmark 옵션을 켰을 때만(include) 후보에 넣는다 — 기본(NONE)은 자사만
  if (competitor && competitor.include) {
    for (const ch of competitor.channels) {
      if (!ch.programTarget) continue;
      for (const p of ch.programs) {
        if (p.benchmark_index === null || p.n < competitor.minN || p.runtime_median_min === null) continue;
        // 자사 기대값과 같은 방식으로 표본 수만큼 1(경쟁채널 평균) 쪽으로 수축 — 방영 몇 번뿐인 히트작의 큰 지수가
        // 그대로 전이되지 않게 한다(2026-09-30 실데이터 점검: 수축 없이 전이하면 경쟁 프로그램이 편성을 압도).
        const k = fs.options.shrinkageK;
        const shrunk = (p.n * p.benchmark_index + k) / (p.n + k);
        pool.push({
          key: `BM:${ch.competitor}|${p.programName}`,
          programKey: `BM:${ch.competitor}|${p.programName}`,
          contentType: "COMPETITOR_BENCHMARK",
          programId: null,
          programName: p.programName,
          airingType: "UNTAGGED",
          genre: p.genre,
          runtimeMin: p.runtime_median_min,
          sourceChannel: ch.competitor,
          aiEligible: competitor.placeable,
          weeklyLimit: null,
          benchmark: {
            competitor: ch.competitor,
            index: shrunk,
            rawIndex: p.benchmark_index,
            n: p.n,
            targetKind: ch.programTarget.kind,
            targetMatchesOwnKpi: ch.programTarget.matchesOwnKpi,
          },
        });
      }
    }
    const genres = [...new Set([...competitor.strong.values()].map((s) => s.dominantGenre))].filter((g) => g !== UNCLASSIFIED).sort();
    for (const g of genres) {
      pool.push({
        key: `AR:${g}`,
        programKey: `AR:${g}`,
        contentType: "ARCHETYPE",
        programId: null,
        programName: `${g} 신규 편성(장르 원형)`,
        airingType: "UNTAGGED",
        genre: g,
        runtimeMin: null,
        sourceChannel: fs.channelCode,
        aiEligible: competitor.placeable,
        weeklyLimit: null,
      });
    }
  }
  return pool.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

type ExpectedBundle = { r: ExpectedResult; s: ExpectedResult; ts: ExpectedResult; programIdForModel: string };

/** 점수 계산기 — 같은 (후보, 요일, 시) 기대값은 한 번만 계산한다. */
export class Scorer {
  private readonly cache = new Map<string, ExpectedBundle>();
  /** true일 때만 선정 이유(reasons)를 만든다 — 탐색 중에는 끄고 최종 평가·대체 후보 계산 때만 켠다(속도). */
  detail = true;
  constructor(readonly ctx: ScoringContext) {}

  private expectedFor(c: EngineCandidate, dow: number, hour: number): ExpectedBundle {
    const k = `${c.key}|${dow}|${hour}`;
    const hit = this.cache.get(k);
    if (hit) return hit;
    // 자사 프로그램은 자기 이력, 신규(NEW)·원형(AR)은 이력 없는 가상 id로 장르→채널 단계 폴백
    const pid = c.contentType === "OWN" && c.programId ? c.programId : `__${c.key}__`;
    const { fs } = this.ctx;
    const out: ExpectedBundle = {
      r: fs.rating.expected(pid, c.airingType, c.genre, dow, hour),
      s: fs.share.expected(pid, c.airingType, c.genre, dow, hour),
      ts: fs.timeSpent.expected(pid, c.airingType, c.genre, dow, hour),
      programIdForModel: pid,
    };
    this.cache.set(k, out);
    return out;
  }

  leadSynergy(prevKey: string | null, curKey: string): number | null {
    if (!prevKey || prevKey === curKey) return null;
    const vals = [this.ctx.fs.leadIn.get(curKey)?.get(prevKey)?.synergy, this.ctx.fs.leadOut.get(prevKey)?.get(curKey)?.synergy].filter(
      (v): v is number => v !== null && v !== undefined
    );
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  evaluate(c: EngineCandidate, p: PlacementContext): BlockEval {
    const { config, fs } = this.ctx;
    const hour = hourBucket(p.startMin);
    const minutes = Math.max(0, p.endMin - p.startMin);
    const w = config.weights;
    const reasons: Reason[] = [];
    const addReason = (r: Reason) => {
      if (this.detail) reasons.push(r);
    };
    const components: Record<string, number | null> = { kpi: null, target: null, weekday_slot: null, trend: null, stability: null, lead: null };

    let expected: number | null;
    let expectedShare: number | null = null;
    let expectedTimeSpent: number | null = null;
    let expectedKpiType: BlockEval["expectedKpiType"] = "HISTORICAL_EXPECTED";
    let baseline: number | null;
    let confidence: number;
    let sampleCount: number;
    let programSampleCount: number;
    let fallbackLevel: number;

    if (c.contentType === "COMPETITOR_BENCHMARK" && c.benchmark) {
      // 경쟁 프로그램의 자사 편성 시 시청률은 관측 불가 — "경쟁채널 자기 기준 지수를 자사 슬롯 baseline에
      // 옮긴다"는 가정(BENCHMARK_TRANSFER)을 명시하고 신뢰도 상한을 둔다(사용자 결정 2026-09-30).
      baseline = fs.rating.baseline(p.weekday, hour);
      expected = baseline === null ? null : baseline * c.benchmark.index;
      expectedKpiType = "BENCHMARK_TRANSFER";
      const cap = config.strategy.benchmark_confidence_cap;
      confidence = cap * Math.min(1, c.benchmark.n / config.expected_kpi.full_confidence_n);
      if (!c.benchmark.targetMatchesOwnKpi) confidence *= 1 - config.strategy.target_mismatch_penalty;
      sampleCount = c.benchmark.n;
      programSampleCount = 0; // 자사 편성 이력 없음 — 범위·표준오차는 가장 넓은(근거 C) 기준
      fallbackLevel = 0;
      components.kpi = c.benchmark.index;
      addReason({ code: "BENCHMARK_TRANSFER_ASSUMPTION", value: c.benchmark.index, detail: `${c.benchmark.competitor} 자기 기준 지수 × 자사 슬롯 baseline(가정)` });
      addReason({ code: "BENCHMARK_TARGET", value: c.benchmark.targetKind, detail: c.benchmark.targetMatchesOwnKpi ? "자사 KPI와 같은 타깃" : "자사 KPI와 다른 타깃(신뢰도 감점)" });
    } else {
      const e = this.expectedFor(c, p.weekday, hour);
      expected = e.r.expected;
      expectedShare = e.s.expected;
      expectedTimeSpent = e.ts.expected;
      baseline = e.r.baseline;
      confidence = e.r.confidence;
      sampleCount = e.r.sampleCount;
      programSampleCount = e.r.programSampleCount;
      fallbackLevel = e.r.fallbackLevel;
      components.kpi = e.r.index;
      addReason({ code: "EXPECTED_LEVEL", value: e.r.fallbackLevel, detail: `표본 ${e.r.sampleCount}건` });
      for (const l of e.r.levels) if (l.index !== null && l.n > 0) addReason({ code: `LEVEL_${l.level}_INDEX`, value: l.index, detail: `n=${l.n}` });

      if (c.contentType === "OWN" && c.programId) {
        const u = fs.unitsByKey.get(c.key);
        if (u) {
          if (this.ctx.hasComposition && u.target_fit !== null) components.target = u.target_fit;
          const ws = fs.rating.weekdaySlotFit(c.programId, c.airingType, p.weekday, hour);
          if (ws) components.weekday_slot = ws.fit;
          if (u.trend_index !== null) components.trend = clamp(u.trend_index, 0, 2);
          if (u.stability_index !== null && this.ctx.channelMedianStability && this.ctx.channelMedianStability > 0) {
            components.stability = clamp(u.stability_index / this.ctx.channelMedianStability, 0, 2);
          }
          addReason({ code: "AVG_12W", value: u.avg_rating_12w });
          if (u.recent_4w_performance !== null) addReason({ code: "RECENT_4W_INDEX", value: u.recent_4w_performance });
          if (ws) addReason({ code: "WEEKDAY_SLOT_FIT", value: ws.fit, detail: `같은 요일×시 ${ws.n}회` });
          if (u.target_fit !== null && this.ctx.hasComposition) addReason({ code: "TARGET_FIT", value: u.target_fit });
          if (u.stability_index !== null) addReason({ code: "STABILITY", value: u.stability_index });
        }
      }
    }

    // 회차 시리즈가 앞 회차 바로 뒤에 이어지면(연속·연결 편성) 그 시리즈의 "연속 회차 관측 연관"을 lead로 쓴다
    const multiEp = c.contentType === "OWN" && c.programId !== null && fs.multiEpisodePrograms.has(c.programId);
    const chain = multiEp && (p.episodeChain ?? p.prevProgramKey === c.programKey);
    const lead = chain ? (fs.selfLead.get(c.programKey)?.synergy ?? null) : this.leadSynergy(p.prevKey, c.key);
    if (lead !== null) {
      components.lead = clamp(lead, 0, 2);
      addReason(
        chain
          ? { code: "EPISODE_CHAIN", value: lead, detail: `같은 시리즈 다음 회차 연속 편성 ${fs.selfLead.get(c.programKey)?.n ?? 0}회 관측(효과 아님)` }
          : { code: "LEAD_SYNERGY", value: lead, detail: `앞 편성 ${p.prevKey}와의 관측 연관(효과 아님)` }
      );
    }

    const weightOf: Record<string, number> = { kpi: w.kpi, target: w.target, weekday_slot: w.weekday_slot, trend: w.trend, stability: w.stability, lead: w.lead };
    let num = 0;
    let den = 0;
    for (const [name, v] of Object.entries(components)) {
      if (v === null) continue;
      num += weightOf[name] * v;
      den += weightOf[name];
    }
    const fitness = den > 0 ? num / den : 1;

    // 전략(경쟁 강세 슬롯)
    const strong = this.ctx.strongSlots?.get(`${p.weekday}|${hour}`) ?? null;
    let type: StrategyType = "NEUTRAL";
    let bonus = 0;
    let matchScore = 0;
    let counterScore = 0;
    if (strong && strong.dominantGenre !== UNCLASSIFIED && c.genre !== UNCLASSIFIED) {
      // 상위 장르 묶음 기준(오리지널 드라마 ↔ 드라마 = 같은 계열)
      const isMatch = genreFamily(c.genre) === genreFamily(strong.dominantGenre);
      type = isMatch ? "MATCH" : "COUNTER";
      matchScore = isMatch ? fitness : 0;
      counterScore = isMatch ? 0 : fitness;
      const s = this.ctx.config.strategy;
      if (this.ctx.strategyMode === "MATCH" && isMatch) bonus = s.match_weight;
      else if (this.ctx.strategyMode === "COUNTER" && !isMatch) bonus = s.counter_weight;
      else if (this.ctx.strategyMode === "MIX") bonus = isMatch ? s.match_weight : s.counter_weight;
      // AUTO: 가산 없음 — 적합도가 높은 쪽이 그대로 선택되고, 결과가 MATCH인지 COUNTER인지 기록만 한다.
      addReason({ code: `STRATEGY_${type}`, value: strong.strength, detail: `${strong.competitor} 강세(${strong.dominantGenre})` });
    }

    // 패널티(고정 블록은 적용하지 않음)
    const r = this.ctx.config.repeat_rules;
    const penalties: Record<string, number> = {};
    if (!p.fixed) {
      // 회차 시리즈의 다음 회차 연속 편성은 감점하지 않는다(OLIFE 강점 전략 — 사용자 설명 2026-09-30)
      if (p.prevProgramKey && p.prevProgramKey === c.programKey && !multiEp) penalties.consecutive = r.consecutive_penalty;
      if (p.sameSlotOtherDays > 0) penalties.same_slot = r.same_slot_penalty * p.sameSlotOtherDays;
      if (c.genre !== UNCLASSIFIED && p.dayGenreShare > 0) penalties.genre_concentration = r.genre_concentration_penalty * p.dayGenreShare;
      penalties.low_confidence = r.low_confidence_penalty * (1 - confidence);
      if (c.runtimeMin !== null && minutes > 0) penalties.runtime_mismatch = r.runtime_mismatch_penalty * Math.min(1, Math.abs(c.runtimeMin - minutes) / minutes);
    }
    const penaltySum = Math.min(0.95, Object.values(penalties).reduce((a, b) => a + b, 0));
    const value = expected === null || baseline === null ? 0 : fitness * (1 + bonus) * baseline * minutes * (1 - penaltySum);

    // 예상 범위·표준오차(경쟁 가상 편성은 근거 C 기준 — 단계 0을 6으로 본다)
    const unc = this.ctx.uncertainty;
    const rangeLevel = fallbackLevel === 0 ? 6 : fallbackLevel;
    const band = bandForLevel(unc, rangeLevel);
    const range = unc && band && expected !== null ? { low: expected * band.qLow, high: expected * band.qHigh, basis: unc.basis } : null;
    const se = standardError(unc, expected, programSampleCount, config.expected_kpi.shrinkage_k, rangeLevel);

    return {
      expected,
      expectedShare,
      expectedTimeSpent,
      expectedKpiType,
      baseline,
      confidence,
      sampleCount,
      programSampleCount,
      fallbackLevel,
      range,
      se,
      components,
      fitness,
      strategy: {
        type,
        competitorSlotStrength: strong?.strength ?? null,
        competitor: strong?.competitor ?? null,
        dominantGenre: strong?.dominantGenre ?? null,
        benchmarkIndex: c.benchmark?.index ?? null,
        matchScore,
        counterScore,
        bonus,
      },
      penalties,
      value,
      reasons,
    };
  }
}
