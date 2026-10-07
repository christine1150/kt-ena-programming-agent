// 작업본(수동 수정본) 저장·되돌리기·재평가(OPT06, 서버 전용).
//
// DB 마이그레이션 없이 `ideal_schedule_runs.summary.workingCopy`(jsonb)에 수정 이력과 재평가 값을 둔다:
//   { editLog: { seq, cursor, entries[], baseVersion }, evaluation: WorkingEvaluation }
// 블록 행에는 지금 편성안의 *내용*(후보·잠금)만 쓰고, 이웃·반복을 반영한 재평가 값은 평가 객체에 버전과 함께 두어 같은 버전에서만 덮어쓴다(planVersion.ts).
//
// 동시 수정: 화면이 마지막으로 본 editSeq(baseSeq)가 서버의 것과 다르면 거부한다. 같은 순간에 들어온 두 요청은 막지 못한다(DB에 버전 열이 없다 — 한계로 기록, 열 추가는 별도 승인 사항).
// 되돌리기: 수정 전·후 블록 상태 전체를 이력에 저장해 정확히 복원한다. 수정 개수는 제한하지 않는다(이력 저장 크기 보호만 있다 — editLog.MAX_ENTRIES).
import { supabase } from "@/lib/supabase";
import { MODEL_VERSION } from "./engine";
import { evaluateSchedule, type PlacedBlock } from "./optimizer";
import { ClientError } from "./errors";
import { MAX_ENTRIES, cleanReason, recordEdit, redoStep, revertToBase, snapshotOf, undoStep, netEditedBlocks, type BlockSnapshot, type EditEntry, type EditLog } from "./editLog";
import { EVALUATION_SCOPE, planVersionOf, weeklyExpectedOf, type BlockEvalOverlay, type WorkingEvaluation } from "./planVersion";
import { loadRightsLookup } from "./rightsServer";
import { candidateJson, evalColumns, loadRun, type Actor } from "./runStore";
import { swapRightsVerdict } from "./slotRights";
import { buildWorkingView, type ViewBlock, type WorkingView } from "./workingView";
import { buildRunScorer, candidateOf } from "./workingContext";

type Row = Record<string, unknown>;

const SWAPPABLE = ["AI", "MANUAL_OVERRIDE"];

/** 교체 때 붙은 기록은 재평가해도 지우지 않는다 */
const KEEP_REASON_CODES = new Set(["MANUAL_SEARCH", "RIGHTS_AT_SWAP"]);

async function loadForEdit(runId: string) {
  const loaded = await loadRun(runId);
  if (!loaded) throw new ClientError("실행을 찾을 수 없습니다.");
  const run = loaded.run as Row & { week_start: string; summary: Record<string, unknown> | null; channels: { id: string; code: string } | { id: string; code: string }[] };
  const ch = Array.isArray(run.channels) ? run.channels[0] : run.channels;
  const blocks = loaded.blocks as ViewBlock[];
  const built = buildWorkingView(run.summary, blocks);
  return { run, ch, blocks, view: built.view, log: built.log, evaluation: built.evaluation };
}

function checkSeq(log: EditLog, baseSeq: unknown) {
  if (baseSeq === undefined || baseSeq === null) return;
  if (typeof baseSeq !== "number" || baseSeq !== log.seq) throw new ClientError("다른 화면에서 이 작업본이 바뀌었습니다 — 새로 불러온 뒤 다시 시도해 주세요(덮어쓰지 않았습니다).");
}

async function persist(runId: string, summary: Record<string, unknown> | null, log: EditLog, evaluation: WorkingEvaluation | null, needsRecalc: boolean) {
  const prev = (summary ?? {}) as { workingCopy?: Record<string, unknown> };
  const next = { ...(summary ?? {}), workingCopy: { ...(prev.workingCopy ?? {}), editLog: log, ...(evaluation ? { evaluation } : {}) } };
  const { error } = await supabase.from("ideal_schedule_runs").update({ summary: next, needs_recalc: needsRecalc }).eq("id", runId);
  if (error) throw new Error(`작업본 저장 실패: ${error.message}`);
}

