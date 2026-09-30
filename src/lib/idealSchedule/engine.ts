// 이상적 1주일 편성 엔진 진입점(순수 함수) — Feature → 후보 → Hard 제약 → 최적화 → 요약.
// DB 조회는 engineRunner.ts가 하고, 여기는 같은 입력이면 항상 같은 결과를 낸다(input_fingerprint로 확인).
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { buildCompetitorFeatures, strongestCompetitorBySlot, type CompetitorChannelFeature } from "./competitorFeatures";
import { targetKindOfLabel } from "./competitorTarget";
import { targetGroupForKpiLabel, type BenchmarkPlacement, type CompetitorTargetMode, type IdealScheduleConfig, type StructureMode } from "./config";
import { resolveHardConstraints, type ConstraintResolution, type HardConstraintInput } from "./constraints";
import { buildFeatureSet, eligibleAirings, type FeatureOptions, type FeatureSet } from "./features";
import { evaluateSchedule, optimizeWeek, type EngineOutput, type PlacedBlock } from "./optimizer";
import { buildCandidatePool, buildScoringContext, Scorer, strongSlotMap, type EngineCandidate, type StrategyMode } from "./scoring";
import { buildSkeleton, type SkeletonSlot } from "./skeleton";
import { addDays } from "./time";
import type { CompetitorBundle, Genre, OwnAiring, OwnAiringsBundle } from "./types";
import { UNCLASSIFIED } from "./types";

export type GenreResolver = (scope: "OWN" | "COMPETITOR", ownerKey: string, programName: string) => Genre;

export interface EngineRunInput {
  weekStart: string; // 대상 주 월요일
  asOfDate: string; // 보통 weekStart − 1(백테스트 누수 방지 기준일)
  mode: StructureMode;
  strategyMode: StrategyMode;
  competitorTargetMode?: CompetitorTargetMode; // 미지정 시 config 값
  benchmarkPlacement?: BenchmarkPlacement; // 미지정 시 config 값
  config: IdealScheduleConfig;
  bundle: OwnAiringsBundle; // 최적화 타깃을 바꾼 경우 withOptimizeTarget 적용 후 값
  channelKpiLabel?: string; // 채널 원래 KPI(미지정 = bundle.kpiLabel). 다르면 "타깃 선택 최적화"
  competitorBundle: CompetitorBundle | null;
  constraints: HardConstraintInput[];
  genreOf: GenreResolver;
}

export interface EngineSummary {
  requiredCount: number;
  lockedCount: number;
  manualOverrideCount: number;
  aiCount: number;
  benchmarkBlockCount: number;
  archetypeBlockCount: number;
  benchmarkCandidateCount: number;
  conflictCount: number;
  emptySlotCount: number;
  gapMinutes: number;
  avgConfidence: number | null; // 편성 분 가중
  expectedAvgRating: number | null; // 편성 분 가중, Benchmark 제외(설정으로 포함 가능)
  expectedAvgShare: number | null;
  expectedAvgTimeSpent: number | null;
  objective: number;
  optimizeTarget: { label: string; isChannelKpi: boolean }; // 이 편성안이 최적화한 타깃
  competitorTargets: { competitor: string; programTarget: string | null; programReason: string | null; dailyTarget: string | null; matchesOwnKpi: boolean | null }[];
  featureWindow: { from: string; to: string };
}

export interface EngineRunResult {
  output: EngineOutput;
  resolution: ConstraintResolution;
  summary: EngineSummary;
  skeleton: SkeletonSlot[];
  featureSet: FeatureSet;
  competitorFeatures: CompetitorChannelFeature[];
  fingerprint: string;
}

