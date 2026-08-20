// 편성 추천(Fit Score 기반 5태그) 조회 API. 계산은 전부 SQL(refresh_fit_score_mart() +
// mart_scheduling_fit_score)이 미리 해두고, 여기서는 오늘 날짜로 계산된 값이 없으면 한 번
// 새로 계산시킨 뒤 결과를 그대로 돌려준다 — Claude는 결과를 해석·설명만 한다(CLAUDE.md 원칙).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ ok: false, message: "code 파라미터가 필요합니다." }, { status: 400 });
  }

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, code, name")
    .eq("code", code)
    .maybeSingle();
  if (channelError || !channel) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  // Page 2와 동일하게 기본은 실제 데이터가 있는 가장 최근 날짜지만, ?date=로 PD가 지정한
  // 날짜가 있으면 그 날짜를 기준으로 삼는다(우측 상단 기간 설정 메뉴).
  const requestedDate = searchParams.get("date");
  let asOfDate = requestedDate;
  if (!asOfDate) {
    const { data: latestRow } = await supabase
      .from("ratings")
      .select("broadcast_date")
      .eq("channel_id", channel.id)
      .eq("source_type", "nielsen_daily")
      .order("broadcast_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    asOfDate = latestRow?.broadcast_date ?? null;
  }
  if (!asOfDate) {
    return NextResponse.json({ ok: true, asOfDate: null, items: [] });
  }

  // 이 기준일로 이미 계산된 MART 데이터가 있는지 확인 — 없으면 그때 한 번 새로 계산한다
  // (하루 한 번만 계산되면 되므로, 요청마다 다시 계산하지 않는다).
  const { count } = await supabase
    .from("mart_scheduling_fit_score")
    .select("id", { count: "exact", head: true })
    .eq("as_of_date", asOfDate);

  if (!count || count === 0) {
    const { error: refreshError } = await supabase.rpc("refresh_fit_score_mart", {
      p_as_of_date: asOfDate,
      p_window_days: 84,
    });
    if (refreshError) {
      // refresh_fit_score_mart()는 delete 후 재삽입하는 구조라, 같은 as_of_date를 처음 조회하는
      // 요청이 동시에 여러 개 들어오면 서로의 삭제/삽입이 겹쳐 실패할 수 있다(회고 리뷰에서 확인한
      // 경합 조건 — 실제로 프리셋을 빠르게 연속 클릭할 때 간헐적 500이 관찰됐었음). 에러를 바로
      // 반환하기 전에, 그 사이 다른 요청이 이미 계산을 끝냈는지 한 번 더 확인한다.
      const { count: recheckCount } = await supabase
        .from("mart_scheduling_fit_score")
        .select("id", { count: "exact", head: true })
        .eq("as_of_date", asOfDate);
      if (!recheckCount || recheckCount === 0) {
        return NextResponse.json({ ok: false, message: `Fit Score 계산 실패: ${refreshError.message}` }, { status: 500 });
      }
    }
  }

  const { data: rows, error } = await supabase
    .from("mart_scheduling_fit_score")
    .select(
      "fit_score, target_performance_score, target_affinity_score, audience_engagement_score, slot_performance_score, competitive_opportunity_score, audience_flow_score, sample_days, confidence_pct, tag, evidence, program_id, programs(canonical_name, raw_name, first_run)"
    )
    .eq("as_of_date", asOfDate)
    .eq("channel_id", channel.id)
    .order("fit_score", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  // 최근 14일 안에 실제로 방영된 프로그램만 "현재 편성 중"으로 보여준다
  // (12주 표본에는 있지만 이미 오래전에 종영한 프로그램까지 추천 목록에 섞이지 않도록).
  const fourteenDaysAgo = new Date(asOfDate);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().slice(0, 10);

  const { data: recentPrograms } = await supabase
    .from("ratings")
    .select("program_id")
    .eq("channel_id", channel.id)
    .eq("source_type", "nielsen_daily")
    .not("program_id", "is", null)
    .gte("broadcast_date", fourteenDaysAgoStr);
  const recentProgramIds = new Set((recentPrograms ?? []).map((r) => r.program_id));

  const items = (rows ?? []).filter((r) => recentProgramIds.has(r.program_id));

  return NextResponse.json({ ok: true, asOfDate, items });
}
