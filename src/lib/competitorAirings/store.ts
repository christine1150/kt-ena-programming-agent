// 경쟁 채널 편성 자료 저장 계층(서버 전용) — 파서가 만든 행을 Supabase 에 반영한다.
// 교체 범위: 같은 (경쟁채널 × 방송일)의 기존 행은 새 파일 내용으로 바뀐다(주간 편성표 업로드와 같은 원칙). 반영 전 미리보기로 바뀔 건수를 보여 준다.
// Supabase JS 는 여러 문장을 한 트랜잭션으로 묶을 수 없어서 "새 행을 먼저 upsert → 성공하면 같은 범위의 옛 행 삭제" 순서로 처리한다.
// 도중에 실패하면 옛 행은 지우지 않고(새로 넣은 행만 정리) 오류를 돌려준다.
import { supabase } from "@/lib/supabase";
import type { ParsedAiring } from "./parse";

export const NOT_APPLIED_MESSAGE = "경쟁 채널 편성 자료를 저장할 테이블이 아직 만들어지지 않았습니다(마이그레이션 20261016010000 적용 대기). 적용된 뒤에 사용할 수 있습니다.";

export type StoreResult<T> = { ok: true; data: T } | { ok: false; message: string; notApplied?: boolean };

interface DbErr {
  code?: string;
  message?: string;
}
function isMissingTable(e: DbErr | null | undefined): boolean {
  if (!e) return false;
  const msg = e.message ?? "";
  return e.code === "42P01" || e.code === "PGRST205" || (/competitor_airing/.test(msg) && /does not exist|schema cache/.test(msg));
}
const fail = (e: DbErr, what: string): { ok: false; message: string; notApplied?: boolean } =>
  isMissingTable(e) ? { ok: false, message: NOT_APPLIED_MESSAGE, notApplied: true } : { ok: false, message: `${what}: ${e.message ?? "알 수 없는 오류"}` };

export interface ChannelContext {
  channelId: string;
  primaryTarget: string;
  registeredCompetitors: string[];
}

export async function loadChannelContext(channelCode: string): Promise<StoreResult<ChannelContext>> {
  const ch = await supabase.from("channels").select("id, primary_target").eq("code", channelCode).maybeSingle();
  if (ch.error) return fail(ch.error, "채널 정보를 읽지 못했습니다");
  if (!ch.data) return { ok: false, message: `채널(${channelCode})을 찾을 수 없습니다.` };
  const comp = await supabase.from("competitors").select("competitor_name").eq("channel_id", ch.data.id);
  if (comp.error) return fail(comp.error, "경쟁채널 목록을 읽지 못했습니다");
  const names = [...new Set((comp.data ?? []).map((c) => String(c.competitor_name)))];
  return { ok: true, data: { channelId: ch.data.id, primaryTarget: ch.data.primary_target, registeredCompetitors: names } };
}

/** 저장 테이블이 만들어져 있는가(마이그레이션 적용 여부). 본문이 있는 일반 조회로 판정한다. */
export async function checkStorage(): Promise<StoreResult<true>> {
  const q = await supabase.from("competitor_airings").select("id").limit(1);
  return q.error ? fail(q.error, "저장소를 확인하지 못했습니다") : { ok: true, data: true };
}

/** 이번 파일의 (경쟁채널 × 방송일) 범위에 이미 들어 있는 행 수 — 반영하면 이 행들이 새 내용으로 바뀐다. */
export async function countReplaced(channelId: string, rows: ParsedAiring[]): Promise<StoreResult<number>> {
  const byComp = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byComp.has(r.competitorName)) byComp.set(r.competitorName, new Set());
    byComp.get(r.competitorName)!.add(r.broadcastDate);
  }
  let total = 0;
  for (const [name, dates] of byComp) {
    const sorted = [...dates].sort();
    for (let from = 0; ; from += 1000) {
      const q = await supabase
        .from("competitor_airings")
        .select("broadcast_date")
        .eq("our_channel_id", channelId)
        .eq("competitor_name", name)
        .gte("broadcast_date", sorted[0])
        .lte("broadcast_date", sorted[sorted.length - 1])
        .range(from, from + 999);
      if (q.error) return fail(q.error, "기존 편성 자료를 확인하지 못했습니다");
      total += (q.data ?? []).filter((x) => dates.has(String(x.broadcast_date))).length;
      if ((q.data ?? []).length < 1000) break;
    }
  }
  return { ok: true, data: total };
}

export interface CommitSummary {
  batchId: string;
  saved: number;
  removed: number;
}

