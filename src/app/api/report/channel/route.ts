// Channel Intelligence Report — 리포트 JSON 조립 API(Phase 3, 2026-08-27, 사용자 지시).
// 새 SQL·새 계산 없음: 이미 배포된 3개 API(/api/dashboard/channel, /api/scheduling/fit-score,
// /api/scheduling/program-momentum)를 서버 안에서 그대로 호출해(같은 요청의 쿠키를 그대로
// 실어서) 결과를 합치고, src/lib/channelReport.ts로 문서용 모양으로만 재배열한다 — CLAUDE.md
// "로직 중복 금지" 원칙: 같은 숫자를 두 곳에서 다시 계산하지 않고 이미 검증된 API 응답을 재사용.
// 이 JSON은 /report/[date] 미리보기 페이지와 docx/pptx 다운로드 라우트가 공통으로 쓴다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildChannelReportData } from "@/lib/channelReport";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const date = searchParams.get("date");
  if (!code || !date) {
    return NextResponse.json({ ok: false, message: "code, date 파라미터가 필요합니다." }, { status: 400 });
  }
  const cookie = request.headers.get("cookie") ?? "";
  const forward = { headers: { cookie } };

  const dashboardRes = await fetch(`${origin}/api/dashboard/channel?code=${code}&date=${date}`, forward);
  const dashboardJson = await dashboardRes.json();
  if (!dashboardJson.ok) {
    return NextResponse.json({ ok: false, message: dashboardJson.message ?? "채널 데이터를 불러오지 못했습니다." }, { status: dashboardRes.status });
  }
  if (!dashboardJson.asOfDate) {
    return NextResponse.json({ ok: false, message: "이 날짜에는 데이터가 없습니다." }, { status: 404 });
  }

  const fitScoreRes = await fetch(`${origin}/api/scheduling/fit-score?code=${code}&date=${date}`, forward);
  const fitScoreJson = await fitScoreRes.json();
  const fitScoreItems = fitScoreJson.ok ? (fitScoreJson.items ?? []) : [];

  const programIds = fitScoreItems.map((f: { program_id: string }) => f.program_id).filter(Boolean);
  let momentumItems: { program_id: string; momentum: number | null; label: "RISING" | "STABLE" | "DECLINING" | null }[] = [];
  if (programIds.length > 0) {
    const momentumRes = await fetch(`${origin}/api/scheduling/program-momentum?code=${code}&program_ids=${programIds.join(",")}&date=${date}`, forward);
    const momentumJson = await momentumRes.json();
    if (momentumJson.ok) momentumItems = momentumJson.items ?? [];
  }

  const report = buildChannelReportData(
    {
      code: dashboardJson.channel.code,
      name: dashboardJson.channel.name,
      primaryTarget: dashboardJson.channel.primaryTarget,
      market: dashboardJson.channel.market,
    },
    dashboardJson.asOfDate,
    {
      trend: dashboardJson.trend ?? [],
      narrativeSignal: dashboardJson.narrativeSignal ?? null,
      rootCauseAlert: dashboardJson.rootCauseAlert ?? null,
      opportunityAlert: dashboardJson.opportunityAlert ?? null,
      daypartOpportunity: dashboardJson.daypartOpportunity ?? [],
      topPrograms: dashboardJson.topPrograms ?? [],
      briefingLlm: dashboardJson.briefingLlm ?? null,
    },
    fitScoreItems,
    momentumItems
  );

  return NextResponse.json({ ok: true, report });
}
