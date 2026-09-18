// 채널별로 볼 수 있는 편성표 주차 목록(최신순) — 화면의 주차 선택 드롭다운용.
// 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는 내용으로... 직접 편성표를
// 그릴 수 있지 않니?" — 업로드된 주차(program_schedule_grid)뿐 아니라, ratings에 실제 데이터가
// 있는 최근 주차도 함께 보여준다(hasUpload로 구분 — 화면에서 "실제 업로드"/"DB 자동 구성" 표시).
// 목록 계산 로직은 PD 세션용 /api/schedule-grid/weeks와 완전히 같아 scheduleGridSource.ts로
// 공유한다(2026-09-20).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { getScheduleGridWeeks } from "@/lib/scheduleGridSource";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const channelCode = new URL(request.url).searchParams.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: true, weeks: [] });

  try {
    const weeks = await getScheduleGridWeeks(channel.id);
    return NextResponse.json({ ok: true, weeks });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
