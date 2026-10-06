// 닐슨 수집 배치 원장(nielsen_ingest_batches) 접근. 모든 함수는 최선 노력이다 — 원장 테이블이 없거나 쓰기가 실패해도
// 적재 흐름을 막지 않는다(마이그레이션 적용 전에도 기존 동작 유지). 순수 계산은 nielsenIngestChecks.ts.
import { supabase } from "@/lib/supabase";
import { NIELSEN_PARSER_VERSION, type AdapterStatus } from "@/lib/nielsenIngestChecks";

export type IngestKind = "daily" | "period_weekly" | "period_monthly" | "annual";
export type IngestOrigin = { source: "manual" | "mail"; ref?: string };
export type BatchStatus = "received" | "parsed" | "validated" | "applied" | "partial" | "failed" | "skipped_duplicate";

export interface BatchHandle {
  id: string | null; // 원장을 못 쓰면 null
  revision: number;
  supersedesId: string | null;
  stages: { stage: string; at: string }[];
}

export interface BatchInit {
  fileSha256: string;
  fileName: string;
  kind: IngestKind;
  periodFrom: string;
  periodTo: string;
  adapterStatus?: AdapterStatus;
  origin?: IngestOrigin;
}

/** 같은 종류·기간의 가장 최근 반영(applied) 배치. 같은 해시·같은 파서 버전이면 재수신 = 변경 없음으로 본다.
 *  "가장 최근"만 보는 이유: A→B→A로 되돌리는 재업로드는 정당한 변경이므로 과거 어느 때 반영된 해시와 같다는 이유로 막지 않는다. */
export async function findLatestApplied(kind: IngestKind, periodFrom: string, periodTo: string): Promise<{ id: string; fileSha256: string; parserVersion: string; revision: number } | null> {
  try {
    const { data, error } = await supabase
      .from("nielsen_ingest_batches")
      .select("id, file_sha256, parser_version, revision")
      .eq("kind", kind)
      .eq("period_from", periodFrom)
      .eq("period_to", periodTo)
      .eq("status", "applied")
      .order("revision", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const r = data[0];
    return { id: r.id as string, fileSha256: r.file_sha256 as string, parserVersion: r.parser_version as string, revision: Number(r.revision) };
  } catch {
    return null;
  }
}

export function isSameAsLatest(latest: { fileSha256: string; parserVersion: string } | null, sha: string): boolean {
  return !!latest && latest.fileSha256 === sha && latest.parserVersion === NIELSEN_PARSER_VERSION;
}

export async function beginBatch(init: BatchInit, latest: { id: string; revision: number } | null, sameRevision = false): Promise<BatchHandle> {
  const handle: BatchHandle = { id: null, revision: (latest?.revision ?? 0) + (sameRevision ? 0 : 1), supersedesId: latest?.id ?? null, stages: [{ stage: "received", at: new Date().toISOString() }] };
  try {
    const { data, error } = await supabase
      .from("nielsen_ingest_batches")
      .insert({
        file_sha256: init.fileSha256,
        file_name: init.fileName,
        kind: init.kind,
        period_from: init.periodFrom,
        period_to: init.periodTo,
        parser_version: NIELSEN_PARSER_VERSION,
        adapter_status: init.adapterStatus ?? "verified",
        source: init.origin?.source ?? "manual",
        source_ref: init.origin?.ref ?? null,
        revision: handle.revision,
        supersedes_batch_id: handle.supersedesId,
        status: "received",
        stage_log: handle.stages,
      })
      .select("id")
      .single();
    if (!error && data) handle.id = data.id as string;
  } catch {
    // 원장 없이 진행
  }
  return handle;
}

export function markStage(handle: BatchHandle, stage: string): void {
  handle.stages.push({ stage, at: new Date().toISOString() });
}

export async function finishBatch(
  handle: BatchHandle,
  patch: { status: BatchStatus; sheetMeta?: unknown; rowCounts?: unknown; diff?: unknown; warnings?: string[]; errorMessage?: string | null }
): Promise<void> {
  if (!handle.id) return;
  markStage(handle, patch.status);
  try {
    await supabase
      .from("nielsen_ingest_batches")
      .update({
        status: patch.status,
        stage_log: handle.stages,
        sheet_meta: patch.sheetMeta ?? null,
        row_counts: patch.rowCounts ?? null,
        diff: patch.diff ?? null,
        warnings: patch.warnings && patch.warnings.length > 0 ? patch.warnings : null,
        error_message: patch.errorMessage ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", handle.id);
  } catch {
    // 무시
  }
}

/** 동일 파일 재수신 기록(변경 없음, 데이터 미변경). */
export async function recordDuplicate(init: BatchInit, latest: { id: string; revision: number }): Promise<void> {
  const h = await beginBatch(init, latest, true); // 새 개정이 아니다
  await finishBatch(h, { status: "skipped_duplicate" });
}
