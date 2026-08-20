// 킬러 콘텐츠 자동 산출 API — 관리자와 PD 모두 조회 가능(공유 링크 접속자도 열람 가능한 정보).
// 실제 계산은 killer_content_v 뷰(SQL)가 하고, 여기서는 그 결과를 그대로 조회만 한다
// (CLAUDE.md 원칙: Claude/서버 코드가 암산하지 않고 SQL 집계 결과를 그대로 전달).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인 또는 공유 링크 접속이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channelCode = searchParams.get("channelCode");

  let query = supabase
    .from("killer_content_v")
    .select("channel_id, program_id, canonical_name, avg_rating, airing_count, last_aired_date, channel_rank, channels(code, name)")
    .lte("channel_rank", 3)
    .order("channel_rank", { ascending: true });

  if (channelCode) {
    const { data: channel } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
    if (!channel) {
      return NextResponse.json({ ok: false, message: `알 수 없는 채널 코드입니다: ${channelCode}` }, { status: 400 });
    }
    query = query.eq("channel_id", channel.id);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    items: data,
    note:
      data.length === 0
        ? "최근 28일 시청률 데이터가 아직 없습니다 (Nielsen 일별 업로드 이후부터 값이 나옵니다)."
        : undefined,
  });
}
