// 이상적 1주일 편성 실행(DB 조회 → 순수 엔진). API(STEP 4)와 스크립트가 공용으로 쓴다. 저장은 하지 않는다.
import type { BenchmarkPlacement, CompetitorTargetMode, StructureMode } from "./config";
import { loadIdealScheduleConfig } from "./configStore";
import type { HardConstraintInput } from "./constraints";
import { loadConstraintInputs } from "./constraintStore";
import { fetchCompetitorData, fetchOwnAirings, loadChannelRef } from "./dataSource";
import { runIdealScheduleEngine, type EngineRunResult } from "./engine";
import { resolveGenre } from "./genreRules";
import { withOptimizeTarget } from "./mapping";
import { loadGenreMap } from "./genreStore";
import type { StrategyMode } from "./scoring";
import { addDays } from "./time";

export interface RunRequest {
  channelCode: string;
  weekStart: string; // 월요일
  mode: StructureMode;
  strategyMode: StrategyMode;
  competitorNames: string[];
  competitorTargetMode?: CompetitorTargetMode;
  benchmarkPlacement?: BenchmarkPlacement; // 경쟁 Benchmark 배치(MIX) / 제안만(SUGGEST_ONLY), 미지정 시 설정값
  optimizeTargetLabel?: string; // 자사 채널 최적화 타깃(미지정 = 채널 KPI). fetchTargetLabels 목록 중 하나
  extraLocks?: HardConstraintInput[]; // 화면에서 LOCK·수동 변경 유지한 블록(rank 1)
  asOfDate?: string; // 기본 weekStart − 1(백테스트 누수 방지)
}

export async function runIdealSchedule(req: RunRequest): Promise<EngineRunResult & { warnings: string[]; timingsMs: Record<string, number> }> {
  const t0 = Date.now();
  const asOfDate = req.asOfDate ?? addDays(req.weekStart, -1);
  const channel = await loadChannelRef(req.channelCode);
  const config = await loadIdealScheduleConfig(channel.id);
  const [bundle, competitorBundle, genreMap, constraintLoad] = await Promise.all([
    fetchOwnAirings(channel, asOfDate, config, req.optimizeTargetLabel ?? null),
    fetchCompetitorData(req.competitorNames, asOfDate, config.expected_kpi.lookback_days),
    loadGenreMap(),
    loadConstraintInputs(channel.id, req.weekStart),
  ]);
  const t1 = Date.now();
  const result = runIdealScheduleEngine({
    weekStart: req.weekStart,
    asOfDate,
    mode: req.mode,
    strategyMode: req.strategyMode,
    competitorTargetMode: req.competitorTargetMode,
    benchmarkPlacement: req.benchmarkPlacement,
    config,
    bundle: req.optimizeTargetLabel ? withOptimizeTarget(bundle, req.optimizeTargetLabel) : bundle,
    channelKpiLabel: channel.kpiLabel,
    competitorBundle: req.competitorNames.length ? competitorBundle : null,
    constraints: [...constraintLoad.inputs, ...(req.extraLocks ?? [])],
    genreOf: (scope, owner, name) => resolveGenre(genreMap, scope, owner, name),
  });
  const t2 = Date.now();
  return { ...result, warnings: [...constraintLoad.warnings, ...result.resolution.warnings], timingsMs: { load: t1 - t0, engine: t2 - t1 } };
}
