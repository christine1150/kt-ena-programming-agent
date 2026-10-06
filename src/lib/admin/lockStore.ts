// 수동 잠금·변경 이력 저장소(단계 05, 서버 전용) — admin_field_locks / admin_change_log.
// 마이그레이션(20261012010000)이 적용되기 전에는 테이블이 없으므로 모든 함수가 best-effort다: 조회는 "잠금 없음(available=false)",
// 쓰기는 조용히 건너뛰되 호출부가 available로 결과 화면에 '잠금 미적용'을 알릴 수 있다.
import { supabase } from "@/lib/supabase";
import { decideWrite, type FieldId, type FieldLock, type Source, type WriteDecision } from "./fieldPrecedence";

const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|Could not find the table|schema cache/i.test(e.message ?? ""));

export interface LockLookup {
  /** 잠금 테이블이 적용된 환경인지 */
  available: boolean;
  lock: FieldLock | null;
}

export async function getActiveLock(field: FieldId, key: string): Promise<LockLookup> {
  const { data, error } = await supabase
    .from("admin_field_locks")
    .select("field, lock_key, value, locked_by, locked_at, effective_from, reason")
    .eq("field", field)
    .eq("lock_key", key)
    .is("released_at", null)
    .maybeSingle();
  if (error) return { available: false, lock: null };
  if (!data) return { available: true, lock: null };
  return {
    available: true,
    lock: { field, key, value: data.value, lockedBy: data.locked_by, lockedAt: data.locked_at, effectiveFrom: data.effective_from, reason: data.reason ?? "" },
  };
}

export async function logChange(entry: { field: FieldId; key: string; action: "manual_set" | "upload_write" | "upload_skipped_locked" | "release"; oldValue: unknown; newValue: unknown; source: Source; actor: string; reason?: string }): Promise<void> {
  const { error } = await supabase.from("admin_change_log").insert({
    field: entry.field,
    lock_key: entry.key,
    action: entry.action,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    source: entry.source,
    actor: entry.actor,
    reason: entry.reason ?? null,
  });
  if (error && !isMissingTable(error)) console.warn(`[adminOps] 변경 이력 기록 실패: ${error.message}`);
}

/**
 * Channel Master 파일의 목표를 반영해도 되는지 판단한다. 수동 잠금이 있으면 건너뛰고(이력에 남김) 이유를 돌려준다.
 * 잠금 테이블이 없으면 판단 근거가 없어 write를 돌려주고 lockAvailable=false로 알린다.
 */
export async function decideGoalFromFile(args: { channelCode: string; year: number; incoming: { target_rank: string | number | null; target_rating: number | null }; actor: string; fileName: string }): Promise<{ decision: WriteDecision; lockAvailable: boolean; key: string }> {
  const key = `${args.channelCode}:${args.year}`;
  const { available, lock } = await getActiveLock("target_goal", key);
  const decision = decideWrite({ field: "target_goal", incomingSource: "channel_master_file", incomingValue: args.incoming, existing: lock ? { source: "manual_admin", value: lock.value } : null, lock });
  if (decision.action === "skip_locked") {
    await logChange({ field: "target_goal", key, action: "upload_skipped_locked", oldValue: lock?.value, newValue: args.incoming, source: "channel_master_file", actor: args.actor, reason: args.fileName });
  }
  return { decision, lockAvailable: available, key };
}

/** 수동 잠금을 해제한다(행은 남기고 이력에 기록). 해제할 잠금이 없으면 false. */
export async function releaseLock(args: { field: FieldId; key: string; actor: string; reason: string }): Promise<boolean> {
  const { lock } = await getActiveLock(args.field, args.key);
  if (!lock) return false;
  const { error } = await supabase.from("admin_field_locks").update({ released_at: new Date().toISOString(), released_by: args.actor }).eq("field", args.field).eq("lock_key", args.key).is("released_at", null);
  if (error) return false;
  await logChange({ field: args.field, key: args.key, action: "release", oldValue: lock.value, newValue: null, source: "manual_admin", actor: args.actor, reason: args.reason });
  return true;
}

/** 수동 입력 값을 잠그고 이력을 남긴다. 기존 잠금은 해제(행은 남김)하고 새 잠금을 만든다. 테이블이 없으면 false. */
export async function setManualLock(args: { field: FieldId; key: string; value: unknown; actor: string; reason: string; effectiveFrom?: string | null; oldValue?: unknown }): Promise<boolean> {
  const released = await supabase
    .from("admin_field_locks")
    .update({ released_at: new Date().toISOString(), released_by: args.actor })
    .eq("field", args.field)
    .eq("lock_key", args.key)
    .is("released_at", null);
  if (released.error) {
    if (!isMissingTable(released.error)) console.warn(`[adminOps] 잠금 해제 실패: ${released.error.message}`);
    return false;
  }
  const { error } = await supabase.from("admin_field_locks").insert({
    field: args.field,
    lock_key: args.key,
    value: args.value as object,
    locked_by: args.actor,
    effective_from: args.effectiveFrom ?? null,
    reason: args.reason,
  });
  if (error) {
    console.warn(`[adminOps] 잠금 기록 실패: ${error.message}`);
    return false;
  }
  await logChange({ field: args.field, key: args.key, action: "manual_set", oldValue: args.oldValue, newValue: args.value, source: "manual_admin", actor: args.actor, reason: args.reason });
  return true;
}
