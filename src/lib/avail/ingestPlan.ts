// Avail 반영 계획(단계 06) — 파일을 읽은 결과(incoming)를 기존 권리(existing)와 비교해 "무엇이 바뀌는지"를 먼저 보여 준다.
// 원본 보관 → 감지 → 매핑 미리보기 → 후보 매칭 → 충돌 검증 → 적용 차이 → 확정 반영(→ 영향받는 편성안 재검증).
// 이 파일은 순수 함수만 둔다. 저장은 store.ts가 하고, 확정(confirm) 없이는 아무것도 저장하지 않는다.
//  - 같은 원본 행(같은 해시)을 다시 올리면 변화 없음(권리·횟수 중복 없음, A09).
//  - 내용이 바뀐 행은 새 revision이 이전 revision을 대체한다. 이전 revision은 남는다(A12·A16).
//  - 부분 증분 파일에서 빠진 행은 철회가 아니다(A11). 전체 스냅샷은 대상 범위를 먼저 정해야 하고, 범위 안에서 빠진 행도
//    삭제가 아니라 '철회 후보(proposed_revoke)'로 표시해 운영자가 확인한다.
//  - 운영자가 직접 고친 revision(manual.override)은 파일이 덮어쓰지 않고 충돌로 표시한다(수동 수정 우선).
import { channelKey } from "./adapters/common";
import { currentGrants } from "./inventory";
import type { Grant } from "./types";

export type BatchKind = "incremental" | "full_snapshot";

export interface SnapshotScope {
  /** 이 채널의 권리만 전체 교체 대상(비우면 채널 제한 없음) */
  channels: string[];
  /** 이 자료 종류만 대상 */
  sourceKind: Grant["source"]["kind"] | null;
  /** 이 기간과 겹치는 권리만 대상(YYYY-MM-DD). 둘 다 비면 기간 제한 없음 */
  from: string | null;
  to: string | null;
}

export interface ImportPlan {
  kind: BatchKind;
  newGrants: Grant[];
  unchanged: Grant[];
  revised: { prev: Grant; next: Grant; changedColumns: string[] }[];
  manualConflicts: { existing: Grant; incoming: Grant }[];
  proposedRevocations: Grant[];
  /** 같은 배치 안에서 같은 grantId가 두 번 나온 경우(뒤의 것은 반영하지 않음) */
  duplicateInBatch: { grantId: string; kept: Grant; dropped: Grant }[];
  blocked: string | null;
}

function changedColumnsOf(a: Grant, b: Grant): string[] {
  const keys = new Set([...Object.keys(a.source.columns), ...Object.keys(b.source.columns)]);
  return [...keys].filter((k) => JSON.stringify(a.source.columns[k] ?? null) !== JSON.stringify(b.source.columns[k] ?? null));
}

function inScope(g: Grant, s: SnapshotScope): boolean {
  if (s.sourceKind && g.source.kind !== s.sourceKind) return false;
  if (s.channels.length) {
    const ch = g.scope.channels;
    if (ch.kind !== "list" || !ch.ids.some((id) => s.channels.some((c) => channelKey(c) === channelKey(id)))) return false;
  }
  if (s.from || s.to) {
    if (g.window.start.state !== "value") return false;
    const end = g.window.end.state === "value" ? g.window.end.value : g.window.end.state === "unbounded" ? "9999-12-31" : null;
    if (end === null) return false;
    if (s.to && g.window.start.value > s.to) return false;
    if (s.from && end < s.from) return false;
  }
  return true;
}

export function planImport(input: { incoming: Grant[]; existingRevisions: Grant[]; kind: BatchKind; scope?: SnapshotScope | null; now: string }): ImportPlan {
  const plan: ImportPlan = { kind: input.kind, newGrants: [], unchanged: [], revised: [], manualConflicts: [], proposedRevocations: [], duplicateInBatch: [], blocked: null };
  if (input.kind === "full_snapshot") {
    const s = input.scope;
    if (!s || (s.channels.length === 0 && !s.sourceKind && !s.from && !s.to)) {
      plan.blocked = "전체 스냅샷은 교체 대상 범위(채널·자료 종류·기간 중 하나 이상)를 먼저 정해야 합니다. 범위 없이는 아무것도 반영하지 않습니다.";
      return plan;
    }
  }
  const current = currentGrants(input.existingRevisions);
  const byId = new Map(current.map((g) => [g.grantId, g]));

  const seen = new Map<string, Grant>();
  const incoming: Grant[] = [];
  for (const g of input.incoming) {
    const prev = seen.get(g.grantId);
    if (prev) {
      plan.duplicateInBatch.push({ grantId: g.grantId, kept: prev, dropped: g });
      continue;
    }
    seen.set(g.grantId, g);
    incoming.push(g);
  }

  for (const g of incoming) {
    const ex = byId.get(g.grantId);
    if (!ex) {
      plan.newGrants.push(g);
      continue;
    }
    if (ex.status === "proposed_revoke" && ex.rowHash === g.rowHash) {
      // 철회 후보였던 행이 다시 들어오면 되살린다(새 revision, 철회 후보 revision을 대체)
      plan.revised.push({ prev: ex, next: { ...g, revisionId: `${g.revisionId}+restored-${input.now.slice(0, 19).replace(/\D/g, "")}`, supersedesRevisionId: ex.revisionId }, changedColumns: [] });
      continue;
    }
    if (ex.rowHash === g.rowHash) {
      plan.unchanged.push(g);
      continue;
    }
    if (ex.manual?.override) {
      plan.manualConflicts.push({ existing: ex, incoming: g });
      continue;
    }
    plan.revised.push({ prev: ex, next: { ...g, supersedesRevisionId: ex.revisionId }, changedColumns: changedColumnsOf(ex, g) });
  }

  if (input.kind === "full_snapshot" && input.scope) {
    const incomingIds = new Set(incoming.map((g) => g.grantId));
    for (const g of current) {
      if (g.status !== "active" || g.manual?.override || incomingIds.has(g.grantId) || !inScope(g, input.scope)) continue;
      plan.proposedRevocations.push({ ...g, revisionId: `${g.grantId}#revoke-${input.now.slice(0, 19).replace(/\D/g, "")}`, supersedesRevisionId: g.revisionId, status: "proposed_revoke", enteredAt: input.now });
    }
  }
  return plan;
}

export function planSummary(p: ImportPlan): { new: number; unchanged: number; revised: number; manualConflicts: number; proposedRevocations: number; duplicateInBatch: number } {
  return { new: p.newGrants.length, unchanged: p.unchanged.length, revised: p.revised.length, manualConflicts: p.manualConflicts.length, proposedRevocations: p.proposedRevocations.length, duplicateInBatch: p.duplicateInBatch.length };
}

/** 확정 반영할 revision 목록(새 행 + 개정 + 철회 후보). 변화 없는 행·수동 충돌은 포함하지 않는다. */
export function revisionsToStore(p: ImportPlan, enteredAt: string): Grant[] {
  if (p.blocked) return [];
  return [...p.newGrants, ...p.revised.map((r) => r.next), ...p.proposedRevocations].map((g) => ({ ...g, enteredAt }));
}
