// 수동 수정 이력(OPT06) — 순수 함수. 실행 취소·다시 실행·변경 이유를 한 곳에서 다룬다.
//
// 모델: 이력(entries)과 커서(cursor). entries[0..cursor)가 *적용된* 수정이고 그 뒤는 다시 실행할 수 있는 수정이다.
// 새 수정을 하면 다시 실행 꼬리는 버려진다(일반적인 편집기 동작). 각 항목은 수정 전·후 *블록 전체 상태*를 담아 정확히 되돌린다.
// 수정 개수는 제한하지 않는다(사용자 결정 2026-10-07) — 다만 이력 저장 크기를 지키기 위해 MAX_ENTRIES를 넘기면 거부하고 안내한다(조용히 버리지 않는다).
// seq는 되돌리기·다시 실행을 포함한 모든 변경마다 오른다 — 다른 화면이 같은 작업본을 동시에 고쳤는지 알아채는 토큰이다.

/** 수동 교체가 바꾸는 블록 열(runStore.swapBlock과 같은 집합). 되돌릴 때 이 열을 그대로 복원한다. */
export const EDIT_COLUMNS = [
  "program_id",
  "candidate_key",
  "program_key",
  "program_name",
  "content_type",
  "source_channel",
  "genre",
  "airing_type",
  "status",
  "locked",
  "expected_kpi",
  "expected_kpi_type",
  "expected_share",
  "expected_time_spent",
  "confidence_score",
  "expected_low",
  "expected_high",
  "range_basis",
  "decision",
  "sample_count",
  "fallback_level",
  "fitness_score",
  "block_value",
  "strategy_type",
  "competitor_slot_strength",
  "benchmark_index",
  "match_score",
  "counter_score",
  "score_components",
  "penalties",
  "reasons",
] as const;

export type BlockSnapshot = Record<(typeof EDIT_COLUMNS)[number], unknown>;

export function snapshotOf(row: Record<string, unknown>): BlockSnapshot {
  const out: Record<string, unknown> = {};
  for (const k of EDIT_COLUMNS) out[k] = row[k] === undefined ? null : row[k];
  return out as BlockSnapshot;
}

export type EditKind = "SWAP" | "LOCK" | "UNLOCK";

export interface EditEntry {
  seq: number;
  kind: EditKind;
  blockId: string;
  slot: { weekday: number; startMin: number; endMin: number };
  before: BlockSnapshot;
  after: BlockSnapshot;
  /** 변경 이유(운영자 입력, 선택) */
  reason: string | null;
  actor: string;
  at: string;
  /** 교체 시점 권리 판정 요약(실행 가능 표시 여부 판단용) */
  rights: { status: string; label: string; reviewOnly: boolean } | null;
  from: string;
  to: string;
}

export interface EditLog {
  /** 모든 변경(수정·되돌리기·다시 실행)마다 오르는 동시 수정 감지 토큰 */
  seq: number;
  /** entries[0..cursor)가 적용된 상태 */
  cursor: number;
  entries: EditEntry[];
  /** 계산 완료본(수정 전)의 편성안 버전 */
  baseVersion: string;
}

export const MAX_ENTRIES = 120;
export const MAX_REASON_CHARS = 200;

export const emptyLog = (baseVersion: string): EditLog => ({ seq: 0, cursor: 0, entries: [], baseVersion });

export const canUndo = (log: EditLog): boolean => log.cursor > 0;
export const canRedo = (log: EditLog): boolean => log.cursor < log.entries.length;
export const activeEntries = (log: EditLog): EditEntry[] => log.entries.slice(0, log.cursor);

export function cleanReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const t = reason.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_REASON_CHARS) : null;
}

export type RecordResult = { ok: true; log: EditLog; entry: EditEntry } | { ok: false; message: string };

/** 새 수정 기록: 다시 실행 꼬리를 버리고 seq를 올린다. 한도를 넘으면 거부한다. */
export function recordEdit(log: EditLog, e: Omit<EditEntry, "seq">): RecordResult {
  const kept = log.entries.slice(0, log.cursor);
  if (kept.length >= MAX_ENTRIES) return { ok: false, message: `수정 이력이 ${MAX_ENTRIES}건에 도달했습니다 — 이 작업본을 저장하고 [다시 계산]으로 새 편성안을 만든 뒤 이어서 고쳐 주세요.` };
  const entry: EditEntry = { ...e, seq: log.seq + 1 };
  return { ok: true, entry, log: { ...log, seq: log.seq + 1, entries: [...kept, entry], cursor: kept.length + 1 } };
}

