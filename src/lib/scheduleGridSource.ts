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

export type ScheduleGridWeek = { weekStart: string; weekEnd: string; hasUpload: boolean };

// 사용자 지시(2026-09-20): "관리자 화면의 링크가 아닌 2페이지에서의 링크로" — PD 세션용
// 주간 비교 화면(/schedule-grid)도 관리자 화면과 같은 주차 목록이 필요해 공유한다.
export async function getScheduleGridWeeks(channelId: string): Promise<ScheduleGridWeek[]> {
  const { data: uploadedRows, error } = await supabase
    .from("program_schedule_grid")
    .select("week_start, week_end")
    .eq("channel_id", channelId)
    .order("week_start", { ascending: false });
  if (error) throw new Error(error.message);

  const weeks = new Map<string, ScheduleGridWeek>();
  for (const row of uploadedRows ?? []) {
    weeks.set(row.week_start, { weekStart: row.week_start, weekEnd: row.week_end, hasUpload: true });
  }

  // 업로드 유무와 무관하게, 실제 시청률 데이터가 있는 최근 12주도 선택지에 넣는다(DB 재구성용).
  const { data: latestRatingRow } = await supabase
    .from("ratings")
    .select("broadcast_date")
    .eq("channel_id", channelId)
    .in("source_type", ["nielsen_daily", "skyuhd"])
    .order("broadcast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRatingRow?.broadcast_date) {
    const latestMonday = mondayOf(latestRatingRow.broadcast_date);
    for (let i = 0; i < 12; i++) {
      const weekStart = addDaysStr(latestMonday, -7 * i);
      const weekEnd = addDaysStr(weekStart, 6);
      if (!weeks.has(weekStart)) weeks.set(weekStart, { weekStart, weekEnd, hasUpload: false });
    }
  }

  return [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
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
// 사용자 지시(2026-09-20 재지시): "기본적으로 DB 기반으로 구성하되, 업로드된 편성표가
// 매치되는 회차나 부제가 있으면 그것만 덧붙이는 형태로" — 세 가지 상태를 구분한다.
// "db": 업로드 자체가 없어 순수 재구성. "db+upload": 재구성 결과에 업로드의 회차·부제·태그를
// 덧붙임(기본값, 업로드가 있을 때). "upload": 사용자가 명시적으로 "업로드 원본 그대로 보기"를
// 선택했을 때만.
export type ScheduleGridSource = "upload" | "db" | "db+upload";

export async function getScheduleGridRows(
  channelId: string,
  channelCode: string,
  primaryTarget: string | null,
  week: string,
  // 사용자 지시(2026-09-20): "업로드 원본 그대로 보기" 옵션 — 기본은 DB 기반(+업로드 메타데이터
  // 보강)이고, 이걸 켰을 때만 업로드 파일 원본 그리드를 그대로 쓴다.
  options?: { forceUpload?: boolean }
): Promise<{ source: ScheduleGridSource; rows: ScheduleGridSourceRow[]; hasUpload: boolean; hasEpgData: boolean }> {
  const { data: uploadedRows, error } = await supabase
    .from("program_schedule_grid")
    .select("dow, broadcast_date, start_time, end_time, program_name_raw, tags, matched_rating, matched_program_id")
    .eq("channel_id", channelId)
    .eq("week_start", week)
    .order("dow", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  const hasUpload = !!uploadedRows && uploadedRows.length > 0;
  if (hasUpload && options?.forceUpload) {
    return { source: "upload", rows: uploadedRows!.map(({ matched_program_id: _mpid, ...r }) => r), hasUpload, hasEpgData: false };
  }

  if (!primaryTarget) return { source: "db", rows: [], hasUpload, hasEpgData: false };
  const { data: dbRows, error: dbError } = await supabase.rpc("get_channel_week_schedule", {
    p_channel_code: channelCode,
    p_program_target_label: resolveProgramLevelTargetLabel(primaryTarget),
    p_week_start: week,
  });
  if (dbError) throw new Error(dbError.message);

  // 업로드 행을 (요일, 매칭된 프로그램 id)로 색인해둔다 — match_schedule_grid_ratings가 이미
  // 업로드 시점에 계산해 둔 matched_program_id를 그대로 재사용한다(새 fuzzy 매칭을 만들지
  // 않음). 같은 (요일, 프로그램) 조합이 여러 번이면 처음 것만 쓴다(회차가 여러 번 겹칠 일은
  // 실무상 없음).
  const uploadByDowAndProgram = new Map<string, { program_name_raw: string; tags: string | null }>();
  if (hasUpload) {
    for (const u of uploadedRows!) {
      if (!u.matched_program_id) continue;
      const key = `${u.dow}__${u.matched_program_id}`;
      if (!uploadByDowAndProgram.has(key)) uploadByDowAndProgram.set(key, { program_name_raw: u.program_name_raw, tags: u.tags });
    }
  }

  const rows: ScheduleGridSourceRow[] = (
    (dbRows ?? []) as {
      dow: number;
      broadcast_date: string;
      start_time: string;
      end_time: string | null;
      program_id: string | null;
      canonical_name: string;
      rating: number;
      episode_number: number | null;
      episode_subtitle: string | null;
    }[]
  ).map((r) => {
    const upload = r.program_id ? uploadByDowAndProgram.get(`${r.dow}__${r.program_id}`) : undefined;
    // 사용자 지시(2026-09-20): "OLIFE는 네이버 메일함을 통해서나 직접 업로드를 통해서 회차와
    // 부제 정보를 획득... 그것들도 편성표에 반영해줘" — ratings.episode_number/episode_subtitle은
    // 이미 OLIFE EPG(일일운행표) 매칭으로 채워져 있는 값이다(새 매칭 로직 아님). 업로드된
    // 편성표에 매칭되는 값이 있으면 그게 우선(부제·본방/재방 태그가 더 풍부)이고, 없으면 이
    // EPG 값으로 대신 보강한다.
    const epgName = r.episode_subtitle ? `${r.canonical_name} - ${r.episode_subtitle}` : r.canonical_name;
    const epgTags = r.episode_number ? `${r.episode_number}회` : null;
    return {
      dow: r.dow,
      broadcast_date: r.broadcast_date,
      start_time: r.start_time,
      end_time: r.end_time,
      program_name_raw: upload?.program_name_raw ?? epgName,
      tags: upload?.tags ?? epgTags,
      matched_rating: r.rating,
    };
  });
  // 업로드가 없어도 EPG로 회차·부제가 채워진 행이 하나라도 있으면 화면에 그대로 알린다 —
  // "부제·회차 없음" 배지가 OLIFE처럼 실제로는 있는 채널에도 잘못 뜨지 않도록.
  const hasEpgData = (dbRows ?? []).some((r: { episode_number: number | null; episode_subtitle: string | null }) => r.episode_number !== null || r.episode_subtitle !== null);
  return { source: hasUpload ? "db+upload" : "db", rows, hasUpload, hasEpgData };
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
