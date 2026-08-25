// "요일 별 리뷰 프로그램" 화이트리스트(채널기본정보.xlsx로 업로드된 값) 조회 전용 API.
// 사용자 지시(2026-08-25): 관리자 화면에서도 시트와 같은 형태(분류/타이틀/본방채널/동시방송/
// 직후재방/첫방송일자/매주반복편성/예상회차/종영일)로 확인할 수 있게 — 편집은 여전히 엑셀
// 재업로드로만 하고(ChannelMasterUploader가 매번 전체 교체), 여기는 조회만 제공한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

const DAY_LABEL = ["", "월", "화", "수", "목", "금", "토", "일"];

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("original_review_programs")
    .select(
      `
      id,
      day_of_week_iso,
      program_name,
      category,
      broadcast_time,
      note,
      first_broadcast_date,
      expected_episode_count,
      series_end_date,
      sort_order,
      broadcast_channel:channels!original_review_programs_broadcast_channel_id_fkey(code,name),
      simulcast_channel:channels!original_review_programs_simulcast_channel_id_fkey(code,name),
      rerun_channel:channels!original_review_programs_rerun_channel_id_fkey(code,name)
      `
    )
    .order("day_of_week_iso")
    .order("sort_order");

  if (error) {
    return NextResponse.json({ ok: false, message: `조회 실패 — ${error.message}` }, { status: 500 });
  }

  type ChannelRef = { code: string; name: string } | { code: string; name: string }[] | null;
  const pickOne = (c: ChannelRef) => (Array.isArray(c) ? (c[0] ?? null) : c);

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    dayLabel: DAY_LABEL[r.day_of_week_iso] ?? "",
    programName: r.program_name,
    category: r.category,
    broadcastChannelName: pickOne(r.broadcast_channel as ChannelRef)?.name ?? null,
    simulcastChannelName: pickOne(r.simulcast_channel as ChannelRef)?.name ?? null,
    rerunChannelName: pickOne(r.rerun_channel as ChannelRef)?.name ?? null,
    broadcastTime: r.broadcast_time,
    note: r.note,
    firstBroadcastDate: r.first_broadcast_date,
    expectedEpisodeCount: r.expected_episode_count,
    seriesEndDate: r.series_end_date,
  }));

  return NextResponse.json({ ok: true, rows });
}