/** FNV-1a 32bit — 입력 지문(같은 입력·같은 설정 = 같은 지문 = 같은 결과). */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function featureOptionsFor(config: IdealScheduleConfig, kpiLabel: string, asOfDate: string, customTarget = false): FeatureOptions {
  const group = targetGroupForKpiLabel(config, kpiLabel);
  const e = config.expected_kpi;
  // 사용자가 고른 타깃으로 최적화할 때는 채널 KPI 기준 구성비(Target Audience)가 의미가 없어 제외하고 재정규화
  if (customTarget) return { ...featureOptionsFor(config, kpiLabel, asOfDate), composition: null, extraTargets: [] };
  return {
    asOfDate,
    lookbackDays: e.lookback_days,
    recentDays: e.recent_days,
    recentWeight: e.recent_weight,
    excludeHolidays: e.exclude_holidays,
    shrinkageK: e.shrinkage_k,
    minN: e.min_n,
    fullConfidenceN: e.full_confidence_n,
    composition: group.composition,
    extraTargets: group.extra,
  };
}

/** 제약 항목의 자사 후보 찾기: ① 프로그램 id(본방 → 태그 없음 → 재방 순) ② 이름 정규화 일치 ③ 이름 포함 관계가
 *  정확히 한 프로그램일 때만(예: 주요 콘텐츠 "케이팝업차트쇼" ↔ 닐슨 "ENA케이팝업차트쇼"). 모호하면 찾지 않는다. */
function ownCandidateFor(pool: EngineCandidate[], programId: string | null, programName?: string): EngineCandidate | null {
  const own = pool.filter((p) => p.contentType === "OWN");
  const pick = (pid: string) => {
    for (const t of ["FIRST", "UNTAGGED", "RERUN"]) {
      const c = own.find((p) => p.key === `${pid}|${t}`);
      if (c) return c;
    }
    return null;
  };
  if (programId) {
    const c = pick(programId);
    if (c) return c;
  }
  if (!programName) return null;
  const name = normalizeProgramCanonicalName(programName);
  if (!name) return null;
  const exact = [...new Set(own.filter((p) => normalizeProgramCanonicalName(p.programName) === name).map((p) => p.programKey))];
  if (exact.length === 1) return pick(exact[0]);
  const partial = [...new Set(own.filter((p) => { const n = normalizeProgramCanonicalName(p.programName); return n.includes(name) || name.includes(n); }).map((p) => p.programKey))];
  return partial.length === 1 ? pick(partial[0]) : null;
}

function newCandidate(name: string, programId: string | null, runtime: number | null, channelCode: string, genreOf: GenreResolver): EngineCandidate {
  const key = `NEW:${normalizeProgramCanonicalName(name)}`;
  return {
    key,
    programKey: programId ?? key,
    contentType: "OWN",
    programId,
    programName: name,
    airingType: "FIRST",
    genre: genreOf("OWN", channelCode, name),
    runtimeMin: runtime,
    sourceChannel: channelCode,
    aiEligible: false, // 필수 편성·실제 편성 재현용 — AI 후보 아님
    weeklyLimit: null,
  };
}

