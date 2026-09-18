// 선택한 채널·주차의 편성표 그리드 원본 행 — 화면이 이 원자료를 시간대×요일로 재배열해 보여준다.
// 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는 내용으로... 직접 편성표를
// 그릴 수 있지 않니?" — 그 주차에 업로드된 편성표(program_schedule_grid)가 있으면 그대로 쓰고
// (부제·회차·본방/재방 태그까지 그 파일에서 나온다), 없으면 ratings의 실제 방영 구간을 그대로
// 편성표 모양으로 재구성한다(get_channel_week_schedule, 부제·회차 정보 없음 — DB에 그 정보가
// 없기 때문에 지어내지 않는다). source 필드로 어느 쪽인지 화면에 그대로 알린다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  const week = params.get("week");
  if (!channelCode || !week) return NextResponse.json({ ok: false, message: "channel, week 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color, primary_target").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  const { data: uploadedRows, error } = await supabase
    .from("program_schedule_grid")
    .select("dow, broadcast_date, start_time, end_time, program_name_raw, tags, matched_rating")
    .eq("channel_id", channel.id)
    .eq("week_start", week)
    .order("dow", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  if (uploadedRows && uploadedRows.length > 0) {
    return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, source: "upload", rows: uploadedRows });
  }

  if (!channel.primary_target) {
    return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, source: "db", rows: [] });
  }
  const { data: dbRows, error: dbError } = await supabase.rpc("get_channel_week_schedule", {
    p_channel_code: channelCode,
    p_program_target_label: resolveProgramLevelTargetLabel(channel.primary_target),
    p_week_start: week,
  });
  if (dbError) return NextResponse.json({ ok: false, message: dbError.message }, { status: 500 });

  const rows = (dbRows ?? []).map((r: { dow: number; broadcast_date: string; start_time: string; end_time: string | null; canonical_name: string; rating: number }) => ({
    dow: r.dow,
    broadcast_date: r.broadcast_date,
    start_time: r.start_time,
    end_time: r.end_time,
    program_name_raw: r.canonical_name,
    tags: null,
    matched_rating: r.rating,
  }));
  return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, source: "db", rows });
}