async function writeBlock(runId: string, blockId: string, patch: Row, actor: Actor): Promise<Row> {
  const { data, error } = await supabase
    .from("ideal_schedule_blocks")
    .update({ ...patch, updated_by: actor, updated_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("run_id", runId)
    .eq("layer", "IDEAL")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientError("블록을 찾을 수 없습니다.");
  return data as Row;
}

/** 지금 블록 목록에서 한 블록을 바꾼 새 목록(되돌리기 위해 DB 쓰기 뒤 메모리에서 버전을 다시 계산한다) */
const withBlock = (blocks: ViewBlock[], row: Row) => blocks.map((b) => (b.id === row.id ? ({ ...b, ...row } as ViewBlock) : b));

export interface EditResult {
  block?: Row;
  working: WorkingView;
  /** 교체 때 판정한 권리(검토안만이면 reviewOnly) */
  rights?: { status: string; label: string; reviewOnly: boolean; message: string | null } | null;
}

async function finish(runId: string, run: Awaited<ReturnType<typeof loadForEdit>>["run"], blocks: ViewBlock[], log: EditLog, evaluation: WorkingEvaluation | null): Promise<WorkingView> {
  const needs = netEditedBlocks(log).length > 0;
  await persist(runId, run.summary, log, evaluation, needs);
  const prevWc = ((run.summary ?? {}) as { workingCopy?: Row }).workingCopy ?? {};
  const after = buildWorkingView({ ...(run.summary ?? {}), workingCopy: { ...prevWc, editLog: log, ...(evaluation ? { evaluation } : {}) } }, blocks);
  return after.view;
}

/** 저장된 대체 후보로 교체 → 수동 변경 + 잠금. 권리상 불가면 거부하고, 조건부·미확인이면 검토안으로만 둔다(실행 가능 표시 금지). */
export async function swapWithLog(runId: string, blockId: string, candidateId: string, actor: Actor, opts: { reason?: unknown; baseSeq?: unknown } = {}): Promise<EditResult> {
  const { run, ch, blocks, log, evaluation } = await loadForEdit(runId);
  checkSeq(log, opts.baseSeq);
  const block = blocks.find((b) => b.id === blockId && (b.layer ?? "IDEAL") === "IDEAL");
  if (!block) throw new ClientError("블록을 찾을 수 없습니다.");
  if (!SWAPPABLE.includes(String(block.status))) throw new ClientError("교체할 수 없는 블록입니다(필수 편성·LOCK은 교체 불가).");
  if (log.entries.slice(0, log.cursor).length >= MAX_ENTRIES) throw new ClientError(`수정 이력이 ${MAX_ENTRIES}건에 도달했습니다 — 이 작업본을 저장하고 [다시 계산]으로 새 편성안을 만든 뒤 이어서 고쳐 주세요.`);

  const { data: cand, error } = await supabase.from("ideal_schedule_candidates").select("*").eq("id", candidateId).eq("block_id", blockId).eq("run_id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!cand) throw new ClientError("해당 블록의 대체 후보가 아닙니다.");
  const c = cand.candidate as ReturnType<typeof candidateJson>;
  const strategy = cand.strategy as { competitorSlotStrength?: number | null; benchmarkIndex?: number | null; matchScore?: number | null; counterScore?: number | null } | null;

  // 권리: 수동 교체도 엔진 게이트와 같은 판정을 거친다(권리상 불가는 거부, 조건부·미확인은 검토안만)
  const lookup = await loadRightsLookup();
  const rights = lookup.check({ contentType: c.contentType, programId: c.programId, programName: c.programName, genre: c.genre }, run.week_start, ch.code, Number(block.weekday), Number(block.start_min), Number(block.end_min));
  const verdict = swapRightsVerdict(rights);
  if (!verdict.allowed) throw new ClientError(verdict.message ?? "권리상 편성할 수 없습니다.");

  const before = snapshotOf(block);
  const baseReasons = Array.isArray(cand.reasons) ? (cand.reasons as unknown[]) : [];
  const reasons = [...baseReasons, { code: "RIGHTS_AT_SWAP", value: rights.status, detail: `교체 시점 권리 판정: ${rights.label}${verdict.message ? ` — ${verdict.message}` : ""}` }];
  const updated = await writeBlock(
    runId,
    blockId,
    {
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
      expected_low: cand.expected_low ?? null,
      expected_high: cand.expected_high ?? null,
      range_basis: cand.range_basis ?? null,
      decision: null, // 직접 교체 — 엔진의 유지/교체 판단은 더 이상 이 블록에 해당하지 않음
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
      reasons,
    },
    actor
  );
  const rec = recordEdit(log, {
    kind: "SWAP",
    blockId,
    slot: { weekday: Number(block.weekday), startMin: Number(block.start_min), endMin: Number(block.end_min) },
    before,
    after: snapshotOf(updated),
    reason: cleanReason(opts.reason),
    actor,
    at: new Date().toISOString(),
    rights: { status: rights.status, label: rights.label, reviewOnly: verdict.reviewOnly },
    from: String(block.program_name),
    to: c.programName,
  });
  if (!rec.ok) {
    await writeBlock(runId, blockId, before as unknown as Row, actor).catch(() => null);
    throw new ClientError(rec.message);
  }
  let working: WorkingView;
  try {
    working = await finish(runId, run, withBlock(blocks, updated), rec.log, evaluation);
  } catch (e) {
    // 이력 저장에 실패하면 되돌릴 수 없는 수정이 남지 않게 블록을 원래대로 복원한다
    await writeBlock(runId, blockId, before as unknown as Row, actor).catch(() => null);
    throw e;
  }
  return { block: updated, working, rights: { status: rights.status, label: rights.label, reviewOnly: verdict.reviewOnly, message: verdict.message } };
}

/** 잠금 켜기/끄기 — 이력에 남아 실행 취소할 수 있다. 필수 편성은 항상 고정이라 바꿀 수 없다. */
export async function setLockWithLog(runId: string, blockId: string, locked: boolean, actor: Actor, opts: { baseSeq?: unknown } = {}): Promise<EditResult> {
  const { run, blocks, log, evaluation } = await loadForEdit(runId);
  checkSeq(log, opts.baseSeq);
  const block = blocks.find((b) => b.id === blockId && (b.layer ?? "IDEAL") === "IDEAL");
  if (!block || !SWAPPABLE.includes(String(block.status))) throw new ClientError("잠금을 바꿀 수 없는 블록입니다.");
  if (Boolean(block.locked) === locked) return { block, working: buildWorkingView(run.summary, blocks).view };
  const before = snapshotOf(block);
  const updated = await writeBlock(runId, blockId, { locked }, actor);
  const rec = recordEdit(log, { kind: locked ? "LOCK" : "UNLOCK", blockId, slot: { weekday: Number(block.weekday), startMin: Number(block.start_min), endMin: Number(block.end_min) }, before, after: snapshotOf(updated), reason: null, actor, at: new Date().toISOString(), rights: null, from: String(block.program_name), to: String(block.program_name) });
  if (!rec.ok) {
    await writeBlock(runId, blockId, before as unknown as Row, actor).catch(() => null);
    throw new ClientError(rec.message);
  }
  try {
    return { block: updated, working: await finish(runId, run, withBlock(blocks, updated), rec.log, evaluation) };
  } catch (e) {
    await writeBlock(runId, blockId, before as unknown as Row, actor).catch(() => null);
    throw e;
  }
}

async function applySnapshot(runId: string, entry: EditEntry, which: BlockSnapshot, actor: Actor): Promise<Row> {
  return writeBlock(runId, entry.blockId, which as unknown as Row, actor);
}

/** 한 단계 실행 취소 — 그 수정의 수정 전 블록 상태로 정확히 복원한다. */
export async function undoEdit(runId: string, actor: Actor, opts: { baseSeq?: unknown } = {}): Promise<EditResult> {
  const { run, blocks, log, evaluation } = await loadForEdit(runId);
  checkSeq(log, opts.baseSeq);
  const step = undoStep(log);
  if (!step) throw new ClientError("되돌릴 수정이 없습니다.");
  const restored = await applySnapshot(runId, step.entry, step.entry.before, actor);
  try {
    return { block: restored, working: await finish(runId, run, withBlock(blocks, restored), step.log, evaluation) };
  } catch (e) {
    await applySnapshot(runId, step.entry, step.entry.after, actor).catch(() => null);
    throw e;
  }
}

/** 한 단계 다시 실행 — 취소했던 수정의 수정 후 상태를 다시 적용한다. */
export async function redoEdit(runId: string, actor: Actor, opts: { baseSeq?: unknown } = {}): Promise<EditResult> {
  const { run, blocks, log, evaluation } = await loadForEdit(runId);
  checkSeq(log, opts.baseSeq);
  const step = redoStep(log);
  if (!step) throw new ClientError("다시 실행할 수정이 없습니다.");
  const applied = await applySnapshot(runId, step.entry, step.entry.after, actor);
  try {
    return { block: applied, working: await finish(runId, run, withBlock(blocks, applied), step.log, evaluation) };
  } catch (e) {
    await applySnapshot(runId, step.entry, step.entry.before, actor).catch(() => null);
    throw e;
  }
}

const OVERLAY_KEYS: (keyof BlockEvalOverlay)[] = ["expected_kpi", "expected_share", "expected_time_spent", "expected_low", "expected_high", "range_basis", "confidence_score", "block_value", "fitness_score", "sample_count", "fallback_level", "penalties", "score_components", "reasons"];

/**
 * 작업본 재평가 — 탐색 없이 지금 편성 그대로를 같은 모델·같은 기준일로 다시 평가한다(인접 편성·반복 노출·그날 장르 편중·주간 합계).
 * 다른 칸을 더 좋게 바꾸는 재계산이 아니다. 결과는 편성안 버전과 함께 저장되어, 이후 편성이 바뀌면 자동으로 무효가 된다.
 * 경쟁 Benchmark·장르 원형 칸은 재평가하지 않고 저장 값을 유지한다(건너뛴 칸으로 표시).
 */
export async function reevaluateWorkingCopy(runId: string, opts: { baseSeq?: unknown } = {}): Promise<EditResult> {
  const { run, ch, blocks, log } = await loadForEdit(runId);
  checkSeq(log, opts.baseSeq);
  const ctx = await buildRunScorer(run as unknown as Parameters<typeof buildRunScorer>[0], ch.code);
  const ideal = blocks.filter((b) => (b.layer ?? "IDEAL") === "IDEAL");
  const placed: PlacedBlock[] = [];
  const idBySlot = new Map<string, string>();
  const rowById = new Map<string, ViewBlock>();
  const skipped: string[] = [];
  for (const b of ideal) {
    const cand = candidateOf(ctx, { candidate_key: String(b.candidate_key), program_key: String(b.program_key ?? ""), program_id: (b.program_id as string | null) ?? null, program_name: String(b.program_name), content_type: String(b.content_type), airing_type: (b.airing_type as string | null) ?? null });
    if (!cand) {
      skipped.push(b.id);
      continue;
    }
    const status = b.status as PlacedBlock["status"];
    // 필수·잠금 규칙 칸은 엔진과 같이 패널티 없는 고정, 추천·수동 교체 칸은 이웃·반복 패널티를 받는다
    placed.push({ weekday: Number(b.weekday), startMin: Number(b.start_min), endMin: Number(b.end_min), candidate: cand, status, fixed: status === "REQUIRED" || status === "LOCKED" });
    idBySlot.set(`${b.weekday}|${Number(b.start_min)}`, b.id);
    rowById.set(b.id, b);
  }
  ctx.scorer.detail = true;
  const ev = evaluateSchedule(ctx.scorer, placed, ctx.config.structure.max_gap_min);
  const byBlock: Record<string, BlockEvalOverlay> = {};
  for (const eb of ev.blocks) {
    const id = idBySlot.get(`${eb.weekday}|${eb.startMin}`);
    if (!id) continue;
    const cols = evalColumns(eb.eval) as unknown as Record<string, unknown>;
    const o: Record<string, unknown> = {};
    for (const k of OVERLAY_KEYS) o[k] = cols[k] === undefined ? null : cols[k];
    // 교체 때 붙은 기록(직접 검색·권리 판정)은 유지
    const kept = ((rowById.get(id)?.reasons as { code: string }[] | null) ?? []).filter((r) => KEEP_REASON_CODES.has(r.code));
    o.reasons = [...kept, ...((o.reasons as unknown[] | null) ?? [])];
    byBlock[id] = o as unknown as BlockEvalOverlay;
  }
  const version = planVersionOf(blocks);
  const overlaid = ideal.map((b) => ({ ...b, ...(byBlock[b.id] ?? {}) }));
  // 수정 전 계산 완료본도 같은 모델로 다시 평가해, 저장 값과의 차이(모델·자료 버전 차이)를 수정 효과와 분리해 남긴다
  let baseline: { stored: number | null; fresh: number | null } | undefined;
  if (netEditedBlocks(log).length > 0) {
    const baseRows = revertToBase(ideal, log);
    const bPlaced: PlacedBlock[] = [];
    const bRow = new Map<string, ViewBlock>();
    for (const b of baseRows) {
      const cand = candidateOf(ctx, { candidate_key: String(b.candidate_key), program_key: String(b.program_key ?? ""), program_id: (b.program_id as string | null) ?? null, program_name: String(b.program_name), content_type: String(b.content_type), airing_type: (b.airing_type as string | null) ?? null });
      if (!cand) continue;
      const status = b.status as PlacedBlock["status"];
      bPlaced.push({ weekday: Number(b.weekday), startMin: Number(b.start_min), endMin: Number(b.end_min), candidate: cand, status, fixed: status === "REQUIRED" || status === "LOCKED" });
      bRow.set(`${b.weekday}|${Number(b.start_min)}`, b);
    }
    ctx.scorer.detail = false;
    const bEv = evaluateSchedule(ctx.scorer, bPlaced, ctx.config.structure.max_gap_min);
    const freshByKey = new Map(bEv.blocks.map((e) => [`${e.weekday}|${e.startMin}`, e.eval.expected]));
    const freshRows = baseRows.map((b) => ({ ...b, expected_kpi: freshByKey.has(`${b.weekday}|${Number(b.start_min)}`) ? (freshByKey.get(`${b.weekday}|${Number(b.start_min)}`) as number | null) : b.expected_kpi }));
    baseline = { stored: weeklyExpectedOf(baseRows), fresh: weeklyExpectedOf(freshRows) };
  }
  const fresh: WorkingEvaluation = {
    planVersion: version,
    evaluatedAt: new Date().toISOString(),
    kind: "REEVALUATE_WORKING_COPY",
    model: MODEL_VERSION,
    objective: ev.objective,
    weeklyExpected: weeklyExpectedOf(overlaid),
    byBlock,
    skippedBlockIds: skipped,
    scope: [...EVALUATION_SCOPE],
    ...(baseline ? { baseline } : {}),
  };
  const working = await finish(runId, run, blocks, log, fresh);
  return { working };
}

/** 화면·비교·내보내기·확정 준비가 쓰는 "지금 편성안" — 같은 버전의 재평가 값이 덮어쓰인 블록과 작업본 보기. */
export async function loadRunView(runId: string) {
  const loaded = await loadRun(runId);
  if (!loaded) return null;
  const blocks = loaded.blocks as ViewBlock[];
  const built = buildWorkingView((loaded.run as { summary: unknown }).summary, blocks);
  return { run: loaded.run, blocks: built.blocks, working: built.view, log: built.log, evaluation: built.evaluation };
}
