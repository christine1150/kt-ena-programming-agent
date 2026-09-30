// 이상적 1주일 편성 엔진 진입점(순수 함수) — Feature → 후보 → Hard 제약 → 최적화 → 요약.
// DB 조회는 engineRunner.ts가 하고, 여기는 같은 입력이면 항상 같은 결과를 낸다(input_fingerprint로 확인).
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { buildCompetitorFeatures, strongestCompetitorBySlot, type CompetitorChannelFeature } from "./competitorFeatures";
import { targetKindOfLabel } from "./competitorTarget";
import { targetGroupForKpiLabel, type BenchmarkPlacement, type CompetitorTargetMode, type IdealScheduleConfig, type StructureMode } from "./config";
import { resolveHardConstraints, type ConstraintResolution, type HardConstraintInput } from "./constraints";
import { buildFeatureSet, eligibleAirings, type FeatureOptions, type FeatureSet } from "./features";
import { evaluateSchedule, optimizeWeek, type EngineOutput, type EvaluatedBlock, type PlacedBlock } from "./optimizer";
import { buildCandidatePool, buildScoringContext, Scorer, strongSlotMap, type EngineCandidate, type StrategyMode } from "./scoring";
import { buildSkeleton, type SkeletonSlot } from "./skeleton";
import { addDays } from "./time";
import { assignEpisodes, buildEpisodeStats, isEpisodicProgram, observedProgramMaxima, type EpisodeMode } from "./episodes";
import type { CompetitorBundle, Genre, OwnAiring, OwnAiringsBundle } from "./types";
import { UNCLASSIFIED, genreFamily } from "./types";

export type GenreResolver = (scope: "OWN" | "COMPETITOR", ownerKey: string, programName: string) => Genre;

export interface EngineRunInput {
  weekStart: string; // 대상 주 월요일
  asOfDate: string; // 보통 weekStart − 1(백테스트 누수 방지 기준일)
  mode: StructureMode;
  strategyMode: StrategyMode;
  competitorTargetMode?: CompetitorTargetMode; // 미지정 시 config 값
  benchmarkPlacement?: BenchmarkPlacement; // 미지정 시 config 값
  episodeMode?: EpisodeMode; // 부제 반영(EPISODE) / 미반영(PROGRAM, 기본)
  config: IdealScheduleConfig;
  bundle: OwnAiringsBundle; // 최적화 타깃을 바꾼 경우 withOptimizeTarget 적용 후 값
  channelKpiLabel?: string; // 채널 원래 KPI(미지정 = bundle.kpiLabel). 다르면 "타깃 선택 최적화"
  competitorBundle: CompetitorBundle | null;
  constraints: HardConstraintInput[];
  /** 길이 미입력 제약의 과거 방영 길이(분, 제약 id → 중앙값) — 최근 12주 밖(작년 편성 등) 이력. 러너가 DB에서 채운다. */
  historicalRuntime?: Record<string, { min: number; from: string }>;
  genreOf: GenreResolver;
  /** 같은 모델(같은 as_of)로 평가할 실제 편성들 — CURRENT(비교 기준)·백테스트 실제 주. 방영 기록은 편성 구조와
   *  실측 비교에만 쓰이고 모델(Feature)에는 들어가지 않는다(누수 없음). */
  evaluateAirings?: { label: string; weekStart: string; airings: OwnAiring[] }[];
}

