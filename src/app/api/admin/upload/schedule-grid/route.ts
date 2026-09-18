// 사용자 지시(2026-09-19): "2주간 편성표를 넣으면 실제 나온 시청률을 편성표 안에 적어주고,
// 히트맵으로 보여주고, 엑셀로 다운받을 수도 있는 기능". 방송사 주간 편성표 엑셀을 업로드하면
// (1) 채널·주(week)를 파일 자체에서 자동 인식하고(선택 UI 없음), (2) program_schedule_grid에
// 원본 그리드를 저장하고, (3) 이미 적재된 ratings와 매칭해 실제 시청률을 채운다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseScheduleGridWorkbook } from "@/lib/scheduleGridParse";

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "업로드할 파일을 선택해주세요." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseScheduleGridWorkbook(buffer, file.name);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
  }

  const { data: channel } = await supabase.from("channels").select("id").eq("code", parsed.channelCode).maybeSingle();
  if (!channel) {
    return NextResponse.json({ ok: false, message: `채널(${parsed.channelCode})을 찾지 못했습니다.` }, { status: 400 });
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
    return NextResponse.json({ ok: false, message: "저장에 실패했습니다: " + upsertError.message }, { status: 500 });
  }

  // 저장 직후 그 주 전체에 대해 ratings 매칭을 (재)수행 — 재업로드 시에도 최신 ratings 기준으로
  // 다시 매칭되도록 매번 실행한다(비용이 작음, 그 주 행만 대상).
  const { data: matchedCount, error: matchError } = await supabase.rpc("match_schedule_grid_ratings", {
    p_channel_id: channel.id,
    p_week_start: parsed.weekStart,
  });

  return NextResponse.json({
    ok: true,
    channelCode: parsed.channelCode,
    weekStart: parsed.weekStart,
    weekEnd: parsed.weekEnd,
    rowsSaved: rowsToUpsert.length,
    rowsMatched: matchError ? null : matchedCount,
    matchWarning: matchError ? matchError.message : null,
  });
}
