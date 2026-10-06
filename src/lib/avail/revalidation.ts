// 편성안의 권리 스냅샷과 재검증(단계 06).
//  - 편성안을 저장할 때 슬롯별 권리 판정과 그때의 권리 목록 버전을 얼려 둔다(과거 snapshot은 바뀌지 않는다, A16).
//  - 권리가 개정·단축되면 같은 편성안은 '재검증 필요'가 되고 영향받는 슬롯을 알려 준다(A12).
//  - 확정 직전에는 스냅샷이 아니라 최신 권리·원장으로 다시 검사한다. 모든 슬롯이 available이어야 확정할 수 있다(A15·A18).
import { evaluateEligibility, type EvalContext } from "./evaluate";
import type { ContentQuery, EligibilityResult, EligibilityStatus, SlotRef } from "./types";

export interface PlanSlotInput {
  slotKey: string;
  candidateKey: string;
  query: ContentQuery;
  slot: SlotRef;
}

export interface PlanSlotSnapshot extends PlanSlotInput {
  status: EligibilityStatus;
  reasonCodes: string[];
  grantRevisionIds: string[];
  expiresOn: string | null;
}

export interface PlanRightsSnapshot {
  planId: string;
  scheduleRevisionId: string;
  capturedAt: string;
  inventoryVersion: string;
  slots: PlanSlotSnapshot[];
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export function snapshotPlanRights(planId: string, scheduleRevisionId: string, slots: PlanSlotInput[], ctx: EvalContext): PlanRightsSnapshot {
  const snap: PlanRightsSnapshot = {
    planId,
    scheduleRevisionId,
    capturedAt: ctx.now,
    inventoryVersion: ctx.inventoryVersion,
    slots: slots.map((s) => {
      const r = evaluateEligibility(s.query, s.slot, { ...ctx, scheduleRevisionId });
      return { ...JSON.parse(JSON.stringify(s)), status: r.status, reasonCodes: r.reasonCodes, grantRevisionIds: r.grantRevisionIds, expiresOn: r.expiresOn };
    }),
  };
  return deepFreeze(snap);
}

export interface SlotRevalidation {
  slotKey: string;
  candidateKey: string;
  before: EligibilityStatus;
  after: EligibilityStatus;
  changed: boolean;
  /** 이 슬롯이 근거로 삼았던 revision 중 더는 현재가 아닌 것 */
  supersededRevisionIds: string[];
  afterReasonCodes: string[];
}

export interface RevalidationResult {
  state: "current" | "needs_revalidation";
  snapshotInventoryVersion: string;
  currentInventoryVersion: string;
  affectedSlots: SlotRevalidation[];
  /** 상태가 나빠진 슬롯(available → 그 외) */
  worsened: SlotRevalidation[];
}

export function revalidatePlan(snap: PlanRightsSnapshot, ctx: EvalContext, currentRevisionIds: Set<string>): RevalidationResult {
  const rows: SlotRevalidation[] = snap.slots.map((s) => {
    const r = evaluateEligibility(s.query, s.slot, ctx);
    return {
      slotKey: s.slotKey,
      candidateKey: s.candidateKey,
      before: s.status,
      after: r.status,
      changed: r.status !== s.status,
      supersededRevisionIds: s.grantRevisionIds.filter((id) => !currentRevisionIds.has(id)),
      afterReasonCodes: r.reasonCodes,
    };
  });
  const affected = rows.filter((r) => r.changed || r.supersededRevisionIds.length > 0);
  const stale = snap.inventoryVersion !== ctx.inventoryVersion && affected.length > 0;
  return { state: stale ? "needs_revalidation" : "current", snapshotInventoryVersion: snap.inventoryVersion, currentInventoryVersion: ctx.inventoryVersion, affectedSlots: stale ? affected : [], worsened: rows.filter((r) => r.before === "available" && r.after !== "available") };
}

export interface FinalizeCheck {
  canFinalize: boolean;
  blockers: { slotKey: string; candidateKey: string; status: EligibilityStatus; reasonCodes: string[] }[];
  /** Avail 자료가 없어 확정 가능 여부를 판정하지 못함 */
  pendingNoAvail: boolean;
}

/** 확정 직전 검사 — 최신 권리로 다시 평가하고, available이 아닌 슬롯이 하나라도 있으면 확정할 수 없다. */
export function finalizeCheck(slots: PlanSlotInput[], ctx: EvalContext): FinalizeCheck {
  if (ctx.grants.length === 0) return { canFinalize: false, blockers: [], pendingNoAvail: true };
  const blockers: FinalizeCheck["blockers"] = [];
  for (const s of slots) {
    const r: EligibilityResult = evaluateEligibility(s.query, s.slot, ctx);
    if (r.status !== "available") blockers.push({ slotKey: s.slotKey, candidateKey: s.candidateKey, status: r.status, reasonCodes: r.reasonCodes });
  }
  return { canFinalize: blockers.length === 0, blockers, pendingNoAvail: false };
}

/** 과거 계획 조회: 당시 판정(스냅샷)과 현재 효력을 따로 보여 준다. */
export function viewPastPlan(snap: PlanRightsSnapshot, ctx: EvalContext): { slotKey: string; statusThen: EligibilityStatus; statusNow: EligibilityStatus }[] {
  return snap.slots.map((s) => ({ slotKey: s.slotKey, statusThen: s.status, statusNow: evaluateEligibility(s.query, s.slot, ctx).status }));
}
