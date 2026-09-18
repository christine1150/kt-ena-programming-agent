// 사용자 지시(2026-09-20): "1페이지 또는 2페이지에... 이번 주 실제 편성표 보기" — 관리자
// 화면 전용이던 편성표 조회를 PD 세션에서도 쓸 수 있게 연다(getCurrentSession — admin/PD 둘 다
// 허용). week 파라미터를 생략하면 항상 "이번 주"(오늘이 속한 월요일 시작 주)를 기본값으로
// 쓴다 — Page 2에는 주차 선택 UI가 없다(심플하게, 2주 비교·다운로드는 관리자 화면 몫).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { getScheduleGridRows, mondayOf, addDaysStr } from "@/lib/scheduleGridSource";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });
  const week = params.get("week") ?? mondayOf(new Date().toISOString().slice(0, 10));

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color, primary_target").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  try {
    const { source, rows } = await getScheduleGridRows(channel.id, channelCode, channel.primary_target, week);
    return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, source, week, weekEnd: addDaysStr(week, 6), rows });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