export function runIdealScheduleEngine(input: EngineRunInput): EngineRunResult {
  const { config, bundle } = input;
  const channelCode = bundle.channelCode;
  const channelKpi = input.channelKpiLabel ?? bundle.kpiLabel;
  const customTarget = channelKpi !== bundle.kpiLabel;
  const opts = featureOptionsFor(config, channelKpi, input.asOfDate, customTarget);
  const fs = buildFeatureSet(bundle, opts, (name) => input.genreOf("OWN", channelCode, name));

  // 경쟁사(선택 시)
  let competitorFeatures: CompetitorChannelFeature[] = [];
  let strong = null as ReturnType<typeof strongSlotMap> | null;
  if (input.competitorBundle && input.competitorBundle.airings.length + input.competitorBundle.daily.length > 0) {
    competitorFeatures = buildCompetitorFeatures(
      input.competitorBundle,
      {
        asOfDate: input.asOfDate,
        lookbackDays: config.expected_kpi.lookback_days,
        excludeHolidays: config.expected_kpi.exclude_holidays,
        holidays: new Set(bundle.holidays),
        shrinkageK: config.expected_kpi.shrinkage_k,
        minN: config.expected_kpi.min_n,
        ownKpiKind: targetKindOfLabel(bundle.kpiLabel),
        targetMode: input.competitorTargetMode ?? config.strategy.competitor_target_mode,
      },
      (competitor, name) => input.genreOf("COMPETITOR", competitor, name)
    );
    strong = strongSlotMap(strongestCompetitorBySlot(competitorFeatures), config.strategy.strong_threshold);
  }

  const scorer = new Scorer(buildScoringContext(fs, config, input.strategyMode, strong, opts.composition !== null));
  const placement = input.benchmarkPlacement ?? config.strategy.benchmark_placement;
  const pool = buildCandidatePool(fs, strong ? { channels: competitorFeatures, strong, minN: config.expected_kpi.min_n, placeable: placement === "MIX" } : null);

  // Hard 제약: 길이 미입력 항목은 그 프로그램의 실측 runtime 중앙값으로 채움(실측 없으면 비워 둬 경고)
  const filled = input.constraints.map((c) => {
    if (c.durationMin !== null) return c;
    const own = ownCandidateFor(pool, c.programId, c.programName);
    const derived = own?.runtimeMin !== null && own?.runtimeMin !== undefined ? Math.round(own.runtimeMin) : null;
    return { ...c, durationMin: derived, durationDerived: derived !== null };
  });
  const resolution = resolveHardConstraints(filled, input.weekStart);
  const fixedBlocks: PlacedBlock[] = resolution.fixed.map((f) => {
    const cand = ownCandidateFor(pool, f.input.programId, f.input.programName) ?? newCandidate(f.input.programName, f.input.programId, f.endMin - f.startMin, channelCode, input.genreOf);
    return {
      weekday: f.weekday,
      startMin: f.startMin,
      endMin: f.endMin,
      candidate: cand,
      status: f.input.rank === 1 ? (f.input.constraintType === "MANUAL_OVERRIDE" ? "MANUAL_OVERRIDE" : "LOCKED") : "REQUIRED",
      fixed: true,
      constraint: { id: f.input.id, source: f.input.source, constraintType: f.input.constraintType, rank: f.input.rank, durationDerived: f.input.durationDerived ?? false },
    };
  });

  const skeleton = buildSkeleton(eligibleAirings(bundle, opts), {
    asOfDate: input.asOfDate,
    weeks: config.structure.skeleton_weeks,
    gridMinutes: config.structure.grid_minutes,
    excludeHolidays: config.expected_kpi.exclude_holidays,
  }).slots;

  const archetypeRuntime = new Map<string, number>();
  for (const g of new Set(pool.filter((p) => p.contentType === "ARCHETYPE").map((p) => p.genre))) {
    const rts = pool.filter((p) => p.contentType === "OWN" && p.genre === g && p.runtimeMin !== null).map((p) => p.runtimeMin as number).sort((a, b) => a - b);
    if (rts.length) archetypeRuntime.set(g, rts[Math.floor(rts.length / 2)]);
  }

  const output = optimizeWeek({
    mode: input.mode,
    config,
    scorer,
    pool,
    resolution,
    fixedBlocks,
    skeleton,
    archetypeRuntime,
    benchmarkMaxShare: placement === "MIX" ? config.strategy.benchmark_max_share : 0,
  });

  // 요약
  const includeBm = config.strategy.include_benchmark_in_totals;
  let minSum = 0;
  let confSum = 0;
  const wavg = (pick: (b: (typeof output.blocks)[number]) => number | null) => {
    let num = 0;
    let den = 0;
    for (const b of output.blocks) {
      if (!includeBm && b.candidate.contentType === "COMPETITOR_BENCHMARK") continue;
      const v = pick(b);
      if (v === null) continue;
      num += v * (b.endMin - b.startMin);
      den += b.endMin - b.startMin;
    }
    return den > 0 ? num / den : null;
  };
  for (const b of output.blocks) {
    if (b.eval.expected === null) continue;
    minSum += b.endMin - b.startMin;
    confSum += b.eval.confidence * (b.endMin - b.startMin);
  }
  const summary: EngineSummary = {
    requiredCount: output.blocks.filter((b) => b.status === "REQUIRED").length,
    lockedCount: output.blocks.filter((b) => b.status === "LOCKED").length,
    manualOverrideCount: output.blocks.filter((b) => b.status === "MANUAL_OVERRIDE").length,
    aiCount: output.blocks.filter((b) => b.status === "AI").length,
    benchmarkBlockCount: output.blocks.filter((b) => b.candidate.contentType === "COMPETITOR_BENCHMARK").length,
    archetypeBlockCount: output.blocks.filter((b) => b.candidate.contentType === "ARCHETYPE").length,
    benchmarkCandidateCount: pool.filter((p) => p.contentType === "COMPETITOR_BENCHMARK").length,
    conflictCount: resolution.conflicts.length,
    emptySlotCount: output.emptySlots.length,
    gapMinutes: output.gaps.reduce((s, g) => s + (g.endMin - g.startMin), 0),
    avgConfidence: minSum > 0 ? confSum / minSum : null,
    expectedAvgRating: wavg((b) => b.eval.expected),
    expectedAvgShare: wavg((b) => b.eval.expectedShare),
    expectedAvgTimeSpent: wavg((b) => b.eval.expectedTimeSpent),
    objective: output.objective,
    optimizeTarget: { label: bundle.kpiLabel, isChannelKpi: !customTarget },
    competitorTargets: competitorFeatures.map((c) => ({
      competitor: c.competitor,
      programTarget: c.programTarget?.kind ?? null,
      programReason: c.programTarget?.reason ?? null,
      dailyTarget: c.dailyTarget?.label ?? null,
      matchesOwnKpi: c.programTarget?.matchesOwnKpi ?? null,
    })),
    featureWindow: { from: addDays(input.asOfDate, -(opts.lookbackDays - 1)), to: input.asOfDate },
  };

  const fp = fingerprint(
    JSON.stringify({
      weekStart: input.weekStart,
      asOf: input.asOfDate,
      mode: input.mode,
      strategy: input.strategyMode,
      ctm: input.competitorTargetMode ?? null,
      bp: input.benchmarkPlacement ?? null,
      config,
      target: bundle.kpiLabel,
      constraints: [...input.constraints].sort((a, b) => (a.id < b.id ? -1 : 1)),
      own: bundle.airings.filter((a) => a.date <= input.asOfDate),
      comp: input.competitorBundle ? input.competitorBundle.airings.filter((a) => a.date <= input.asOfDate) : null,
    })
  );

  return { output, resolution, summary, skeleton, featureSet: fs, competitorFeatures, fingerprint: fp };
}

/** 실제 방영 기록(특정 주)을 같은 목적함수로 평가할 수 있는 블록 목록으로 바꾼다 — 현재 편성 비교·백테스트용.
 *  방영 유형이 후보 풀에 없으면(표본 없음) 신규 후보로 만들어 장르·채널 baseline 기대값으로 평가된다. */
export function scheduleFromAirings(
  airings: OwnAiring[],
  weekStart: string,
  pool: EngineCandidate[],
  channelCode: string,
  genreOf: GenreResolver
): PlacedBlock[] {
  const weekEnd = addDays(weekStart, 6);
  return airings
    .filter((a) => a.date >= weekStart && a.date <= weekEnd && a.endMin !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin))
    .map((a) => {
      const key = `${a.programId}|${a.airingType}`;
      const cand = pool.find((p) => p.key === key) ?? { ...newCandidate(a.programName, a.programId, a.durationMin, channelCode, genreOf), key, programKey: a.programId, airingType: a.airingType };
      return { weekday: a.dow, startMin: a.startMin, endMin: a.endMin as number, candidate: cand, status: "AI" as const, fixed: false };
    });
}

export { evaluateSchedule, UNCLASSIFIED };
