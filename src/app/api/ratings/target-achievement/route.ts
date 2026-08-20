// 목표 대비 달성률·Gap 조회 API. 계산은 get_target_achievement() SQL 함수가 전부 한다
// (CLAUDE.md 원칙: 달성률=실제÷목표×100, Gap=실제−목표를 Claude가 암산하지 않는다).
// 관리자·PD 둘 다 조회 가능 (열람 기능).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const year = searchParams.get("year");

  if (!channel || !from || !to || !year) {
    return NextResponse.json(
      { ok: false, message: "channel, from, to, year 파라미터가 모두 필요합니다." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("get_target_achievement", {
    p_channel_code: channel,
    p_date_from: from,
    p_date_to: to,
    p_year: parseInt(year, 10),
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result: data?.[0] ?? null });
}
