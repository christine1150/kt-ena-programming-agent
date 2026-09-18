// 선택한 채널·주차의 편성표 그리드 원본 행 — 화면이 이 원자료를 시간대×요일로 재배열해 보여준다.
// 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는 내용으로... 직접 편성표를
// 그릴 수 있지 않니?" — 그 주차에 업로드된 편성표(program_schedule_grid)가 있으면 그대로 쓰고
// (부제·회차·본방/재방 태그까지 그 파일에서 나온다), 없으면 ratings의 실제 방영 구간을 그대로
// 편성표 모양으로 재구성한다(get_channel_week_schedule, 부제·회차 정보 없음 — DB에 그 정보가
// 없기 때문에 지어내지 않는다). source 필드로 어느 쪽인지 화면에 그대로 알린다.
// 조회 로직 자체는 export 라우트(엑셀 다운로드)와 완전히 같아 scheduleGridSource.ts로 공유한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { getScheduleGridRows, addDaysStr } from "@/lib/scheduleGridSource";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  const week = params.get("week");
  if (!channelCode || !week) return NextResponse.json({ ok: false, message: "channel, week 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color, primary_target").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  try {
    const { source, rows } = await getScheduleGridRows(channel.id, channelCode, channel.primary_target, week);
    return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, source, week, weekEnd: addDaysStr(week, 6), rows });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