export async function commitAirings(args: { channelId: string; rows: ParsedAiring[]; fileName: string; uploadedBy: string }): Promise<StoreResult<CommitSummary>> {
  const { channelId, rows, fileName, uploadedBy } = args;
  if (!rows.length) return { ok: false, message: "반영할 행이 없습니다." };
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    our_channel_id: channelId,
    competitor_name: r.competitorName,
    broadcast_date: r.broadcastDate,
    start_minute: r.startMinute,
    end_minute: r.endMinute,
    program_name: r.programName,
    program_key: r.programKey,
    episode_no: r.episodeNo,
    is_rerun: r.isRerun,
    rating: r.rating,
    target_label: r.targetLabel,
    batch_id: batchId,
    source_file: fileName,
    uploaded_by: uploadedBy,
    updated_at: now,
  }));

  for (let i = 0; i < payload.length; i += 500) {
    const up = await supabase.from("competitor_airings").upsert(payload.slice(i, i + 500), { onConflict: "our_channel_id,competitor_name,broadcast_date,start_minute,program_key" });
    if (up.error) {
      // 이번에 새로 넣은 행만 정리한다(옛 행은 아직 지우지 않았다).
      await supabase.from("competitor_airings").delete().eq("batch_id", batchId);
      return fail(up.error, "저장하지 못했습니다(기존 자료는 그대로 유지)");
    }
  }

  // 같은 (경쟁채널 × 방송일)의 옛 행(이번 배치가 아닌 것)을 지운다.
  const byComp = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byComp.has(r.competitorName)) byComp.set(r.competitorName, new Set());
    byComp.get(r.competitorName)!.add(r.broadcastDate);
  }
  let removed = 0;
  for (const [name, dates] of byComp) {
    const list = [...dates];
    for (let i = 0; i < list.length; i += 150) {
      const del = await supabase
        .from("competitor_airings")
        .delete({ count: "exact" })
        .eq("our_channel_id", channelId)
        .eq("competitor_name", name)
        .in("broadcast_date", list.slice(i, i + 150))
        .neq("batch_id", batchId);
      if (del.error) return { ok: false, message: `새 자료는 저장했지만 같은 날짜의 옛 행을 정리하지 못했습니다: ${del.error.message}` };
      removed += del.count ?? 0;
    }
  }

  const dates = rows.map((r) => r.broadcastDate).sort();
  const log = await supabase.from("competitor_airing_batches").insert({
    batch_id: batchId,
    our_channel_id: channelId,
    file_name: fileName,
    uploaded_by: uploadedBy,
    row_count: rows.length,
    replaced_count: removed,
    competitor_count: byComp.size,
    date_from: dates[0],
    date_to: dates[dates.length - 1],
  });
  void log; // 이력 기록 실패는 자료 저장 결과에 영향을 주지 않는다(화면의 최근 반영 표시만 비게 된다).
  return { ok: true, data: { batchId, saved: rows.length, removed } };
}

export interface StatusSummary {
  totalRows: number;
  dateFrom: string | null;
  dateTo: string | null;
  recent: { fileName: string | null; uploadedAt: string; rowCount: number; competitorCount: number; dateFrom: string | null; dateTo: string | null }[];
}

export async function loadStatus(channelId: string): Promise<StoreResult<StatusSummary>> {
  // 주의: head 요청은 테이블이 없어도 본문이 비어 오류 없이 0건으로 돌아온다(postgrest-js). 그래서 본문이 있는 일반 조회로 먼저 테이블 존재를 판정한다.
  const first = await supabase.from("competitor_airings").select("broadcast_date").eq("our_channel_id", channelId).order("broadcast_date", { ascending: true }).limit(1);
  if (first.error) return fail(first.error, "현황을 읽지 못했습니다");
  const total = await supabase.from("competitor_airings").select("id", { count: "exact", head: true }).eq("our_channel_id", channelId);
  if (total.error) return fail(total.error, "현황을 읽지 못했습니다");
  const last = await supabase.from("competitor_airings").select("broadcast_date").eq("our_channel_id", channelId).order("broadcast_date", { ascending: false }).limit(1);
  const batches = await supabase
    .from("competitor_airing_batches")
    .select("file_name, uploaded_at, row_count, competitor_count, date_from, date_to")
    .eq("our_channel_id", channelId)
    .order("uploaded_at", { ascending: false })
    .limit(5);
  return {
    ok: true,
    data: {
      totalRows: total.count ?? 0,
      dateFrom: first.data?.[0]?.broadcast_date ?? null,
      dateTo: last.data?.[0]?.broadcast_date ?? null,
      recent: (batches.data ?? []).map((b) => ({ fileName: b.file_name, uploadedAt: b.uploaded_at, rowCount: b.row_count, competitorCount: b.competitor_count, dateFrom: b.date_from, dateTo: b.date_to })),
    },
  };
}
