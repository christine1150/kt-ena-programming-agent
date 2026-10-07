// 이상적 1주일 편성 실행(DB 조회 → 순수 엔진). API와 스크립트가 공용으로 쓴다. 저장은 runStore.ts.
import type { BenchmarkPlacement, CompetitorTargetMode, IdealScheduleConfig, StructureMode } from "./config";
import { loadIdealScheduleConfig } from "./configStore";
import type { HardConstraintInput } from "./constraints";
import { loadConstraintInputs, loadOriginalSpecs } from "./constraintStore";
import { buildRerunConstraints } from "./rerunRules";
import { estimateWeeklyRank, type WeeklyRankRow } from "./rankEstimate";
import { resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { fetchCompetitorData, fetchOwnAirings, fetchWeekAirings, loadChannelRef, type ChannelRef } from "./dataSource";
import { buildRightsGate } from "@/lib/avail/engineGate";
import { runIdealScheduleEngine, type EngineRunResult } from "./engine";
import { resolveGenre } from "./genreRules";
import { supabase } from "@/lib/supabase";
import { airingSpan } from "./time";
import { loadGenreMap } from "./genreStore";
import { withOptimizeTarget } from "./mapping";
import { enrichAiringsWithPlan, normalizePlanRows, type PlanRow, type PlanRowRaw } from "./planEpisodes";
import type { StrategyMode } from "./scoring";
import { addDays } from "./time";
import { DEFAULT_SEARCH_DEADLINE_MS } from "./searchControl";
import { buildExcludedPredicate, exclusionFingerprint, isTitleExcluded, loadActiveExclusions } from "./exclusions";
import type { OwnAiring, OwnAiringsBundle } from "./types";
import type { ResidualRow } from "./uncertainty";

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
  /** 이번 실행에만 적용하는 설정 덮어쓰기(채널 저장값은 바꾸지 않음) — 화면에서 가중치·반복 제한을 바꾼 뒤 저장하지 않고 바로 뽑아 볼 수 있게 한다. 실행의 config_snapshot에 그대로 남는다. */
  configOverride?: { weights?: Record<string, number>; repeat_rules?: { daily_cap?: number; weekly_cap?: number } };
  includeActualWeek?: boolean; // 백테스트: 대상 주 실제 편성을 같은 모델로 평가(모델에는 넣지 않음)
  /** 편성표 회차 반영(B안, 사용자 지시 2026-10-01) — 업로드된 주간 편성표의 회차로 과거 방영 회차를 채우고 차주 흐름을 잇는다 */
  usePlanEpisodes?: boolean;
  /** 권리(Avail) 기준(단계 06): explore = 권리상 불가인 후보만 제외(기본, 조건부·미확인은 라벨로 분리) / executable = 권리가 확인된 후보만. Avail가 입력되지 않은 설치에서는 무시된다 */
  rightsMode?: "explore" | "executable";
  /** 이번 실행에만 학습(검색) 기간을 덮어쓴다(일) — 홈·채널 상세 교체 제안이 약한 곳을 못 찾을 때 최대 180일(6개월)까지 넓혀 본다. 저장 설정은 바꾸지 않는다. */
  lookbackDays?: number;
  /** 블록마다 계산할 자사 대체 후보 수(기본 10) */
  alternativesTopN?: number;
}

/** 닐슨 주간 순위(채널·랭킹 시트 타깃) — 기준일까지 최근 lookbackDays일 */
export async function loadWeeklyRanks(channelId: string, targetLabel: string, asOfDate: string, lookbackDays: number): Promise<WeeklyRankRow[]> {
  const { data, error } = await supabase
    .from("nielsen_period_rank")
    .select("date_from, rank, rating, targets!inner(label)")
    .eq("channel_id", channelId)
    .eq("period_type", "weekly")
    .eq("targets.label", targetLabel)
    .lte("date_to", asOfDate)
    .gte("date_from", addDays(asOfDate, -lookbackDays));
  if (error) return [];
  return (data ?? [])
    .filter((r) => r.rank !== null && r.rating !== null)
    .map((r) => ({ weekStart: r.date_from as string, rating: Number(r.rating), rank: Number(r.rank) }));
}

/** 업로드 편성표 행(학습 기간 ~ 대상 주) — program_schedule_grid. 편성표는 방송 전에 확정되는 계획이라 대상 주 것도 누수 아님 */
export async function loadPlanRows(channelId: string, fromDate: string, toDate: string): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from("program_schedule_grid")
    .select("week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, episode_subtitle, matched_program_id, tags")
    .eq("channel_id", channelId)
    .gte("broadcast_date", fromDate)
    .lte("broadcast_date", toDate)
    .limit(20000);
  if (error) throw new Error(`편성표 조회 실패: ${error.message}`);
  return normalizePlanRows((data ?? []) as PlanRowRaw[]);
}

