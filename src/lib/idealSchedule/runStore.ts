// 이상적 1주일 편성 실행 저장·조회·수동 변경(설계 문서 D-1, STEP 4). 저장하는 수치는 전부 엔진 계산값 그대로다.
import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabase";
import type { HardConstraintInput } from "./constraints";
import type { RunOutcome, RunRequest } from "./engineRunner";
import type { EvaluatedBlock } from "./optimizer";
import type { BlockEval, EngineCandidate } from "./scoring";
import { ClientError } from "./errors";

export type Actor = string; // "admin:<id>" | "pd:<id>"

export function actorOf(session: { role: "admin"; adminId: string } | { role: "pd"; pdId: string }): Actor {
  return session.role === "admin" ? `admin:${session.adminId}` : `pd:${session.pdId}`;
}

const r6 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e6);

function evalColumns(e: BlockEval) {
  return {
    expected_kpi: r6(e.expected),
    expected_kpi_type: e.expectedKpiType,
    expected_share: r6(e.expectedShare),
    expected_time_spent: r6(e.expectedTimeSpent),
    confidence_score: r6(e.confidence),
    sample_count: e.sampleCount,
    fallback_level: e.fallbackLevel,
    fitness_score: r6(e.fitness),
    block_value: r6(e.value),
    score_components: e.components,
    penalties: e.penalties,
    reasons: e.reasons,
  };
}

function candidateJson(c: EngineCandidate) {
  return {
    key: c.key,
    programKey: c.programKey,
    contentType: c.contentType,
    programId: c.programId,
    programName: c.programName,
    airingType: c.airingType,
    genre: c.genre,
    runtimeMin: c.runtimeMin,
    sourceChannel: c.sourceChannel,
    aiEligible: c.aiEligible,
    benchmark: c.benchmark ?? null,
  };
}

function blockRow(runId: string, layer: "IDEAL" | "CURRENT", b: EvaluatedBlock, actualKpi: number | null = null) {
  const e = b.eval;
  return {
    id: randomUUID(),
    run_id: runId,
    layer,
    weekday: b.weekday,
    start_min: r6(b.startMin),
    end_min: r6(b.endMin),
    program_id: b.candidate.contentType === "OWN" && b.candidate.programId && !b.candidate.programId.startsWith("__") ? b.candidate.programId : null,
    candidate_key: b.candidate.key,
    program_key: b.candidate.programKey,
    program_name: b.candidate.programName,
    content_type: b.candidate.contentType,
    source_channel: b.candidate.sourceChannel,
    genre: b.candidate.genre,
    airing_type: b.candidate.airingType,
    status: layer === "CURRENT" ? "CURRENT" : b.status,
    locked: layer === "IDEAL" && b.fixed,
    time_changed: b.timeChanged ?? null,
    baseline: r6(e.baseline),
    strategy_type: e.strategy.type,
    competitor_slot_strength: r6(e.strategy.competitorSlotStrength),
    benchmark_index: r6(e.strategy.benchmarkIndex),
    match_score: r6(e.strategy.matchScore),
    counter_score: r6(e.strategy.counterScore),
    constraint_ref: b.constraint ?? null,
    episode_number: b.episode && !("none" in b.episode) ? b.episode.episodeNumber : null,
    episode_subtitle: b.episode && !("none" in b.episode) ? b.episode.subtitle : null,
    episode_info: b.episode ?? null,
    actual_kpi: r6(actualKpi),
    ...evalColumns(e),
  };
}

