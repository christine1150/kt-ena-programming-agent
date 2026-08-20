// 시청률 핵심 지표 + DoD/WoW/MoM/QoQ/YoY/YTD 비교 API.
// 계산은 전부 Postgres 함수(get_rating_trend_summary 등, supabase/migrations 참고)가 하고,
// 이 API는 그 결과를 그대로 돌려주기만 한다 (CLAUDE.md: Claude가 암산하지 않는다는 원칙).
// 관리자·PD 둘 다 조회할 수 있다 (열람 전용 기능이라 로그인 여부만 확인, 관리자 전용 아님).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel"); // 예: ENA
  const target = searchParams.get("target"); // 예: "수도권 2049" (URL 인코딩 필요)
  const date = searchParams.get("date"); // 기준일 YYYY-MM-DD (생략 시 오늘)

  if (!channel || !target) {
    return NextResponse.json(
      { ok: false, message: "channel, target 파라미터가 모두 필요합니다." },
      { status: 400 }
    );
  }

  const asOfDate = date ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("get_rating_trend_summary", {
    p_channel_code: channel,
    p_target_label: target,
    p_as_of_date: asOfDate,
  });

  if (error) {
    // 알 수 없는 채널/타깃이면 함수 안에서 raise exception 하도록 만들어뒀다 — 그 메시지를 그대로 전달.
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, channel, target, asOfDate, trend: data });
}
