// 채널별로 업로드된 편성표 주차 목록(최신순) — 화면의 주차 선택 드롭다운용.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const channelCode = new URL(request.url).searchParams.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: true, weeks: [] });

  const { data, error } = await supabase
    .from("program_schedule_grid")
    .select("week_start, week_end")
    .eq("channel_id", channel.id)
    .order("week_start", { ascending: false });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const seen = new Map<string, { weekStart: string; weekEnd: string }>();
  for (const row of data ?? []) {
    if (!seen.has(row.week_start)) seen.set(row.week_start, { weekStart: row.week_start, weekEnd: row.week_end });
  }
  return NextResponse.json({ ok: true, weeks: [...seen.values()] });
}
