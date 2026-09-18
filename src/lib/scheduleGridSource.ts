// 편성표 검토 화면(data 라우트)과 엑셀 다운로드(export 라우트)가 공유하는 "그 채널·주차의
// 편성표 원자료 조회" 로직. 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는
// 내용으로... 직접 편성표를 그릴 수 있지 않니?" — 업로드된 편성표(program_schedule_grid)가
// 있으면 그대로(부제·회차·본방/재방 태그 포함), 없으면 ratings의 실제 방영 구간(start_time~
// end_time)만으로 재구성한다(get_channel_week_schedule). 두 라우트가 각자 이 로직을 중복
// 구현하지 않도록 한 곳으로 모은다.
import { supabase } from "@/lib/supabase";
import { resolveProgramLevelTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { parseScheduleGridWorkbook } from "@/lib/scheduleGridParse";

// 사용자 지시(2026-09-20): "1페이지 또는 2페이지에... 이번 주 실제 편성표 보기" — 주차 선택
// UI 없이 항상 "이번 주"를 기본값으로 쓰기 위한 도우미(관리자 화면 weeks 라우트의 계산과 동일).
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1=월 ... 7=일
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ScheduleGridSourceRow = {
  dow: number;
  broadcast_date: string;
  start_time: string;
  end_time: string | null;
  program_name_raw: string;
  tags: string | null;
  matched_rating: number | null;
};
export type ScheduleGridSource = "upload" | "db";

export async function getScheduleGridRows(
  channelId: string,
  channelCode: string,
  primaryTarget: string | null,
  week: string,
  // 사용자 지시(2026-09-20): "실제 업로드된 편성표가 있는 주도, DB 기반 편성표로 바꿀 수 있는
  // 옵션도 만들어줘" — 업로드가 있어도 강제로 DB 재구성을 보고 싶을 때 쓴다.
  options?: { forceDb?: boolean }
): Promise<{ source: ScheduleGridSource; rows: ScheduleGridSourceRow[]; hasUpload: boolean }> {
  // 업로드 존재 여부는 forceDb와 무관하게 항상 확인한다 — 화면이 "업로드가 있지만 지금은 DB로
  // 보는 중"인지 구분해 토글을 보여줄 수 있어야 하기 때문(사용자 지시 2026-09-20: "업로드된
  // 편성표가 있는 주도 DB 기반으로 바꿀 수 있는 옵션").
  const { data: uploadedRows, error } = await supabase
    .from("program_schedule_grid")
    .select("dow, broadcast_date, start_time, end_time, program_name_raw, tags, matched_rating")
    .eq("channel_id", channelId)
    .eq("week_start", week)
    .order("dow", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  const hasUpload = !!uploadedRows && uploadedRows.length > 0;
  if (hasUpload && !options?.forceDb) {
    return { source: "upload", rows: uploadedRows!, hasUpload };
  }

  if (!primaryTarget) return { source: "db", rows: [], hasUpload };
  const { data: dbRows, error: dbError } = await supabase.rpc("get_channel_week_schedule", {
    p_channel_code: channelCode,
    p_program_target_label: resolveProgramLevelTargetLabel(primaryTarget),
    p_week_start: week,
  });
  if (dbError) throw new Error(dbError.message);

  const rows: ScheduleGridSourceRow[] = (
    (dbRows ?? []) as { dow: number; broadcast_date: string; start_time: string; end_time: string | null; canonical_name: string; rating: number }[]
  ).map((r) => ({
    dow: r.dow,
    broadcast_date: r.broadcast_date,
    start_time: r.start_time,
    end_time: r.end_time,
    program_name_raw: r.canonical_name,
    tags: null,
    matched_rating: r.rating,
  }));
  return { source: "db", rows, hasUpload };
}

export type ScheduleGridUploadResult = {
  ok: true;
  channelCode: string;
  weekStart: string;
  weekEnd: string;
  rowsSaved: number;
  rowsMatched: number | null;
  matchWarning: string | null;
} | { ok: false; message: string };

// 사용자 지시(2026-09-20): "그 자리에서 바로 편성표 파일을 업로드" — 관리자 화면의 업로드
// 로직(/api/admin/upload/schedule-grid)과 완전히 같은 처리를, Page 2(PD 세션)에서도 쓸 수
// 있도록 공유한다. 채널·주차는 파일 자체(제목·파일명)에서 자동 인식하며, 호출 쪽이 보고 있던
// 채널과 다른 채널의 파일이 올라와도 그대로 저장한다(파일이 말하는 채널이 항상 우선).
export async function ingestScheduleGridFile(file: File): Promise<ScheduleGridUploadResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseScheduleGridWorkbook(buffer, file.name);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }

  const { data: channel } = await supabase.from("channels").select("id").eq("code", parsed.channelCode).maybeSingle();
  if (!channel) {
    return { ok: false, message: `채널(${parsed.channelCode})을 찾지 못했습니다.` };
  }

  const rowsToUpsert = parsed.rows.map((r) => ({
    channel_id: channel.id,
    week_start: parsed.weekStart,
    week_end: parsed.weekEnd,
    dow: r.dow,
    broadcast_date: r.broadcastDate,
    start_time: r.startTime,
    end_time: r.endTime,
    program_name_raw: r.programNameRaw,
    tags: r.tags,
    source_file_name: file.name,
  }));

  const { error: upsertError } = await supabase
    .from("program_schedule_grid")
    .upsert(rowsToUpsert, { onConflict: "channel_id,broadcast_date,start_time" });
  if (upsertError) {
    return { ok: false, message: "저장에 실패했습니다: " + upsertError.message };
  }

  const { data: matchedCount, error: matchError } = await supabase.rpc("match_schedule_grid_ratings", {
    p_channel_id: channel.id,
    p_week_start: parsed.weekStart,
  });

  return {
    ok: true,
    channelCode: parsed.channelCode,
    weekStart: parsed.weekStart,
    weekEnd: parsed.weekEnd,
    rowsSaved: rowsToUpsert.length,
    rowsMatched: matchError ? null : matchedCount,
    matchWarning: matchError ? matchError.message : null,
  };
}

// 사용자 지시(2026-09-20): "모든 채널 그라데이션이 더욱 잘 비교되게... 연간 채널 평균
// 시청률보다 높은 시청률 칸은 잘 보이게 표시" — 채널마다 절대 시청률 수준이 달라서, 각 주차
// 자체의 최댓값으로 색 강도를 정하면(기존 방식) 채널·주차 사이 비교가 왜곡된다(어느 채널이든
// "그 주의 1등"은 항상 가장 진하게 보임). 대신 이 채널의 연초~오늘 누적 평균 시청률(Page 1
// 히어로 카드·get_channel_period_rank_and_rating과 같은 계산, 새 지표 아님)을 고정 기준선으로
// 써서, "이 채널의 평소 대비 얼마나 강한가"가 채널 간에도 같은 눈금으로 비교되게 한다.
export async function getChannelAnnualAvgRating(channelId: string, primaryTarget: string | null): Promise<number | null> {
  if (!primaryTarget) return null;
  const { data: targetRow } = await supabase.from("targets").select("id").eq("label", resolveRankSheetTargetLabel(primaryTarget)).maybeSingle();
  if (!targetRow) return null;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.rpc("get_channel_period_rank_and_rating", {
    p_channel_id: channelId,
    p_target_id: targetRow.id,
    p_date_from: `${today.slice(0, 4)}-01-01`,
    p_date_to: today,
  });
  return (data as { avg_rating: number | null }[] | null)?.[0]?.avg_rating ?? null;
}
