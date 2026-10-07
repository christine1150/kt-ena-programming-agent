// 확정 준비 재검사(OPT06, 서버 전용) — 최신 Avail·편성안·필수 편성·제약으로 지금 편성안을 다시 검사한다(readiness.ts가 판정).
// 조회와 검사 기록뿐이다: 권리 예약·원장 기록·편성 저장·운영 반영을 하지 않는다. 기록은 summary.workingCopy.readiness(요약)에만 남는다.
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { loadConstraintInputs } from "./constraintStore";
import { resolveHardConstraints } from "./constraints";
import { revertToBase } from "./editLog";
import { validateEngineOutput } from "./outputValidator";
import type { PlacedBlock } from "./optimizer";
import { evaluateReadiness, type ReadinessInput, type ReadinessResult, type ReadinessSlot, type ReadinessViolation } from "./readiness";
import { loadRightsLookup, type RightsLookup } from "./rightsServer";
import { loadRunView } from "./workingCopy";
import { buildRunScorer, candidateOf, capOverrideFrom } from "./workingContext";
import type { StoredReadiness, ViewBlock } from "./workingView";
import type { Actor } from "./runStore";
import { ClientError } from "./errors";

const WD = ["", "월", "화", "수", "목", "금", "토", "일"];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

type Row = Record<string, unknown>;

export interface ReadinessOutcome {
  result: ReadinessResult;
  rights: { status: RightsLookup["status"]; message: string | null; inventoryVersion: string | null };
  slots: { blockId: string; weekday: number; startMin: number; endMin: number; programName: string; rights: ReadinessSlot["rights"]; runtimeMin: number | null }[];
  checkedAt: string;
}

