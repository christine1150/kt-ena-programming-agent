// Walk-forward 백테스트(설계 문서 I절). 과거 주 W를 테스트할 때 모델은 W 전날까지의 데이터만 쓴다
// (모든 RPC가 broadcast_date <= as_of를 SQL에서 강제). W의 실제 방영은 "실제 편성 구조와 실측값"으로만 쓰고
// 모델 입력에는 넣지 않는다.
//
// 측정값(정직한 해석):
// - 보정도(calibration): 실제 편성을 같은 모델로 본 기대값 vs 실측 — 검증 가능한 유일한 정확도 지표
// - 이상적 편성 기대값 − 실제 편성 기대값: 같은 모델 기준 추정 개선폭(실현값 아님)
// - 이상적 편성 기대값 − 실제 실측: 요청 항목이나 이상적 편성의 실측은 관측할 수 없어 참고치
import { supabase } from "@/lib/supabase";
import { runIdealSchedule, type RunRequest } from "./engineRunner";
import { saveRun, type Actor } from "./runStore";
import { addDays, isoDow } from "./time";
import { ClientError } from "./errors";

export interface BacktestWeekRequest extends Omit<RunRequest, "asOfDate" | "includeActualWeek" | "extraLocks"> {
  backtestRunId?: string; // 여러 주를 한 백테스트로 묶을 때 첫 호출이 돌려준 id
}

export async function runBacktestWeek(req: BacktestWeekRequest, actor: Actor) {
  if (isoDow(req.weekStart) !== 1) throw new ClientError("weekStart는 월요일이어야 합니다.");
  const runReq: RunRequest = { ...req, includeActualWeek: true, asOfDate: addDays(req.weekStart, -1) };
  const out = await runIdealSchedule(runReq);
  // 시간 마감·취소로 끝난 탐색은 수렴한 결과가 아니라 검증 자료로 쓰지 않는다(조용히 섞이지 않게 거부)
  const stop = out.summary.search?.stoppedBy;
  if (stop === "DEADLINE" || stop === "CANCELLED" || stop === "EVAL_BUDGET") throw new ClientError(`${req.weekStart} 주의 탐색이 끝까지 수렴하지 못해(${stop}) 백테스트에 쓰지 않았습니다. 잠시 후 다시 시도해 주세요.`);
  const actual = out.evaluations.ACTUAL;
  if (!actual || actual.rows.length === 0) throw new ClientError(`${req.weekStart} 주의 실제 방영 데이터가 없어 백테스트할 수 없습니다.`);
  const idealRunId = await saveRun(runReq, out, actor);

  let backtestRunId = req.backtestRunId ?? null;
  if (!backtestRunId) {
    const { data, error } = await supabase
      .from("ideal_schedule_backtest_runs")
      .insert({
        channel_id: out.channel.id,
        params: {
          mode: req.mode,
          strategyMode: req.strategyMode,
          competitorNames: [...req.competitorNames].sort(),
          benchmarkPlacement: req.benchmarkPlacement ?? out.config.strategy.benchmark_placement,
          optimizeTargetLabel: out.summary.optimizeTarget.label,
        },
        config_snapshot: out.config,
        created_by: actor,
      })
      .select("id")
      .single();
    if (error) throw new Error(`백테스트 실행 저장 실패: ${error.message}`);
    backtestRunId = data.id as string;
  }

  const detail = actual.rows.map((r) => ({
    weekday: r.block.weekday,
    startMin: r.block.startMin,
    endMin: r.block.endMin,
    programName: r.block.candidate.programName,
    expected: r.block.eval.expected,
    actual: r.actual.r,
    fallbackLevel: r.block.eval.fallbackLevel,
    confidence: r.block.eval.confidence,
    programSampleCount: r.block.eval.programSampleCount,
    // 예상 범위(이 주 기준일 이전 잔차·학습 변동으로 만든 것) — 범위 적중률 계산용
    low: r.block.eval.range?.low ?? null,
    high: r.block.eval.range?.high ?? null,
    rangeBasis: r.block.eval.range?.basis ?? null,
  }));
  const row = {
    backtest_run_id: backtestRunId,
    week_start: req.weekStart,
    as_of_date: out.asOfDate,
    ideal_run_id: idealRunId,
    target_label: out.summary.optimizeTarget.label,
    actual_airing_count: actual.rows.length,
    actual_avg_rating: actual.actualAvgRating,
    expected_actual_schedule: actual.expectedAvgRating,
    expected_ideal: out.summary.expectedAvgRating,
    actual_avg_share: actual.actualAvgShare,
    expected_ideal_share: out.summary.expectedAvgShare,
    actual_avg_time_spent: actual.actualAvgTimeSpent,
    expected_ideal_time_spent: out.summary.expectedAvgTimeSpent,
    calibration_mae: actual.calibration.mae,
    calibration_bias: actual.calibration.bias,
    calibration_n: actual.calibration.n,
    detail,
  };
  const { error: rErr } = await supabase.from("ideal_schedule_backtest_results").upsert(row, { onConflict: "backtest_run_id,week_start" });
  if (rErr) throw new Error(`백테스트 결과 저장 실패: ${rErr.message}`);
  const summary = await refreshBacktestSummary(backtestRunId);
  return { backtestRunId, idealRunId, result: row, summary };
}