export interface RunOptions {
  /** 요청 취소(브라우저가 연결을 끊음·새 요청으로 대체). 취소되면 탐색을 멈추고 결과를 채택하지 않는다(호출자는 저장하지 않는다). */
  signal?: AbortSignal;
  /** 이 호출의 탐색 마감(요청 시작 기준 ms). 기본 DEFAULT_SEARCH_DEADLINE_MS */
  deadlineMs?: number;
}

export interface RunOutcome extends EngineRunResult {
  /** 탐색이 취소로 끝남 — 이 결과는 저장·채택하지 않는다(이전 유효 편성안 유지) */
  cancelled: boolean;
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

/** 과거 주 검증(백테스트) 방영별 잔차 — 이 채널·타깃, 그리고 "그 주 실측이 기준일 이전에 끝난" 주만(누수 방지:
 *  week_start + 6 ≤ as_of). 같은 주를 여러 번 검증했으면 가장 최근 결과 하나만 쓴다. */
export async function loadBacktestResiduals(channelId: string, targetLabel: string, asOfDate: string): Promise<ResidualRow[]> {
  const { data, error } = await supabase
    .from("ideal_schedule_backtest_results")
    .select("week_start, created_at, detail, ideal_schedule_backtest_runs!inner(channel_id)")
    .eq("ideal_schedule_backtest_runs.channel_id", channelId)
    .eq("target_label", targetLabel)
    .lte("week_start", addDays(asOfDate, -6))
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return []; // 잔차가 없어도 엔진은 돈다(학습 기간 변동으로 대체)
  const seen = new Set<string>();
  const out: ResidualRow[] = [];
  for (const r of data ?? []) {
    if (seen.has(r.week_start as string)) continue;
    seen.add(r.week_start as string);
    for (const d of (r.detail as { expected: number | null; actual: number | null; fallbackLevel: number }[] | null) ?? []) {
      out.push({ expected: d.expected === null ? null : Number(d.expected), actual: d.actual === null ? null : Number(d.actual), fallbackLevel: Number(d.fallbackLevel) });
    }
  }
  return out;
}

export async function runIdealSchedule(req: RunRequest, opts: RunOptions = {}): Promise<RunOutcome> {
  const t0 = Date.now();
  const envDeadline = Number(process.env.IDEAL_SEARCH_DEADLINE_MS);
  const deadlineMs = opts.deadlineMs ?? (Number.isFinite(envDeadline) && envDeadline > 0 ? envDeadline : DEFAULT_SEARCH_DEADLINE_MS);
  const asOfDate = req.asOfDate ?? addDays(req.weekStart, -1);
  const channel = await loadChannelRef(req.channelCode);
  const saved = await loadIdealScheduleConfig(channel.id);
  const config0 = req.configOverride
    ? { ...saved, weights: { ...saved.weights, ...(req.configOverride.weights ?? {}) }, repeat_rules: { ...saved.repeat_rules, ...(req.configOverride.repeat_rules ?? {}) } }
    : saved;
  const config = req.lookbackDays && req.lookbackDays > 0 ? { ...config0, expected_kpi: { ...config0.expected_kpi, lookback_days: Math.min(180, Math.round(req.lookbackDays)) } } : config0;
  const target = req.optimizeTargetLabel ?? null;
  const [rawBundle, competitorBundle, genreMap, constraintLoad, actualWeek] = await Promise.all([
    fetchOwnAirings(channel, asOfDate, config, target),
    fetchCompetitorData(req.competitorNames, asOfDate, config.expected_kpi.lookback_days),
    loadGenreMap(),
    loadConstraintInputs(channel.id, req.weekStart),
    req.includeActualWeek ? fetchWeekAirings(channel, req.weekStart, config, target) : Promise.resolve(null),
  ]);
  const planRows = req.usePlanEpisodes ? await loadPlanRows(channel.id, addDays(asOfDate, -config.expected_kpi.lookback_days), addDays(req.weekStart, 6)) : [];
  const enriched = enrichAiringsWithPlan(rawBundle.airings, planRows);
  const bundle0 = planRows.length ? { ...rawBundle, airings: enriched.airings } : rawBundle;
  const bundle = target ? withOptimizeTarget(bundle0, target) : bundle0;
  const currentWeekStart = pickCurrentWeek(bundle, req.weekStart);
  const evaluateAirings: { label: string; weekStart: string; airings: OwnAiring[] }[] = [];
  if (currentWeekStart) evaluateAirings.push({ label: "CURRENT", weekStart: currentWeekStart, airings: bundle.airings });
  if (actualWeek && actualWeek.airings.length > 0) {
    const aw = planRows.length ? { ...actualWeek, airings: enrichAiringsWithPlan(actualWeek.airings, planRows).airings } : actualWeek;
    const wk = target ? withOptimizeTarget(aw, target) : aw;
    evaluateAirings.push({ label: "ACTUAL", weekStart: req.weekStart, airings: wk.airings });
  }
  // 오리지널 본방 연계 재방(직전회차 재방·직재방) — 주요 콘텐츠 관리 본방 스케줄 + 최근 3달 이 채널 편성에서 배운 직재방 간격
  const rerunCfg = config.structure.rerun_rules;
  const specs = rerunCfg ? await loadOriginalSpecs([channel.code, ...(rerunCfg.sister_sources?.[channel.code] ?? [])], addDays(asOfDate, -config.expected_kpi.lookback_days)) : [];
  const rerun = buildRerunConstraints(specs, rawBundle.airings, req.weekStart, channel.code, rerunCfg, config.structure.default_runtime_by_genre);
  const [historicalRuntime, residuals] = await Promise.all([
    loadHistoricalRuntimes(channel.id, constraintLoad.inputs, asOfDate),
    loadBacktestResiduals(channel.id, bundle.kpiLabel, asOfDate),
  ]);
  // 권리(Avail) 게이트 — Avail 자료가 있을 때만 켜진다(없으면 현재 동작 그대로, 실행 가능 판정은 보류)
  const rightsMode = req.rightsMode ?? "explore";
  const rights = await buildRightsGate(channel.code, req.weekStart, rightsMode);
  // 제외 편성(사용자 지시 2026-10-07): 권리 게이트와 같은 slotAllowed 자리에 합쳐, 제외 제목은 AI가 새로 배치하지 못하고 현재 편성에 있어도 교체 대상이 된다.
  const exclusionRows = await loadActiveExclusions(channel.id, req.weekStart);
  const isExcluded = buildExcludedPredicate(exclusionRows);
  const rightsGate = rights.gate ? rights.gate : null;
  const combinedRights =
    rightsGate || isExcluded
      ? {
          slotAllowed: ((c, weekday, startMin, endMin) => !(isExcluded && isExcluded(c)) && (!rightsGate || rightsGate.slotAllowed(c, weekday, startMin, endMin))) as NonNullable<typeof rightsGate>["slotAllowed"],
          fingerprint: `${rightsGate?.fingerprint ?? ""}${isExcluded ? `|excl:${exclusionFingerprint(exclusionRows)}` : ""}`,
        }
      : undefined;
  // 제외 편성이 후보를 얼마나 줄였는지 한 줄로 알린다(사용자 설계 2026-10-06): 최근 방영 프로그램 중 제외로 빠진 수, 20% 이상이면 "크게 줄었습니다"
  const recentNames = new Set(bundle.airings.map((a) => a.programName));
  const droppedNames = [...recentNames].filter((n) => isTitleExcluded(exclusionRows, n));
  const exclusionNotice =
    exclusionRows.length > 0
      ? [
          `제외 편성 ${exclusionRows.length}건 적용(${exclusionRows.map((r) => r.program_name).join(", ")}) — 최근 방영 프로그램 ${recentNames.size}개 중 ${droppedNames.length}개가 후보에서 빠졌습니다${droppedNames.length > 0 ? `: ${droppedNames.slice(0, 5).join(", ")}${droppedNames.length > 5 ? " 외" : ""}` : ""}${recentNames.size > 0 && droppedNames.length / recentNames.size >= 0.2 ? " — 편성 가능한 후보가 크게 줄었습니다" : ""}`,
        ]
      : [];
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
    constraints: [...constraintLoad.inputs, ...rerun.inputs, ...(req.extraLocks ?? [])],
    historicalRuntime,
    residuals,
    genreOf: (scope, owner, name) => resolveGenre(genreMap, scope, owner, name),
    evaluateAirings,
    planRows: planRows.length ? planRows : undefined,
    planFilled: enriched.filled,
    rights: combinedRights,
    alternativesTopN: req.alternativesTopN,
    // 탐색 마감·취소(OPT04): 서버 제한 시간 안에 지금까지의 최선안으로 마무리하고, 취소되면 멈춘다
    search: { now: Date.now, deadlineAt: t0 + deadlineMs, isCancelled: () => opts.signal?.aborted === true },
  });
  result.summary.rights = { status: rights.status, mode: rightsMode, inventoryVersion: rights.gate?.inventoryVersion ?? null, unconfirmedInterpretations: rights.gate?.unconfirmedInterpretations ?? [], message: rights.message };
  // 주간 예상 순위 — 채널 KPI 기준일 때 최근 3달 닐슨 주간 순위(랭킹 시트 타깃 표기)로 추정
  const curEval = result.evaluations.CURRENT ?? null;
  result.summary.expectedRank =
    result.summary.optimizeTarget.isChannelKpi && channel.primaryTarget && curEval
      ? estimateWeeklyRank(
          await loadWeeklyRanks(channel.id, resolveRankSheetTargetLabel(channel.primaryTarget), asOfDate, config.expected_kpi.lookback_days),
          result.summary.expectedAvgRating,
          curEval.expectedAvgRating,
          curEval.weekStart
        )
      : null;
  const t2 = Date.now();
  return {
    ...result,
    cancelled: result.output.search.stoppedBy === "CANCELLED",
    channel,
    config,
    asOfDate,
    currentWeekStart,
    warnings: [...constraintLoad.warnings, ...rerun.warnings, ...result.resolution.warnings, ...exclusionNotice],
    timingsMs: { load: t1 - t0, engine: t2 - t1 },
  };
}