export async function computeReadiness(runId: string, opts: { seen?: { planVersion?: unknown; editSeq?: unknown } } = {}): Promise<ReadinessOutcome> {
  const view = await loadRunView(runId);
  if (!view) throw new ClientError("실행을 찾을 수 없습니다.");
  const run = view.run as Row & { week_start: string; summary: Record<string, unknown> | null; channels: { id: string; code: string } | { id: string; code: string }[] };
  const ch = Array.isArray(run.channels) ? run.channels[0] : run.channels;
  const ideal = (view.blocks as ViewBlock[]).filter((b) => (b.layer ?? "IDEAL") === "IDEAL");
  const [lookup, ctx] = await Promise.all([loadRightsLookup(), buildRunScorer(run as unknown as Parameters<typeof buildRunScorer>[0], ch.code)]);

  // 최신 권리로 칸마다 다시 판정(회차를 알면 그 회차로)
  const slots: ReadinessSlot[] = ideal.map((b) => {
    const cand = candidateOf(ctx, { candidate_key: String(b.candidate_key), program_key: String(b.program_key ?? ""), program_id: (b.program_id as string | null) ?? null, program_name: String(b.program_name), content_type: String(b.content_type), airing_type: (b.airing_type as string | null) ?? null });
    const episode = b.episode_number === null || b.episode_number === undefined ? null : Number(b.episode_number);
    const rights = lookup.check({ contentType: String(b.content_type), programId: (b.program_id as string | null) ?? null, programName: String(b.program_name), genre: (b.genre as string | null) ?? null }, run.week_start, ch.code, Number(b.weekday), Number(b.start_min), Number(b.end_min), episode);
    return { blockId: b.id, weekday: Number(b.weekday), startMin: Number(b.start_min), endMin: Number(b.end_min), programName: String(b.program_name), programKey: String(b.program_key ?? ""), contentType: String(b.content_type), episodeNumber: episode, runtimeMin: cand?.runtimeMin ?? null, rights };
  });

  // 하드 제약: 겹침·방송일 범위·반복 한도. 한도는 "설정 한도 또는 원래 계산안이 이미 허용한 횟수" 중 큰 값 — 수동 교체로 *늘어난* 편성만 위반으로 본다.
  const placedOf = (rows: ViewBlock[]): PlacedBlock[] => {
    const out: PlacedBlock[] = [];
    for (const b of rows) {
      const cand = candidateOf(ctx, { candidate_key: String(b.candidate_key), program_key: String(b.program_key ?? ""), program_id: (b.program_id as string | null) ?? null, program_name: String(b.program_name), content_type: String(b.content_type), airing_type: (b.airing_type as string | null) ?? null });
      if (!cand) continue;
      const status = b.status as PlacedBlock["status"];
      out.push({ weekday: Number(b.weekday), startMin: Number(b.start_min), endMin: Number(b.end_min), candidate: cand, status, fixed: status === "REQUIRED" || status === "LOCKED" });
    }
    return out;
  };
  const base = placedOf(revertToBase(ideal, view.log));
  const capOverride = capOverrideFrom(ctx.config, base);
  const validation = validateEngineOutput({ blocks: placedOf(ideal), fixed: [], config: ctx.config, capOverride });
  const violations: ReadinessViolation[] = validation.violations.map((v) => ({ constraintId: v.constraintId, message: v.message, weekday: v.weekday, startMin: v.startMin }));

  // 필수 편성: 지금 저장된 필수·고정 설정이 IDEAL에 그 자리로 있는가(계산 뒤에 설정이 바뀌었을 수 있다)
  let requiredUnchecked: string | null = null;
  try {
    const load = await loadConstraintInputs(ch.id, run.week_start);
    const resolved = resolveHardConstraints(load.inputs, run.week_start);
    for (const f of resolved.fixed) {
      const name = normalizeProgramCanonicalName(f.input.programName);
      const hit = ideal.find((b) => Number(b.weekday) === f.weekday && Math.abs(Number(b.start_min) - f.startMin) < 1 && ((f.input.programId && b.program_id === f.input.programId) || normalizeProgramCanonicalName(String(b.program_name)) === name));
      if (!hit) violations.push({ constraintId: "FIXED", message: `필수 편성 ${f.input.programName}이(가) ${WD[f.weekday]} ${hhmm(f.startMin)}에 없습니다(계산 뒤 필수 설정이 바뀌었을 수 있음)`, weekday: f.weekday, startMin: f.startMin });
    }
  } catch (e) {
    requiredUnchecked = e instanceof Error ? e.message : String(e);
  }

  const summary = (run.summary ?? {}) as { rights?: { inventoryVersion?: string | null } | null; emptySlotCount?: number };
  const seenVersion = typeof opts.seen?.planVersion === "string" ? opts.seen.planVersion : null;
  const seenSeq = typeof opts.seen?.editSeq === "number" ? opts.seen.editSeq : null;
  const input: ReadinessInput = {
    slots,
    availConfigured: lookup.status === "applied",
    availError: lookup.message,
    violations,
    planVersion: view.working.planVersion,
    editSeq: view.working.editSeq,
    seen: { planVersion: seenVersion, editSeq: seenSeq },
    evaluationCurrent: view.working.state.valuesCurrent,
    rightsInventory: { atCompute: summary.rights?.inventoryVersion ?? null, now: lookup.inventoryVersion },
    emptySlots: summary.emptySlotCount ?? 0,
    requiredUnchecked,
  };
  const result = evaluateReadiness(input);
  return {
    result,
    rights: { status: lookup.status, message: lookup.message, inventoryVersion: lookup.inventoryVersion },
    slots: slots.map((s) => ({ blockId: s.blockId, weekday: s.weekday, startMin: s.startMin, endMin: s.endMin, programName: s.programName, rights: s.rights, runtimeMin: s.runtimeMin })),
    checkedAt: new Date().toISOString(),
  };
}

/** 검사 결과 요약을 작업본에 기록한다(검토안으로 저장할 때 "실행 가능 아님"이 함께 남도록). 권리 예약·편성 저장이 아니다. */
export async function recordReadiness(runId: string, out: ReadinessOutcome, actor: Actor): Promise<StoredReadiness> {
  const { data, error } = await supabase.from("ideal_schedule_runs").select("summary").eq("id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientError("실행을 찾을 수 없습니다.");
  const stored: StoredReadiness = { state: out.result.state, label: out.result.label, checkedAt: out.checkedAt, planVersion: out.result.planVersion, editSeq: out.result.editSeq, counts: out.result.counts, inventoryVersion: out.rights.inventoryVersion, checkedBy: actor };
  const summary = (data.summary ?? {}) as { workingCopy?: Row };
  const { error: uErr } = await supabase.from("ideal_schedule_runs").update({ summary: { ...summary, workingCopy: { ...(summary.workingCopy ?? {}), readiness: stored } } }).eq("id", runId);
  if (uErr) throw new Error(uErr.message);
  return stored;
}