async function insertChunks(table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table} 저장 실패: ${error.message}`);
  }
}

export async function saveRun(req: RunRequest, out: RunOutcome, actor: Actor, parentRunId: string | null = null): Promise<string> {
  const runId = randomUUID();
  const current = out.evaluations.CURRENT ?? null;
  const summary = {
    ...out.summary,
    warnings: out.warnings,
    timingsMs: out.timingsMs,
    localSearchMoves: out.output.localSearchMoves,
    current: current
      ? {
          weekStart: current.weekStart,
          expectedAvgRating: current.expectedAvgRating,
          actualAvgRating: current.actualAvgRating,
          expectedAvgShare: current.expectedAvgShare,
          expectedAvgTimeSpent: current.expectedAvgTimeSpent,
          objective: current.objective,
          calibration: current.calibration,
        }
      : null,
  };
  const { error } = await supabase.from("ideal_schedule_runs").insert({
    id: runId,
    channel_id: out.channel.id,
    week_start: req.weekStart,
    as_of_date: out.asOfDate,
    structure_mode: req.mode,
    strategy_mode: req.strategyMode,
    benchmark_placement: req.benchmarkPlacement ?? out.config.strategy.benchmark_placement,
    competitor_names: [...req.competitorNames].sort(),
    competitor_target_mode: req.competitorTargetMode ?? out.config.strategy.competitor_target_mode,
    episode_mode: req.episodeMode ?? "PROGRAM",
    optimize_target_label: out.summary.optimizeTarget.label,
    optimize_target_is_channel_kpi: out.summary.optimizeTarget.isChannelKpi,
    config_snapshot: out.config,
    input_fingerprint: out.fingerprint,
    objective: r6(out.output.objective),
    summary,
    conflicts: out.resolution.conflicts,
    resolution: {
      overridden: out.resolution.overridden,
      duplicates: out.resolution.duplicates,
      inactive: out.resolution.inactive,
      blockedZones: out.resolution.blockedZones,
      warnings: out.warnings,
    },
    gaps: out.output.gaps,
    empty_slots: out.output.emptySlots,
    current_week_start: out.currentWeekStart,
    status: out.resolution.conflicts.length > 0 ? "CONFLICT" : "DONE",
    parent_run_id: parentRunId,
    engine_ms: out.timingsMs.engine,
    created_by: actor,
  });
  if (error) throw new Error(`ideal_schedule_runs 저장 실패: ${error.message}`);

  const blockRows = out.output.blocks.map((b) => ({ row: blockRow(runId, "IDEAL", b), block: b }));
  const currentRows = (current?.rows ?? []).map((r) => blockRow(runId, "CURRENT", r.block, r.actual.r));
  await insertChunks("ideal_schedule_blocks", [...blockRows.map((x) => x.row), ...currentRows]);

  const candRows = blockRows.flatMap(({ row, block }) =>
    (block.alternatives ?? []).map((alt, i) => ({
      run_id: runId,
      block_id: row.id,
      rank: i + 1,
      candidate: candidateJson(alt.candidate),
      strategy_type: alt.eval.strategy.type,
      strategy: alt.eval.strategy,
      target_score: r6(alt.eval.components.target),
      slot_fit: r6(alt.eval.components.weekday_slot),
      ...evalColumns(alt.eval),
    }))
  );
  await insertChunks("ideal_schedule_candidates", candRows);
  return runId;
}

export async function loadRun(runId: string) {
  const { data: run, error } = await supabase.from("ideal_schedule_runs").select("*, channels(id, code, name, theme_color, primary_target)").eq("id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!run) return null;
  const blocks: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: bErr } = await supabase
      .from("ideal_schedule_blocks")
      .select("*")
      .eq("run_id", runId)
      .order("layer")
      .order("weekday")
      .order("start_min")
      .range(from, from + 999);
    if (bErr) throw new Error(bErr.message);
    blocks.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { run, blocks };
}

export async function loadCandidates(runId: string, blockId: string) {
  const { data, error } = await supabase.from("ideal_schedule_candidates").select("*").eq("run_id", runId).eq("block_id", blockId).order("rank");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Swap: 저장된 대체 후보로 블록을 교체 → MANUAL_OVERRIDE + LOCK. 이웃 블록 점수·합계는 [다시 계산] 전까지
 *  갱신되지 않으므로 실행에 needs_recalc 표시. 후보의 평가값은 같은 자리·같은 직전 편성 기준으로 엔진이 계산한 값. */
export async function swapBlock(runId: string, blockId: string, candidateId: string, actor: Actor) {
  const { data: cand, error } = await supabase.from("ideal_schedule_candidates").select("*").eq("id", candidateId).eq("block_id", blockId).eq("run_id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!cand) throw new ClientError("해당 블록의 대체 후보가 아닙니다.");
  const c = cand.candidate as ReturnType<typeof candidateJson>;
  const strategy = cand.strategy as BlockEval["strategy"];
  const { data: updated, error: uErr } = await supabase
    .from("ideal_schedule_blocks")
    .update({
      program_id: c.contentType === "OWN" && c.programId && !c.programId.startsWith("__") ? c.programId : null,
      candidate_key: c.key,
      program_key: c.programKey,
      program_name: c.programName,
      content_type: c.contentType,
      source_channel: c.sourceChannel,
      genre: c.genre,
      airing_type: c.airingType,
      status: "MANUAL_OVERRIDE",
      locked: true,
      expected_kpi: cand.expected_kpi,
      expected_kpi_type: cand.expected_kpi_type,
      expected_share: cand.expected_share,
      expected_time_spent: cand.expected_time_spent,
      confidence_score: cand.confidence_score,
      sample_count: cand.sample_count,
      fallback_level: cand.fallback_level,
      fitness_score: cand.fitness_score,
      block_value: cand.block_value,
      strategy_type: cand.strategy_type,
      competitor_slot_strength: strategy?.competitorSlotStrength ?? null,
      benchmark_index: strategy?.benchmarkIndex ?? null,
      match_score: strategy?.matchScore ?? null,
      counter_score: strategy?.counterScore ?? null,
      score_components: cand.score_components,
      penalties: cand.penalties,
      reasons: cand.reasons,
      updated_by: actor,
      updated_at: new Date().toISOString(),
    })
    .eq("id", blockId)
    .eq("run_id", runId)
    .eq("layer", "IDEAL")
    .in("status", ["AI", "MANUAL_OVERRIDE"]) // 필수·LOCK 편성은 교체 불가
    .select("*")
    .maybeSingle();
  if (uErr) throw new Error(uErr.message);
  if (!updated) throw new ClientError("교체할 수 없는 블록입니다(필수 편성·LOCK은 교체 불가).");
  await supabase.from("ideal_schedule_runs").update({ needs_recalc: true }).eq("id", runId);
  return updated;
}

export async function setBlockLock(runId: string, blockId: string, locked: boolean, actor: Actor) {
  const { data, error } = await supabase
    .from("ideal_schedule_blocks")
    .update({ locked, updated_by: actor, updated_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("run_id", runId)
    .eq("layer", "IDEAL")
    .in("status", ["AI", "MANUAL_OVERRIDE"]) // 필수 편성은 항상 고정
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientError("잠금을 바꿀 수 없는 블록입니다.");
  return data;
}

export async function saveRunAs(runId: string, title: string | null, actor: Actor) {
  const { data, error } = await supabase
    .from("ideal_schedule_runs")
    .update({ title, saved_at: new Date().toISOString(), saved_by: actor })
    .eq("id", runId)
    .select("id, title, saved_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** [다시 계산]에 넘길 원래 실행 파라미터 + (유지 선택 시) 수동 변경·LOCK 블록을 rank 1 제약으로. */
export async function recalcRequestFrom(runId: string, keepOverrides: boolean): Promise<{ req: RunRequest; parentRunId: string }> {
  const loaded = await loadRun(runId);
  if (!loaded) throw new ClientError("실행을 찾을 수 없습니다.");
  const run = loaded.run as Record<string, unknown> & { channels: { code: string } | { code: string }[] };
  const ch = Array.isArray(run.channels) ? run.channels[0] : run.channels;
  const extraLocks: HardConstraintInput[] = keepOverrides
    ? (loaded.blocks as Record<string, unknown>[])
        .filter((b) => b.layer === "IDEAL" && (b.status === "MANUAL_OVERRIDE" || (b.status === "AI" && b.locked === true)))
        .map((b) => ({
          id: `block:${b.id}`,
          rank: 1,
          priority: 1,
          source: "USER_LOCK",
          constraintType: b.status === "MANUAL_OVERRIDE" ? "MANUAL_OVERRIDE" : "USER_LOCK",
          programId: (b.program_id as string | null) ?? null,
          programName: b.program_name as string,
          weekday: b.weekday as number,
          startMin: Number(b.start_min),
          durationMin: Number(b.end_min) - Number(b.start_min),
          activeFrom: null,
          activeTo: null,
          locked: true,
          candidateKey: b.candidate_key as string,
        }))
    : [];
  return {
    parentRunId: runId,
    req: {
      channelCode: ch.code,
      weekStart: run.week_start as string,
      mode: run.structure_mode as RunRequest["mode"],
      strategyMode: run.strategy_mode as RunRequest["strategyMode"],
      competitorNames: (run.competitor_names as string[]) ?? [],
      competitorTargetMode: (run.competitor_target_mode as RunRequest["competitorTargetMode"]) ?? undefined,
      benchmarkPlacement: run.benchmark_placement as RunRequest["benchmarkPlacement"],
      optimizeTargetLabel: run.optimize_target_is_channel_kpi ? undefined : (run.optimize_target_label as string),
      episodeMode: (run.episode_mode as RunRequest["episodeMode"]) ?? "PROGRAM",
      extraLocks,
    },
  };
}

/** CURRENT vs IDEAL 대조 — 요일별로 IDEAL 블록마다 시간이 가장 많이 겹치는 CURRENT 블록을 짝지어 기대값 차이와
 *  변경 여부를 돌려준다(계산 없음: 둘 다 저장된 엔진 값의 차). */
export function buildComparison(blocks: Record<string, unknown>[]) {
  const ideal = blocks.filter((b) => b.layer === "IDEAL");
  const current = blocks.filter((b) => b.layer === "CURRENT");
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rows = ideal.map((b) => {
    const s = Number(b.start_min);
    const e = Number(b.end_min);
    let best: Record<string, unknown> | null = null;
    let bestOverlap = 0;
    for (const c of current) {
      if (c.weekday !== b.weekday) continue;
      const ov = Math.min(e, Number(c.end_min)) - Math.max(s, Number(c.start_min));
      if (ov > bestOverlap) {
        bestOverlap = ov;
        best = c;
      }
    }
    const ie = num(b.expected_kpi);
    const ce = best ? num(best.expected_kpi) : null;
    return {
      weekday: b.weekday,
      startMin: s,
      endMin: e,
      ideal: { blockId: b.id, programName: b.program_name, episodeSubtitle: b.episode_subtitle ?? null, programKey: b.program_key, status: b.status, contentType: b.content_type, expectedKpi: ie, expectedKpiType: b.expected_kpi_type, expectedShare: num(b.expected_share), confidence: num(b.confidence_score), reasons: b.reasons },
      current: best
        ? { blockId: best.id, programName: best.program_name, episodeSubtitle: best.episode_subtitle ?? null, programKey: best.program_key, startMin: Number(best.start_min), endMin: Number(best.end_min), expectedKpi: ce, expectedShare: num(best.expected_share), actualKpi: num(best.actual_kpi) }
        : null,
      changed: !best || best.program_key !== b.program_key,
      expectedKpiDiff: ie !== null && ce !== null ? ie - ce : null,
      expectedShareDiff: num(b.expected_share) !== null && best && num(best.expected_share) !== null ? (num(b.expected_share) as number) - (num(best.expected_share) as number) : null,
    };
  });
  return rows;
}
