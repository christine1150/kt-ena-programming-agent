// 사용자 지시(2026-09-19): "엑셀로 다운받을 수도 있는 기능"
// 사용자 재지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는 내용으로... 정확한
// 시작시간과 종료시간이 반영되어 빈틈이 없는 편성표 + 시청률을 반영한 편성표 히트맵 파일을
// 만들 수 있는거지?" — 업로드가 없어도 ratings의 실제 방영 구간(start_time~end_time)으로
// 재구성해 내려준다(getScheduleGridRows, data 라우트와 동일 로직 공유).
// 실제 워크북 생성은 scheduleGridExcel.ts로 옮겨 Page 2(PD 세션)용 export 라우트
// (/api/schedule-grid/export)와 공유한다(2026-09-20).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { getScheduleGridRows, type ScheduleGridSourceRow, type ScheduleGridSource } from "@/lib/scheduleGridSource";
import { buildScheduleGridExcelBuffer } from "@/lib/scheduleGridExcel";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  const week = params.get("week");
  const forceUpload = params.get("view") === "upload";
  if (!channelCode || !week) return NextResponse.json({ ok: false, message: "channel, week 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color, primary_target").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  let source: ScheduleGridSource;
  let rows: ScheduleGridSourceRow[];
  try {
    ({ source, rows } = await getScheduleGridRows(channel.id, channelCode, channel.primary_target, week, { forceUpload }));
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }

  const arrayBuffer = await buildScheduleGridExcelBuffer(channel.name, channel.theme_color, source, rows, week);
  const downloadName = encodeURIComponent(`${channel.name}_${week}_편성표${source !== "upload" ? "_DB재구성" : ""}.xlsx`);
  return new NextResponse(new Uint8Array(arrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-grid.xlsx"; filename*=UTF-8''${downloadName}`,
    },
  });
}
