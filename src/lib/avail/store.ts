// Avail 저장소(단계 06, 서버 전용) — avail_* 테이블 읽기·쓰기.
// 마이그레이션(20261013010000) 적용 전에는 테이블이 없으므로 읽기는 "available=false + 빈 상태", 쓰기는 명확한 오류로 알린다.
// 권리 revision은 쌓기만 한다(수정·삭제 없음). 반영 실패 시 이번 배치가 쌓은 revision만 되돌린다.
import { supabase } from "@/lib/supabase";
import type { Addendum } from "./addenda";
import type { AvailState } from "./context";
import type { Confirmation } from "./evaluate";
import type { InterpKey } from "./interpretation";
import type { PlanRightsSnapshot } from "./revalidation";
import type { Grant, UsageEntry } from "./types";

export const isMissingTable = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|Could not find the table|schema cache/i.test(e.message ?? ""));

type Row = Record<string, unknown>;

async function selectAll(table: string, columns: string, order?: string): Promise<{ rows: Row[]; missing: boolean; error: string | null }> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns).range(from, from + 999);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error) return { rows: [], missing: isMissingTable(error), error: error.message };
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return { rows: out, missing: false, error: null };
}

export interface LoadedAvail {
  /** avail_* 테이블이 적용된 환경인지 */
  available: boolean;
  state: AvailState;
  error: string | null;
}

export const EMPTY_STATE: AvailState = { revisions: [], addenda: [], ledger: [], links: [], confirmations: [], interpretationConfirmations: {} };

const ledgerFromRow = (r: Row): UsageEntry => ({
  seq: Number(r.seq),
  usageId: String(r.usage_id),
  event: r.event as UsageEntry["event"],
  poolId: String(r.pool_id),
  grantRevisionId: String(r.grant_revision_id),
  channelId: String(r.channel_id),
  episode: r.episode === null || r.episode === undefined ? null : Number(r.episode),
  scheduledAt: (r.scheduled_at as string | null) ?? null,
  actualAt: (r.actual_at as string | null) ?? null,
  units: Number(r.units),
  scheduleRevisionId: (r.schedule_revision_id as string | null) ?? null,
  idempotencyKey: String(r.idempotency_key),
  sourceEventId: (r.source_event_id as string | null) ?? null,
  evidence: (r.evidence as string | null) ?? null,
  createdAt: String(r.created_at),
});

/** 판정에 필요한 모든 상태를 읽는다. 테이블이 없으면 available=false(= Avail 미입력 설치와 같은 동작). */
export async function loadAvailState(): Promise<LoadedAvail> {
  const grants = await selectAll("avail_grants", "revision_id, data, entered_at", "entered_at");
  if (grants.missing) return { available: false, state: { ...EMPTY_STATE }, error: null };
  if (grants.error) return { available: false, state: { ...EMPTY_STATE }, error: grants.error };
  const [addenda, links, conf, interp, ledger] = await Promise.all([
    selectAll("avail_addenda", "data"),
    selectAll("avail_content_links", "program_id, canonical_key, confirmed_by, confirmed_at"),
    selectAll("avail_confirmations", "grant_id, row_hash, topic, value, evidence, confirmed_by, confirmed_at"),
    selectAll("avail_interpretation", "key, value, confirmed_by, confirmed_at"),
    selectAll("avail_usage_ledger", "seq, usage_id, event, pool_id, grant_revision_id, channel_id, episode, scheduled_at, actual_at, units, schedule_revision_id, idempotency_key, source_event_id, evidence, created_at", "seq"),
  ]);
  const err = [addenda, links, conf, interp, ledger].find((x) => x.error && !x.missing)?.error ?? null;
  return {
    available: true,
    error: err,
    state: {
      revisions: grants.rows.map((r) => ({ ...(r.data as Grant), enteredAt: String(r.entered_at) })),
      addenda: addenda.rows.map((r) => r.data as Addendum),
      ledger: ledger.rows.map(ledgerFromRow),
      links: links.rows.map((r) => ({ programId: String(r.program_id), canonicalKey: String(r.canonical_key), confirmedBy: (r.confirmed_by as string | null) ?? null, confirmedAt: String(r.confirmed_at) })),
      confirmations: conf.rows.map((r) => ({ grantId: String(r.grant_id), rowHash: String(r.row_hash), topic: String(r.topic), value: (r.value as string | null) ?? null, evidence: (r.evidence as string | null) ?? null, by: (r.confirmed_by as string | null) ?? null, at: String(r.confirmed_at) })),
      interpretationConfirmations: Object.fromEntries(interp.rows.map((r) => [r.key as InterpKey, { value: (r.value as { v: unknown }).v, by: (r.confirmed_by as string | null) ?? null, at: String(r.confirmed_at) }])),
    },
  };
}