/** 한 단계 실행 취소: 되돌릴 항목(그 항목의 before를 블록에 복원)과 새 로그. */
export function undoStep(log: EditLog): { log: EditLog; entry: EditEntry } | null {
  if (!canUndo(log)) return null;
  return { entry: log.entries[log.cursor - 1], log: { ...log, seq: log.seq + 1, cursor: log.cursor - 1 } };
}

/** 한 단계 다시 실행: 다시 적용할 항목(그 항목의 after를 블록에 복원)과 새 로그. */
export function redoStep(log: EditLog): { log: EditLog; entry: EditEntry } | null {
  if (!canRedo(log)) return null;
  return { entry: log.entries[log.cursor], log: { ...log, seq: log.seq + 1, cursor: log.cursor + 1 } };
}

/**
 * 지금 계산 완료본과 *내용이 다른* 칸 수(수동 수정 칸). 같은 칸을 여러 번 고쳐도 한 칸이고, 도로 원래 후보로 돌려놓았으면 세지 않는다.
 * 잠금만 바꾼 항목은 내용 수정이 아니라 세지 않는다.
 */
export function netEditedBlocks(log: EditLog): { blockId: string; from: string; to: string; slot: EditEntry["slot"]; reason: string | null; rights: EditEntry["rights"] }[] {
  const first = new Map<string, EditEntry>();
  const last = new Map<string, EditEntry>();
  for (const e of activeEntries(log)) {
    if (e.kind !== "SWAP") continue;
    if (!first.has(e.blockId)) first.set(e.blockId, e);
    last.set(e.blockId, e);
  }
  const out: ReturnType<typeof netEditedBlocks> = [];
  for (const [blockId, f] of first) {
    const l = last.get(blockId) as EditEntry;
    if (f.before.candidate_key === l.after.candidate_key) continue;
    out.push({ blockId, from: f.from, to: l.to, slot: l.slot, reason: l.reason, rights: l.rights });
  }
  return out.sort((a, b) => a.slot.weekday - b.slot.weekday || a.slot.startMin - b.slot.startMin);
}

/** 이력 화면용 요약 줄(최신순). 적용 중이면 applied, 실행 취소된(다시 실행 가능) 항목은 false. */
export function historyLines(log: EditLog): { seq: number; applied: boolean; kind: EditKind; text: string; reason: string | null; actor: string; at: string }[] {
  return log.entries
    .map((e, i) => ({
      seq: e.seq,
      applied: i < log.cursor,
      kind: e.kind,
      text: e.kind === "SWAP" ? `${e.from} → ${e.to}` : e.kind === "LOCK" ? `${e.from} 잠금` : `${e.from} 잠금 해제`,
      reason: e.reason,
      actor: e.actor,
      at: e.at,
    }))
    .reverse();
}

/** 수동 수정 이전(계산 완료본)의 블록 상태 — 적용된 수정의 첫 수정 전 스냅샷으로 칸을 되돌린 목록. 반복 한도의 "원래 계산안이 이미 허용한 횟수"를 구하는 데 쓴다. */
export function revertToBase<B extends Record<string, unknown> & { id: string }>(blocks: B[], log: EditLog): B[] {
  const first = new Map<string, EditEntry>();
  for (const e of activeEntries(log)) if (!first.has(e.blockId)) first.set(e.blockId, e);
  return blocks.map((b) => (first.has(b.id) ? ({ ...b, ...(first.get(b.id) as EditEntry).before } as B) : b));
}

/** 저장된 JSON을 믿지 않고 모양을 확인한다(깨졌으면 빈 로그로 시작하되 호출부가 알릴 수 있게 null). */
export function parseLog(raw: unknown): EditLog | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<EditLog>;
  if (typeof o.seq !== "number" || typeof o.cursor !== "number" || !Array.isArray(o.entries) || typeof o.baseVersion !== "string") return null;
  if (o.cursor < 0 || o.cursor > o.entries.length) return null;
  return { seq: o.seq, cursor: o.cursor, entries: o.entries as EditEntry[], baseVersion: o.baseVersion };
}
