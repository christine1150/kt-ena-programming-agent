// skyUHD 전용 CONTENT FITS?/WHAT TO SCHEDULE? 대체 지표 조회 API.
// skyUHD는 원본 Nielsen 파일에 타깃 구분이 없어 PRD 고정 Fit Score(타깃 기반) 계산이 불가능하다
// (refresh_fit_score_mart()가 처음부터 skyUHD를 제외 — CLAUDE.md 원칙: "계산 공식은 PRD.md에
// 명시된 것을 그대로 쓴다", 임의로 다른 공식을 만들지 않는다). 그래서 별도 SQL 함수
// get_skyuhd_program_scorecard()(채널 내 시청률 percentile + 최근 4주/이전 8주 추세만 사용)로
// 계산한 값을 그대로 반환한다 — 여기서도 계산은 하지 않고 조회만 한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const { data: channel } = await supabase.from("channels").select("id").eq("code", "SKYUHD").maybeSingle();
  if (!channel) {
    return NextResponse.json({ ok: false, message: "skyUHD 채널을 찾을 수 없습니다." }, { status: 404 });
  }

  const requestedDate = searchParams.get("date");
  let asOfDate = requestedDate;
  if (!asOfDate) {
    const { data: latestRow } = await supabase
      .from("ratings")
      .select("broadcast_date")
      .eq("channel_id", channel.id)
      .in("source_type", ["nielsen_daily", "skyuhd"])
      .order("broadcast_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    asOfDate = latestRow?.broadcast_date ?? null;
  }
  if (!asOfDate) {
    return NextResponse.json({ ok: true, asOfDate: null, items: [] });
  }

  const { data: items, error } = await supabase.rpc("get_skyuhd_program_scorecard", {
    p_as_of_date: asOfDate,
    p_window_days: 84,
  });
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, asOfDate, items: items ?? [] });
}