export interface BatchMeta {
  kind: "incremental" | "full_snapshot";
  scope: unknown;
  fileName: string;
  fileHash: string | null;
  sheetSummary: unknown;
  planSummary: unknown;
  actor: string;
  note?: string;
}

/** 배치와 권리 revision을 저장한다. 중간에 실패하면 이번 배치가 쌓은 revision·배치 행을 지우고 오류를 알린다. */
export async function saveImport(meta: BatchMeta, revisions: Grant[]): Promise<{ ok: true; batchId: string; stored: number } | { ok: false; message: string; missingTable: boolean }> {
  const { data: batch, error: bErr } = await supabase
    .from("avail_batches")
    .insert({ batch_kind: meta.kind, snapshot_scope: meta.scope ?? null, file_name: meta.fileName, file_hash: meta.fileHash, sheet_summary: meta.sheetSummary, plan_summary: meta.planSummary, status: "pending", applied_by: meta.actor, note: meta.note ?? null })
    .select("id")
    .single();
  if (bErr || !batch) return { ok: false, message: bErr?.message ?? "배치 저장 실패", missingTable: isMissingTable(bErr) };
  const batchId = String((batch as { id: string }).id);
  let stored = 0;
  for (let i = 0; i < revisions.length; i += 200) {
    const chunk = revisions.slice(i, i + 200).map((g) => ({ revision_id: g.revisionId, grant_id: g.grantId, row_hash: g.rowHash, supersedes_revision_id: g.supersedesRevisionId, status: g.status, source_kind: g.source.kind, batch_id: batchId, entered_at: g.enteredAt, data: { ...g, source: { ...g.source, batchId } } }));
    const { error } = await supabase.from("avail_grants").insert(chunk);
    if (error) {
      await supabase.from("avail_grants").delete().eq("batch_id", batchId);
      await supabase.from("avail_batches").update({ status: "failed", note: `반영 실패로 되돌림: ${error.message}` }).eq("id", batchId);
      return { ok: false, message: `권리 저장 실패(이번 파일 반영분은 되돌렸습니다): ${error.message}`, missingTable: isMissingTable(error) };
    }
    stored += chunk.length;
  }
  const { error: uErr } = await supabase.from("avail_batches").update({ status: "applied" }).eq("id", batchId);
  if (uErr) return { ok: false, message: uErr.message, missingTable: isMissingTable(uErr) };
  return { ok: true, batchId, stored };
}

export async function saveAddenda(addenda: Addendum[], actor: string): Promise<{ ok: boolean; message?: string }> {
  const rows = addenda.map((a) => ({ addendum_id: a.addendumId, data: a, provenance: a.provenance, saved_by: actor, saved_at: new Date().toISOString() }));
  const { error } = await supabase.from("avail_addenda").upsert(rows, { onConflict: "addendum_id" });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function saveLink(l: { programId: string; canonicalKey: string }, actor: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from("avail_content_links").upsert({ program_id: l.programId, canonical_key: l.canonicalKey, confirmed_by: actor, confirmed_at: new Date().toISOString() }, { onConflict: "program_id,canonical_key" });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function saveConfirmation(c: Pick<Confirmation, "grantId" | "rowHash" | "topic" | "value" | "evidence">, actor: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from("avail_confirmations").insert({ grant_id: c.grantId, row_hash: c.rowHash, topic: c.topic, value: c.value ?? null, evidence: c.evidence ?? null, confirmed_by: actor });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function saveInterpretation(key: InterpKey, value: unknown, actor: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from("avail_interpretation").upsert({ key, value: { v: value }, confirmed_by: actor, confirmed_at: new Date().toISOString() }, { onConflict: "key" });
  return error ? { ok: false, message: error.message } : { ok: true };
}

/** 편성안 권리 스냅샷은 한 번 쓰고 바꾸지 않는다(같은 plan·revision이면 기존 것을 유지). */
export async function saveSnapshot(s: PlanRightsSnapshot): Promise<{ ok: boolean; message?: string }> {
  const { data: existing } = await supabase.from("avail_plan_snapshots").select("id").eq("plan_id", s.planId).eq("schedule_revision_id", s.scheduleRevisionId).maybeSingle();
  if (existing) return { ok: true };
  const { error } = await supabase.from("avail_plan_snapshots").insert({ plan_id: s.planId, schedule_revision_id: s.scheduleRevisionId, inventory_version: s.inventoryVersion, captured_at: s.capturedAt, data: s });
  if (error && error.code === "23505") return { ok: true };
  return error ? { ok: false, message: error.message } : { ok: true };
}
