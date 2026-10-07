// 작업본 보기(OPT06) — 순수 함수. 저장된 실행(summary.workingCopy + 블록)에서 "지금 편성안"의 버전·상태·이력·재평가 값 덮어쓰기를 한 번에 만든다.
// GET 실행·비교·내보내기·확정 준비·비교 카드가 모두 이 함수를 지나므로 같은 편성안·같은 값을 가리킨다(0.047/0.048처럼 다른 버전 값이 섞이지 않는다).
import { canRedo, canUndo, emptyLog, historyLines, netEditedBlocks, parseLog, type EditLog } from "./editLog";
import { overlayEvaluation, planVersionOf, weeklyExpectedOf, workingStateOf, type VersionBlock, type WorkingEvaluation, type WorkingStateInfo } from "./planVersion";

type Row = Record<string, unknown>;
export type ViewBlock = Row & VersionBlock & { id: string; start_min: number | string; end_min: number | string; expected_kpi: number | string | null; content_type?: string };

/** 마지막 확정 준비 검사 기록(요약). 편성안이 바뀌면 current=false — 확정 직전에 다시 검사해야 한다. */
export interface StoredReadiness {
  state: "EXECUTABLE" | "REVIEW_ONLY" | "BLOCKED";
  label: string;
  checkedAt: string;
  planVersion: string;
  editSeq: number;
  counts: { executable: number; reviewOnly: number; blocked: number; total: number };
  inventoryVersion: string | null;
  checkedBy: string;
}

export interface WorkingView {
  /** 지금 편성안의 내용 버전 — 상단·격자·내보내기·이력이 모두 이 값을 가리킨다 */
  planVersion: string;
  /** 계산 완료본(수정 전)의 버전 */
  baseVersion: string;
  /** 동시 수정 감지 토큰(되돌리기·다시 실행 포함 모든 변경마다 오른다) */
  editSeq: number;
  canUndo: boolean;
  canRedo: boolean;
  editedBlocks: { blockId: string; from: string; to: string; slot: { weekday: number; startMin: number; endMin: number }; reason: string | null; rights: { status: string; label: string; reviewOnly: boolean } | null }[];
  history: { seq: number; applied: boolean; kind: string; text: string; reason: string | null; actor: string; at: string }[];
  state: WorkingStateInfo;
  /** 재평가 값이 지금 편성안에 적용되었나(버전이 같을 때만) */
  evaluation: { applied: boolean; evaluatedAt: string | null; evaluatedVersion: string | null; scope: string[]; skipped: number; baseline: { stored: number | null; fresh: number | null } | null } | null;
  /** 지금 편성안 그대로의 주간 기대(편성 분 가중) — 화면·내보내기·재평가가 같은 식 */
  weeklyExpected: number | null;
  /** [다시 계산]에서 유지를 고르면 보존되는 수동 고정(수동 교체·잠금) 개수 — 필수·고정 규칙은 항상 유지 */
  preserve: { manualOverride: number; userLocked: number };
  /** 마지막 확정 준비 검사 — 지금 편성안과 같은 버전일 때만 current */
  readiness: (StoredReadiness & { current: boolean }) | null;
}

export function workingCopyOf(summary: unknown): { log: EditLog | null; evaluation: WorkingEvaluation | null; readiness: StoredReadiness | null } {
  const wc = (summary as { workingCopy?: { editLog?: unknown; evaluation?: unknown; readiness?: unknown } } | null | undefined)?.workingCopy;
  const rd = wc?.readiness as StoredReadiness | undefined;
  const ev = wc?.evaluation as WorkingEvaluation | undefined;
  return { log: parseLog(wc?.editLog), evaluation: ev && typeof ev.planVersion === "string" && ev.byBlock ? ev : null, readiness: rd && typeof rd.planVersion === "string" && typeof rd.state === "string" ? rd : null };
}

export function buildWorkingView<B extends ViewBlock>(summary: unknown, blocks: B[]): { view: WorkingView; blocks: B[]; log: EditLog; evaluation: WorkingEvaluation | null } {
  const planVersion = planVersionOf(blocks);
  const wc = workingCopyOf(summary);
  const log = wc.log ?? emptyLog(planVersion);
  const edited = netEditedBlocks(log);
  const overlaid = overlayEvaluation(blocks, wc.evaluation, planVersion);
  const state = workingStateOf({ activeEditCount: edited.length, evaluation: wc.evaluation, currentVersion: planVersion });
  const ideal = blocks.filter((b) => (b.layer ?? "IDEAL") === "IDEAL");
  const view: WorkingView = {
    planVersion,
    baseVersion: log.baseVersion,
    editSeq: log.seq,
    canUndo: canUndo(log),
    canRedo: canRedo(log),
    editedBlocks: edited,
    history: historyLines(log),
    state,
    evaluation: wc.evaluation ? { applied: overlaid.applied, evaluatedAt: wc.evaluation.evaluatedAt, evaluatedVersion: wc.evaluation.planVersion, scope: wc.evaluation.scope, skipped: wc.evaluation.skippedBlockIds.length, baseline: wc.evaluation.baseline ?? null } : null,
    weeklyExpected: weeklyExpectedOf(overlaid.blocks),
    preserve: { manualOverride: ideal.filter((b) => b.status === "MANUAL_OVERRIDE").length, userLocked: ideal.filter((b) => b.status === "AI" && b.locked === true).length },
    readiness: wc.readiness ? { ...wc.readiness, current: wc.readiness.planVersion === planVersion } : null,
  };
  return { view, blocks: overlaid.blocks, log, evaluation: wc.evaluation };
}
