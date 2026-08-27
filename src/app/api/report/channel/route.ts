// Channel Intelligence Report — 리포트 JSON 조립 API(Phase 3, 2026-08-27 / Phase 4, 2026-08-27
// 확장: "어떤 기간을 선택하더라도 그 기간에 맞는 별도의 보고서" — 사용자 지시).
// 새 SQL·새 계산 없음: 이미 배포된 API(/api/dashboard/channel, /api/scheduling/fit-score,
// /api/scheduling/program-momentum)를 서버 안에서 그대로 호출해(같은 요청의 쿠키를 그대로
// 실어서) 결과를 합치고, src/lib/channelReport.ts로 문서용 모양으로만 재배열한다 — CLAUDE.md
// "로직 중복 금지" 원칙: 같은 숫자를 두 곳에서 다시 계산하지 않고 이미 검증된 API 응답을 재사용.
// 이 JSON은 /report/[date] 미리보기 페이지와 docx/pptx 다운로드 라우트가 공통으로 쓴다.
//
// 두 모드:
// - 일간(date만 있음): 기존 Phase 3 그대로(buildChannelReportData) — Health Score/Program
//   Momentum 포함(둘 다 "오늘 하루" 개념).
// - 기간(dateFrom+dateTo가 있음, ChannelDeepDive.tsx가 periodPreset마다 이미 계산해 넘겨주는
//   그 값 그대로): buildChannelPeriodReportData — get_rating_period_report/
//   get_channel_period_program_movers 등 이미 기간에 맞춰 계산된 값을 재조립.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildChannelReportData, buildChannelPeriodReportData } from "@/lib/channelReport";
import { buildPeriodReportSummaryViaLlm } from "@/lib/periodReportLlm";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const date = searchParams.get("date");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const priorDateFrom = searchParams.get("priorDateFrom");
  const priorDateTo = searchParams.get("priorDateTo");
  const periodLabel = searchParams.get("periodLabel") ?? "선택 기간";
  const comparisonLabel = searchParams.get("comparisonLabel");
  if (!code || (!date && !(dateFrom && dateTo))) {
    return NextResponse.json({ ok: false, message: "code와, date 또는 dateFrom/dateTo 파라미터가 필요합니다." }, { status: 400 });
  }
  const cookie = request.headers.get("cookie") ?? "";
  const forward = { headers: { cookie } };
  const isPeriodMode = !!(dateFrom && dateTo);

  const dashboardQuery = isPeriodMode
    ? `&dateFrom=${dateFrom}&dateTo=${dateTo}${priorDateFrom && priorDateTo ? `&priorDateFrom=${priorDateFrom}&priorDateTo=${priorDateTo}` : ""}`
    : `&date=${date}`;
  const dashboardRes = await fetch(`${origin}/api/dashboard/channel?code=${code}${dashboardQuery}`, forward);
  const dashboardJson = await dashboardRes.json();
  if (!dashboardJson.ok) {
    return NextResponse.json({ ok: false, message: dashboardJson.message ?? "채널 데이터를 불러오지 못했습니다." }, { status: dashboardRes.status });
  }
  if (!dashboardJson.asOfDate) {
    return NextResponse.json({ ok: false, message: "이 기간에는 데이터가 없습니다." }, { status: 404 });
  }

  const channel = {
    code: dashboardJson.channel.code,
    name: dashboardJson.channel.name,
    primaryTarget: dashboardJson.channel.primaryTarget,
    market: dashboardJson.channel.market,
  };

  if (isPeriodMode) {
    const report = buildChannelPeriodReportData(channel, dashboardJson.dateFrom, dashboardJson.dateTo, periodLabel, comparisonLabel, {
      periodReport: dashboardJson.periodReport ?? null,
      periodProgramMovers: dashboardJson.periodProgramMovers ?? [],
      daypartOpportunity: dashboardJson.daypartOpportunity ?? [],
      topPrograms: dashboardJson.topPrograms ?? [],
      competitorPeriodTopPrograms: dashboardJson.competitorPeriodTopPrograms ?? [],
      aiSummary: null,
    });
    // AI Executive Summary(기간 모드 전용, 새 계산 없음 — 위에서 이미 조립한 값만 근거로 준다).
    const aiSummary = await buildPeriodReportSummaryViaLlm({
      channelName: channel.name,
      periodLabel,
      comparisonLabel,
      daysWithData: report.daysWithData,
      avgRating: dashboardJson.periodReport?.avg_rating ?? null,
      priorPeriodChangePct: dashboardJson.periodReport?.prior_period_change_pct ?? null,
      baselineChangePct: dashboardJson.periodReport?.baseline_change_pct ?? null,
      bestDate: report.bestDay?.date ?? null,
      bestRating: report.bestDay?.rating ?? null,
      worstDate: report.worstDay?.date ?? null,
      worstRating: report.worstDay?.rating ?? null,
      growthDrivers: report.growthDrivers.map((d) => ({ name: d.name, ratingDelta: d.ratingDelta })),
      weaknessDrivers: report.weaknessDrivers.map((d) => ({ name: d.name, ratingDelta: d.ratingDelta })),
      winDaypart: report.win?.daypartLabel ?? null,
      weaknessDaypart: report.weakness?.daypartLabel ?? null,
    });
    return NextResponse.json({ ok: true, mode: "period", report: { ...report, aiSummary } });
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
    channel,
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

  return NextResponse.json({ ok: true, mode: "daily", report });
}
