// 채널별로 볼 수 있는 편성표 주차 목록(최신순) — 화면의 주차 선택 드롭다운용.
// 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는 내용으로... 직접 편성표를
// 그릴 수 있지 않니?" — 업로드된 주차(program_schedule_grid)뿐 아니라, ratings에 실제 데이터가
// 있는 최근 주차도 함께 보여준다(hasUpload로 구분 — 화면에서 "실제 업로드"/"DB 자동 구성" 표시).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1=월 ... 7=일
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const channelCode = new URL(request.url).searchParams.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: true, weeks: [] });

  const { data: uploadedRows, error } = await supabase
    .from("program_schedule_grid")
    .select("week_start, week_end")
    .eq("channel_id", channel.id)
    .order("week_start", { ascending: false });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const weeks = new Map<string, { weekStart: string; weekEnd: string; hasUpload: boolean }>();
  for (const row of uploadedRows ?? []) {
    weeks.set(row.week_start, { weekStart: row.week_start, weekEnd: row.week_end, hasUpload: true });
  }

  // 업로드 유무와 무관하게, 실제 시청률 데이터가 있는 최근 12주도 선택지에 넣는다(DB 재구성용).
  const { data: latestRatingRow } = await supabase
    .from("ratings")
    .select("broadcast_date")
    .eq("channel_id", channel.id)
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

  return NextResponse.json({ ok: true, weeks: [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)) });
}
