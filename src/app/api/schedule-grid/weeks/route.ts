// 사용자 지시(2026-09-20): "이 링크들을 관리자 화면의 링크가 아닌 2페이지에서의 링크로
// 변환해줘. 다시 각 PD들이 관리자 화면으로 접근할 수 없도록" — Page 2의 "주간 비교" 화면
// (/schedule-grid)이 쓰는 PD 세션 허용 주차 목록 API. 관리자 화면(/api/admin/schedule-grid/
// weeks)과 계산 로직은 완전히 같아 scheduleGridSource.ts를 공유하되, 이 화면은 채널 선택
// 드롭다운이 없어(넘어온 채널 하나만 다룸) channelName·themeColor도 함께 내려준다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { getScheduleGridWeeks } from "@/lib/scheduleGridSource";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const channelCode = new URL(request.url).searchParams.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  try {
    const weeks = await getScheduleGridWeeks(channel.id);
    return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, weeks });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
