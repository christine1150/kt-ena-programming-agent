// 편성표 검토 화면(data 라우트)과 엑셀 다운로드(export 라우트)가 공유하는 "그 채널·주차의
// 편성표 원자료 조회" 로직. 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는
// 내용으로... 직접 편성표를 그릴 수 있지 않니?" — 업로드된 편성표(program_schedule_grid)가
// 있으면 그대로(부제·회차·본방/재방 태그 포함), 없으면 ratings의 실제 방영 구간(start_time~
// end_time)만으로 재구성한다(get_channel_week_schedule). 두 라우트가 각자 이 로직을 중복
// 구현하지 않도록 한 곳으로 모은다.
import { supabase } from "@/lib/supabase";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

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
  week: string
): Promise<{ source: ScheduleGridSource; rows: ScheduleGridSourceRow[] }> {
  const { data: uploadedRows, error } = await supabase
    .from("program_schedule_grid")
    .select("dow, broadcast_date, start_time, end_time, program_name_raw, tags, matched_rating")
    .eq("channel_id", channelId)
    .eq("week_start", week)
    .order("dow", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  if (uploadedRows && uploadedRows.length > 0) {
    return { source: "upload", rows: uploadedRows };
  }

  if (!primaryTarget) return { source: "db", rows: [] };
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
  return { source: "db", rows };
}
