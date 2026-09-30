// 이상적 1주일 편성 실행(DB 조회 → 순수 엔진). API와 스크립트가 공용으로 쓴다. 저장은 runStore.ts.
import type { BenchmarkPlacement, CompetitorTargetMode, IdealScheduleConfig, StructureMode } from "./config";
import { loadIdealScheduleConfig } from "./configStore";
import type { HardConstraintInput } from "./constraints";
import { loadConstraintInputs } from "./constraintStore";
import { fetchCompetitorData, fetchOwnAirings, fetchWeekAirings, loadChannelRef, type ChannelRef } from "./dataSource";
import { runIdealScheduleEngine, type EngineRunResult } from "./engine";
import { resolveGenre } from "./genreRules";
import { loadGenreMap } from "./genreStore";
import { withOptimizeTarget } from "./mapping";
import type { StrategyMode } from "./scoring";
import { addDays } from "./time";
import type { OwnAiring, OwnAiringsBundle } from "./types";

export interface RunRequest {
  channelCode: string;
  weekStart: string; // 월요일
  mode: StructureMode;
  strategyMode: StrategyMode;
  competitorNames: string[];
  competitorTargetMode?: CompetitorTargetMode;
  benchmarkPlacement?: BenchmarkPlacement; // 미지정 시 설정값(기본 NONE = 자사 프로그램만). SUGGEST_ONLY·MIX는 명시적으로 켰을 때만
  optimizeTargetLabel?: string; // 자사 채널 최적화 타깃(미지정 = 채널 KPI). fetchTargetLabels 목록 중 하나
  extraLocks?: HardConstraintInput[]; // 화면에서 LOCK·수동 변경 유지한 블록(rank 1)
  asOfDate?: string; // 기본 weekStart − 1(백테스트 누수 방지)
  includeActualWeek?: boolean; // 백테스트: 대상 주 실제 편성을 같은 모델로 평가(모델에는 넣지 않음)
}

export interface RunOutcome extends EngineRunResult {
  channel: ChannelRef;
  config: IdealScheduleConfig;
  asOfDate: string;
  currentWeekStart: string | null;
  warnings: string[];
  timingsMs: Record<string, number>;
}

/** 비교 기준 "현재 편성" 주: 대상 주 직전부터 거슬러 올라가 7일 데이터가 모두 있고 공휴일이 없는 첫 주(최대 4주).
 *  명절 특집 주가 현재 편성으로 잡히지 않게 한다. 없으면 직전 주(데이터가 있을 때). */
export function pickCurrentWeek(bundle: OwnAiringsBundle, weekStart: string): string | null {
  const dates = new Set(bundle.datesWithData);
  const holidays = new Set(bundle.holidays);
  for (let w = 1; w <= 4; w++) {
    const start = addDays(weekStart, -7 * w);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    if (days.every((d) => dates.has(d) && !holidays.has(d))) return start;
  }
  const prev = addDays(weekStart, -7);
  return bundle.datesWithData.some((d) => d >= prev) ? prev : null;
}

export async function runIdealSchedule(req: RunRequest): Promise<RunOutcome> {
  const t0 = Date.now();
  const asOfDate = req.asOfDate ?? addDays(req.weekStart, -1);
  const channel = await loadChannelRef(req.channelCode);
  const config = await loadIdealScheduleConfig(channel.id);
  const target = req.optimizeTargetLabel ?? null;
  const [rawBundle, competitorBundle, genreMap, constraintLoad, actualWeek] = await Promise.all([
    fetchOwnAirings(channel, asOfDate, config, target),
    fetchCompetitorData(req.competitorNames, asOfDate, config.expected_kpi.lookback_days),
    loadGenreMap(),
    loadConstraintInputs(channel.id, req.weekStart),
    req.includeActualWeek ? fetchWeekAirings(channel, req.weekStart, config, target) : Promise.resolve(null),
  ]);
  const bundle = target ? withOptimizeTarget(rawBundle, target) : rawBundle;
  const currentWeekStart = pickCurrentWeek(bundle, req.weekStart);
  const evaluateAirings: { label: string; weekStart: string; airings: OwnAiring[] }[] = [];
  if (currentWeekStart) evaluateAirings.push({ label: "CURRENT", weekStart: currentWeekStart, airings: bundle.airings });
  if (actualWeek && actualWeek.airings.length > 0) {
    const wk = target ? withOptimizeTarget(actualWeek, target) : actualWeek;
    evaluateAirings.push({ label: "ACTUAL", weekStart: req.weekStart, airings: wk.airings });
  }
  const t1 = Date.now();
  const result = runIdealScheduleEngine({
    weekStart: req.weekStart,
    asOfDate,
    mode: req.mode,
    strategyMode: req.strategyMode,
    competitorTargetMode: req.competitorTargetMode,
    benchmarkPlacement: req.benchmarkPlacement,
    config,
    bundle,
    channelKpiLabel: channel.kpiLabel,
    competitorBundle: req.competitorNames.length ? competitorBundle : null,
    constraints: [...constraintLoad.inputs, ...(req.extraLocks ?? [])],
    genreOf: (scope, owner, name) => resolveGenre(genreMap, scope, owner, name),
    evaluateAirings,
  });
  const t2 = Date.now();
  return {
    ...result,
    channel,
    config,
    asOfDate,
    currentWeekStart,
    warnings: [...constraintLoad.warnings, ...result.resolution.warnings],
    timingsMs: { load: t1 - t0, engine: t2 - t1 },
  };
}
