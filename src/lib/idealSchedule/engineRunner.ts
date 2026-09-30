// 이상적 1주일 편성 실행(DB 조회 → 순수 엔진). API와 스크립트가 공용으로 쓴다. 저장은 runStore.ts.
import type { BenchmarkPlacement, CompetitorTargetMode, IdealScheduleConfig, StructureMode } from "./config";
import { loadIdealScheduleConfig } from "./configStore";
import type { HardConstraintInput } from "./constraints";
import { loadConstraintInputs } from "./constraintStore";
import { fetchCompetitorData, fetchOwnAirings, fetchWeekAirings, loadChannelRef, type ChannelRef } from "./dataSource";
import { runIdealScheduleEngine, type EngineRunResult } from "./engine";
import { resolveGenre } from "./genreRules";
import { supabase } from "@/lib/supabase";
import { airingSpan } from "./time";
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
  episodeMode?: "PROGRAM" | "EPISODE"; // 부제 반영 여부(설정된 에피소드 시리즈가 있는 채널, 예: OLIFE)
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

/** 길이 미입력 제약(주요 콘텐츠 자동 연동 등)의 과거 방영 길이 — 최근 12주 밖(작년 편성 등)까지 이 채널의 방영 기록에서
 *  찾는다. 프로그램 id가 같은 기록 + 이름이 포함 관계인 같은 채널 프로그램(예: 〈트렌드다큐도시락〉 ↔ 닐슨 〈락트렌드다큐도시락〉)의
 *  기록을 합쳐 방영 길이 중앙값을 낸다(스페셜·특집 프로그램은 이름에 없으면 제외). 기준일(as_of) 이후 기록은 쓰지 않는다. */
async function loadHistoricalRuntimes(channelId: string, inputs: HardConstraintInput[], asOfDate: string): Promise<Record<string, { min: number; from: string }>> {
  const out: Record<string, { min: number; from: string }> = {};
  const need = inputs.filter((c) => c.durationMin === null);
  if (need.length === 0) return out;
  const byName = new Map<string, { min: number; from: string } | null>();
  const special = /스페셜|특집|몰아보기|하이라이트|베스트/;
  for (const c of need) {
    const key = `${c.programId ?? ""}|${c.programName}`;
    if (!byName.has(key)) {
      const ids = new Set<string>();
      if (c.programId) ids.add(c.programId);
      const safe = c.programName.replace(/[%_,()]/g, " ").trim();
      if (safe.length >= 3) {
        const { data } = await supabase.from("programs").select("id, canonical_name").eq("channel_id", channelId).ilike("canonical_name", `%${safe}%`).limit(20);
        for (const p of data ?? []) if (special.test(c.programName) || !special.test(p.canonical_name)) ids.add(p.id);
      }
      let result: { min: number; from: string } | null = null;
      if (ids.size > 0) {
        const { data } = await supabase
          .from("ratings")
          .select("broadcast_date, start_time, end_time")
          .in("program_id", [...ids])
          .lte("broadcast_date", asOfDate)
          .order("broadcast_date", { ascending: false })
          .limit(400);
        const mins: number[] = [];
        let oldest = "";
        for (const r of data ?? []) {
          const span = airingSpan(r.start_time, r.end_time);
          if (span?.durationMin && span.durationMin >= 5 && span.durationMin <= 360) {
            mins.push(span.durationMin);
            oldest = r.broadcast_date;
          }
        }
        if (mins.length > 0) {
          mins.sort((a, b) => a - b);
          const median = mins.length % 2 ? mins[(mins.length - 1) / 2] : (mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2;
          result = { min: median, from: `${oldest.slice(0, 7)}~` };
        }
      }
      byName.set(key, result);
    }
    const r = byName.get(key);
    if (r) out[c.id] = r;
  }
  return out;
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
  const historicalRuntime = await loadHistoricalRuntimes(channel.id, constraintLoad.inputs, asOfDate);
  const t1 = Date.now();
  const result = runIdealScheduleEngine({
    weekStart: req.weekStart,
    asOfDate,
    mode: req.mode,
    strategyMode: req.strategyMode,
    competitorTargetMode: req.competitorTargetMode,
    benchmarkPlacement: req.benchmarkPlacement,
    episodeMode: req.episodeMode,
    config,
    bundle,
    channelKpiLabel: channel.kpiLabel,
    competitorBundle: req.competitorNames.length ? competitorBundle : null,
    constraints: [...constraintLoad.inputs, ...(req.extraLocks ?? [])],
    historicalRuntime,
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
