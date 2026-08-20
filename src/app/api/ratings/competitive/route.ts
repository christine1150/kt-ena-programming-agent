// Competitive Pressure(경쟁채널 분석) 조회 API. 계산은 get_competitive_pressure() SQL 함수가
// 전부 하고, 여기서는 결과를 그대로 돌려준다.
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
  const target = searchParams.get("target");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!channel || !target || !from || !to) {
    return NextResponse.json(
      { ok: false, message: "channel, target, from, to 파라미터가 모두 필요합니다." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("get_competitive_pressure", {
    p_channel_code: channel,
    p_target_label: target,
    p_date_from: from,
    p_date_to: to,
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result: data?.[0] ?? null });
}
