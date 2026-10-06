// 사용 원장의 DB 구현(단계 06, 서버 전용) — 원자 구간은 SQL 함수(avail_reserve_usage 등, advisory lock)가 맡는다.
// ledger.ts의 MemoryLedgerStore와 같은 규칙이며, 규칙의 기준 구현·테스트는 ledger.ts에 있다.
// 이 파일의 SQL 함수는 로컬 Postgres가 없어 실행해 보지 못했다 → 마이그레이션 적용 후 docs/ops/avail-ledger-sql-check.sql로 확인해야 한다.
import { supabase } from "@/lib/supabase";
import type { LedgerResult, ConsumeInput, ReserveInput } from "./ledger";
import { isMissingTable } from "./store";
import type { UsageEntry } from "./types";

interface RpcOut {
  ok: boolean;
  replay?: boolean;
  reason?: "insufficient" | "not_found" | "invalid_state";
  remaining?: number;
  seq?: number;
  usage_id?: string;
  over_limit?: boolean;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ out: RpcOut | null; error: string | null; missing: boolean }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { out: null, error: error.message, missing: isMissingTable(error) || /function .* does not exist|Could not find the function/i.test(error.message) };
  return { out: data as RpcOut, error: null, missing: false };
}

async function entryOf(seq: number): Promise<UsageEntry | null> {
  const { data } = await supabase.from("avail_usage_ledger").select("seq, usage_id, event, pool_id, grant_revision_id, channel_id, episode, scheduled_at, actual_at, units, schedule_revision_id, idempotency_key, source_event_id, evidence, created_at").eq("seq", seq).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { seq: Number(r.seq), usageId: String(r.usage_id), event: r.event as UsageEntry["event"], poolId: String(r.pool_id), grantRevisionId: String(r.grant_revision_id), channelId: String(r.channel_id), episode: r.episode === null ? null : Number(r.episode), scheduledAt: (r.scheduled_at as string | null) ?? null, actualAt: (r.actual_at as string | null) ?? null, units: Number(r.units), scheduleRevisionId: (r.schedule_revision_id as string | null) ?? null, idempotencyKey: String(r.idempotency_key), sourceEventId: (r.source_event_id as string | null) ?? null, evidence: (r.evidence as string | null) ?? null, createdAt: String(r.created_at) };
}

export type DbLedgerResult = (LedgerResult & { overLimit?: boolean }) | { ok: false; reason: "db_error"; message: string; missing: boolean };

async function wrap(out: RpcOut | null, error: string | null, missing: boolean): Promise<DbLedgerResult> {
  if (!out) return { ok: false, reason: "db_error", message: error ?? "응답 없음", missing };
  if (!out.ok) return { ok: false, reason: out.reason ?? "invalid_state", remaining: out.remaining };
  const entry = out.seq ? await entryOf(out.seq) : null;
  if (!entry) return { ok: false, reason: "db_error", message: "저장된 원장 행을 읽지 못했습니다", missing: false };
  return { ok: true, entry, replay: !!out.replay, overLimit: out.over_limit };
}

export async function dbReserve(i: ReserveInput): Promise<DbLedgerResult> {
  const r = await rpc("avail_reserve_usage", { p_pool_id: i.poolId, p_episode: i.episode, p_units: i.units, p_limit: i.limit, p_per_channel: i.countUnit === "per_channel", p_channel_id: i.channelId, p_grant_revision_id: i.grantRevisionId, p_scheduled_at: i.scheduledAt, p_schedule_revision_id: i.scheduleRevisionId, p_idempotency_key: i.idempotencyKey, p_evidence: i.evidence ?? null, p_usage_id: i.usageId ?? null });
  return wrap(r.out, r.error, r.missing);
}

export async function dbConsume(i: ConsumeInput): Promise<DbLedgerResult> {
  const r = await rpc("avail_consume_usage", { p_source_event_id: i.sourceEventId, p_pool_id: i.poolId, p_episode: i.episode, p_grant_revision_id: i.grantRevisionId, p_channel_id: i.channelId, p_units: i.units, p_actual_at: i.actualAt, p_scheduled_at: i.scheduledAt, p_usage_id: i.usageId ?? null, p_limit: i.limit, p_evidence: i.evidence ?? null });
  return wrap(r.out, r.error, r.missing);
}

export async function dbRelease(i: { usageId: string; kind: "release" | "cancel"; idempotencyKey: string; evidence?: string | null }): Promise<DbLedgerResult> {
  const r = await rpc("avail_release_usage", { p_usage_id: i.usageId, p_kind: i.kind, p_idempotency_key: i.idempotencyKey, p_evidence: i.evidence ?? null });
  return wrap(r.out, r.error, r.missing);
}