/** 백테스트 요약(주별 결과 평균) 갱신 — 저장된 값의 단순 평균만. */
export async function refreshBacktestSummary(backtestRunId: string) {
  const { data } = await supabase.from("ideal_schedule_backtest_results").select("*").eq("backtest_run_id", backtestRunId).order("week_start");
  const rows = (data ?? []) as Record<string, number | string | null>[];
  const avg = (key: string) => {
    const v = rows.map((r) => r[key]).filter((x): x is number => typeof x === "number" || (typeof x === "string" && x !== "" && !Number.isNaN(Number(x)))).map(Number);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const uplift = rows
    .filter((r) => r.expected_ideal !== null && r.expected_actual_schedule !== null)
    .map((r) => Number(r.expected_ideal) - Number(r.expected_actual_schedule));
  // 방영 단위 지표(2단계): 중앙 절대오차, 상대 MAE(MAE ÷ 실측 평균), 근거 등급별 MAE, 예상 범위 적중률
  type D = { expected: number | null; actual: number | null; fallbackLevel: number; low?: number | null; high?: number | null };
  const det = rows.flatMap((r) => ((r.detail as unknown as D[] | null) ?? [])).filter((d) => d.expected !== null && d.actual !== null) as (D & { expected: number; actual: number })[];
  const absErr = det.map((d) => Math.abs(d.expected - d.actual)).sort((a, b) => a - b);
  const mae = absErr.length ? absErr.reduce((a, b) => a + b, 0) / absErr.length : null;
  const actualMean = det.length ? det.reduce((s, d) => s + d.actual, 0) / det.length : null;
  const grade = (lv: number) => (lv <= 2 ? "A" : lv === 3 ? "B" : "C");
  const byGrade: Record<string, { n: number; mae: number | null; bias: number | null }> = {};
  for (const g of ["A", "B", "C"]) {
    const list = det.filter((d) => grade(Number(d.fallbackLevel)) === g);
    byGrade[g] = {
      n: list.length,
      mae: list.length ? list.reduce((s, d) => s + Math.abs(d.expected - d.actual), 0) / list.length : null,
      bias: list.length ? list.reduce((s, d) => s + (d.expected - d.actual), 0) / list.length : null,
    };
  }
  const ranged = det.filter((d) => d.low !== null && d.low !== undefined && d.high !== null && d.high !== undefined);
  const summary = {
    weeks: rows.map((r) => r.week_start),
    airings: det.length,
    medianAbsError: absErr.length ? (absErr.length % 2 ? absErr[(absErr.length - 1) / 2] : (absErr[absErr.length / 2 - 1] + absErr[absErr.length / 2]) / 2) : null,
    relativeMae: mae !== null && actualMean ? mae / actualMean : null,
    byGrade,
    rangeHitRate: ranged.length ? ranged.filter((d) => d.actual >= (d.low as number) && d.actual <= (d.high as number)).length / ranged.length : null,
    rangeN: ranged.length,
    avgCalibrationMae: avg("calibration_mae"),
    avgCalibrationBias: avg("calibration_bias"),
    avgActualRating: avg("actual_avg_rating"),
    avgExpectedActualSchedule: avg("expected_actual_schedule"),
    avgExpectedIdeal: avg("expected_ideal"),
    avgEstimatedUplift: uplift.length ? uplift.reduce((a, b) => a + b, 0) / uplift.length : null,
    note: "추정 개선폭은 같은 모델 기준 기대값 차이이며 실현된 시청률이 아님(기대값이 큰 후보를 골라 뽑으므로 상한 추정)",
  };
  await supabase.from("ideal_schedule_backtest_runs").update({ summary }).eq("id", backtestRunId);
  return summary;
}