export interface ScheduleEvaluationResult {
  weekStart: string;
  rows: { block: EvaluatedBlock; actual: { r: number | null; s: number | null; ts: number | null } }[];
  objective: number;
  expectedAvgRating: number | null;
  actualAvgRating: number | null;
  expectedAvgShare: number | null;
  actualAvgShare: number | null;
  expectedAvgTimeSpent: number | null;
  actualAvgTimeSpent: number | null;
  calibration: { mae: number | null; bias: number | null; n: number };
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
  episodeMode: EpisodeMode;
  episodePrograms: string[];
  episodeAssigned: number;
  episodeUnassigned: number;
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
  evaluations: Record<string, ScheduleEvaluationResult>;
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
  const partialCands = own.filter((p) => { const n = normalizeProgramCanonicalName(p.programName); return n.includes(name) || name.includes(n); });
  const partial = [...new Set(partialCands.map((p) => p.programKey))];
  if (partial.length === 1) return pick(partial[0]);
  if (partial.length === 0) return null;
  // 여러 프로그램이 걸리면(예: 〈트렌드다큐도시락〉 ↔ 닐슨 〈락트렌드다큐도시락〉·〈…스페셜〉) 스페셜·특집을 빼고
  // 이름 길이가 가장 가까운 하나를 고른다. 이름 길이 차이가 같은 후보가 둘이면 모호하므로 찾지 않는다.
  const special = /스페셜|특집|몰아보기|하이라이트|베스트/;
  const wantsSpecial = special.test(name);
  const byName = new Map<string, string>(); // programKey → 정규화 이름
  for (const p of partialCands) byName.set(p.programKey, normalizeProgramCanonicalName(p.programName));
  const ranked = [...byName]
    .filter(([, n]) => wantsSpecial || !special.test(n))
    .map(([key, n]) => ({ key, gap: Math.abs(n.length - name.length) }))
    .sort((a, b) => a.gap - b.gap || (a.key < b.key ? -1 : 1));
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0].gap === ranked[1].gap)) return null;
  return pick(ranked[0].key);
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
  const pool = buildCandidatePool(fs, strong ? { channels: competitorFeatures, strong, minN: config.expected_kpi.min_n, placeable: placement === "MIX", include: placement !== "NONE" } : null);

  // Hard 제약: 길이 미입력 항목은 ① 최근 12주 그 프로그램 실측 runtime 중앙값 → ② 12주 밖 과거 방영 길이(작년 편성 등)
  // → ③ 같은 채널 같은 장르(오리지널 드라마 등) 프로그램의 기존 길이 중앙값 순으로 채운다(사용자 지시 2026-09-30:
  // "오리지널 드라마 기존 듀레이션으로 일단 계산, 작년에 편성했던 프로그램은 찾아서 배치"). 셋 다 없으면 비워 경고.
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const durationNotes = new Map<string, string>(); // 제약 id → 안내 문구
  const filled = input.constraints.map((c) => {
    if (c.durationMin !== null) return c;
    const own = ownCandidateFor(pool, c.programId, c.programName);
    if (own?.runtimeMin !== null && own?.runtimeMin !== undefined) return { ...c, durationMin: Math.round(own.runtimeMin), durationDerived: true };
    const hist = input.historicalRuntime?.[c.id];
    if (hist) {
      const basis = `과거 방영 이력(${hist.from}) 기준 ${Math.round(hist.min)}분`;
      durationNotes.set(c.id, `'${c.programName}' 길이를 ${basis}으로 계산했습니다.`);
      return { ...c, durationMin: Math.round(hist.min), durationDerived: true, durationBasis: basis };
    }
    const g = input.genreOf("OWN", channelCode, c.programName);
    if (g !== UNCLASSIFIED) {
      const same = (family: boolean) =>
        pool.filter((p) => p.contentType === "OWN" && p.runtimeMin !== null && (family ? genreFamily(p.genre) === genreFamily(g) : p.genre === g)).map((p) => p.runtimeMin as number);
      const m = median(same(false)) ?? median(same(true));
      if (m !== null) {
        const basis = `같은 채널 ${g} 기존 길이 ${Math.round(m)}분`;
        durationNotes.set(c.id, `'${c.programName}'은 방영 이력이 없어 ${basis}으로 계산했습니다. 실제 길이가 다르면 '필수 편성'에 입력해 주세요.`);
        return { ...c, durationMin: Math.round(m), durationDerived: true, durationBasis: basis };
      }
    }
    return c;
  });
  const resolution = resolveHardConstraints(filled, input.weekStart);
  // 길이를 추정해 실제로 배치된 항목만 안내(요일별로 같은 문구가 반복되지 않게 중복 제거)
  resolution.warnings.push(...new Set(resolution.fixed.map((f) => durationNotes.get(f.input.id)).filter((n): n is string => !!n)));
  const fixedBlocks: PlacedBlock[] = resolution.fixed.map((f) => {
    const cand =
      (f.input.candidateKey ? pool.find((p) => p.key === f.input.candidateKey) : undefined) ??
      ownCandidateFor(pool, f.input.programId, f.input.programName) ??
      newCandidate(f.input.programName, f.input.programId, f.endMin - f.startMin, channelCode, input.genreOf);
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

  // 부제 반영 모드: 설정된 에피소드 시리즈는 프로그램 한도를 관측 최대치로, 반복은 에피소드 단위로
  const episodeMode: EpisodeMode = input.episodeMode ?? "PROGRAM";
  const episodicIds = new Set(
    episodeMode === "EPISODE" ? fs.units.filter((u) => isEpisodicProgram(config, channelCode, u.programName)).map((u) => u.programId) : []
  );
  const eligible = eligibleAirings(bundle, opts);
  const programCapOverride = episodicIds.size ? observedProgramMaxima(eligible, episodicIds) : undefined;

  const output = optimizeWeek({
    programCapOverride,
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

  // 에피소드 배정(부제 반영 모드) — 최적화가 정한 블록(필수 편성 포함)에 구체적 에피소드를 붙인다
  let episodeAssigned = 0;
  let episodeUnassigned = 0;
  if (episodicIds.size) {
    const stats = buildEpisodeStats(eligible, fs.rating, episodicIds);
    const targets = output.blocks
      .map((b, id) => ({ b, id }))
      .filter(({ b }) => b.candidate.programId !== null && episodicIds.has(b.candidate.programId));
    const assigned = assignEpisodes(
      targets.map(({ b, id }) => ({ id, programId: b.candidate.programId as string, weekday: b.weekday, startMin: b.startMin, value: b.eval.value, expected: b.eval.expected })),
      stats,
      (pid) => fs.rating.rawIndex(`p|${pid}`).index,
      {
        weekStart: input.weekStart,
        cycleMax: config.structure.episode_cycle_max ?? 3,
        cycleHours: config.structure.episode_cycle_hours ?? 24,
        restDays: config.structure.episode_rest_days ?? 0,
        periods: config.structure.episode_periods ?? null,
        repeatWithinPeriod: config.structure.episode_repeat_within_period ?? false,
        shrinkageK: config.expected_kpi.shrinkage_k,
      }
    );
    for (const { b, id } of targets) {
      const a = assigned.get(id);
      if (!a) continue;
      b.episode = a;
      if ("none" in a) episodeUnassigned++;
      else episodeAssigned++;
    }
  }

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
    episodeMode,
    episodePrograms: [...episodicIds].map((pid) => fs.units.find((u) => u.programId === pid)?.programName ?? pid),
    episodeAssigned,
    episodeUnassigned,
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
      // 지문은 "실제 적용값" 기준 — 기본값을 명시했든 생략했든 같은 입력이면 같은 지문
      ctm: input.competitorTargetMode ?? config.strategy.competitor_target_mode,
      bp: placement,
      em: input.episodeMode ?? "PROGRAM",
      comps: input.competitorBundle ? [...new Set(input.competitorBundle.airings.map((a) => a.competitor))].sort() : [],
      config,
      target: bundle.kpiLabel,
      constraints: [...input.constraints].sort((a, b) => (a.id < b.id ? -1 : 1)),
      own: bundle.airings.filter((a) => a.date <= input.asOfDate),
      comp: input.competitorBundle ? input.competitorBundle.airings.filter((a) => a.date <= input.asOfDate) : null,
    })
  );

  const evaluations: Record<string, ScheduleEvaluationResult> = {};
  for (const ev of input.evaluateAirings ?? []) {
    evaluations[ev.label] = evaluateActualSchedule(scorer, pool, ev.airings, ev.weekStart, channelCode, input.genreOf, config.structure.max_gap_min);
  }

  return { output, resolution, summary, skeleton, featureSet: fs, competitorFeatures, fingerprint: fp, evaluations };
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

/** 실제 편성(방영 기록)을 엔진과 같은 모델·목적함수로 평가 + 실측과 대조(편성 분 가중 평균, 방영별 오차). */
export function evaluateActualSchedule(
  scorer: Scorer,
  pool: EngineCandidate[],
  airings: OwnAiring[],
  weekStart: string,
  channelCode: string,
  genreOf: GenreResolver,
  maxGapMin: number
): ScheduleEvaluationResult {
  const blocks = scheduleFromAirings(airings, weekStart, pool, channelCode, genreOf);
  scorer.detail = true;
  const ev = evaluateSchedule(scorer, blocks, maxGapMin);
  const weekEnd = addDays(weekStart, 6);
  const actualByKey = new Map<string, OwnAiring>();
  for (const a of airings) if (a.date >= weekStart && a.date <= weekEnd) actualByKey.set(`${a.dow}|${a.startMin}|${a.programId}`, a);
  const rows = ev.blocks.map((b) => {
    const a = actualByKey.get(`${b.weekday}|${b.startMin}|${b.candidate.programId}`);
    // 실제 편성의 부제(있으면)를 함께 보여 준다 — 비교 화면용, 평가값에는 영향 없음
    if (a?.episodeSubtitle) {
      b.episode = { subtitle: a.episodeSubtitle, episodeNumber: a.episodeNumber, key: a.episodeSubtitle, n: 0, relIndex: 1, expected: null, lastAired: null };
    }
    return { block: b, actual: { r: a?.kpi.r ?? null, s: a?.kpi.s ?? null, ts: a?.kpi.ts ?? null } };
  });
  const wavg = (pick: (r: (typeof rows)[number]) => number | null) => {
    let num = 0;
    let den = 0;
    for (const r of rows) {
      const v = pick(r);
      if (v === null) continue;
      num += v * (r.block.endMin - r.block.startMin);
      den += r.block.endMin - r.block.startMin;
    }
    return den > 0 ? num / den : null;
  };
  const errs = rows.filter((r) => r.actual.r !== null && r.block.eval.expected !== null).map((r) => (r.block.eval.expected as number) - (r.actual.r as number));
  return {
    weekStart,
    rows,
    objective: ev.objective,
    expectedAvgRating: wavg((r) => r.block.eval.expected),
    actualAvgRating: wavg((r) => r.actual.r),
    expectedAvgShare: wavg((r) => r.block.eval.expectedShare),
    actualAvgShare: wavg((r) => r.actual.s),
    expectedAvgTimeSpent: wavg((r) => r.block.eval.expectedTimeSpent),
    actualAvgTimeSpent: wavg((r) => r.actual.ts),
    calibration: {
      mae: errs.length ? errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length : null,
      bias: errs.length ? errs.reduce((s, e) => s + e, 0) / errs.length : null,
      n: errs.length,
    },
  };
}

export { evaluateSchedule, UNCLASSIFIED };
