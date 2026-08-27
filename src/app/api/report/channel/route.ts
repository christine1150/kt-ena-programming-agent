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
import { supabase } from "@/lib/supabase";
import { buildChannelReportData, buildChannelPeriodReportData, type ReportTier, type FitScoreItem } from "@/lib/channelReport";
import { buildPeriodReportSummaryViaLlm, buildStrategicImplicationsViaLlm } from "@/lib/periodReportLlm";

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
  // Phase B(2026-08-27, 사용자 지시: "Quarterly Report·Annual Report... 진행", 대상 기간은
  // "QTD/YTD 그대로" 쓰기로 확정) — ChannelDeepDive.tsx가 periodPreset을 그대로 실어 보낸다.
  // preset이 "qtd"/"ytd"일 때만 Quarterly/Annual 전용 섹션을 채우고, 나머지 프리셋은 Phase A와
  // 완전히 동일하게 동작(reportTier "standard").
  const preset = searchParams.get("preset");
  const reportTier: ReportTier = preset === "qtd" ? "quarterly" : preset === "ytd" ? "annual" : "standard";
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
    // Phase B: Quarterly(preset=qtd)/Annual(preset=ytd) tier만 추가로 필요한 데이터를 모은다 —
    // WTD/MTD/last7/last30/DoD~YoY/직접 선택은 이 블록을 건너뛰어 Phase A와 완전히 동일하게 동작.
    let fitScoreItems: FitScoreItem[] = [];
    let trendSeries: { period_start: string; avg_rating: number | null }[] = [];
    let trendGranularity: "week" | "month" | null = null;
    let quarterlyBreakdown: { quarter_num: number; quarter_date_from: string; quarter_date_to: string; avg_rating: number | null; days_with_data: number }[] = [];
    let annualRank: { avg_rank: number | null; avg_rating: number | null } | null = null;

    if (reportTier !== "standard" && dashboardJson.matchedTargetLabel) {
      const targetLabel = dashboardJson.matchedTargetLabel as string;
      const [fitScoreRes, trendRes] = await Promise.all([
        // Program Portfolio Review — 일간 모드와 같은 API 재사용(Fit Score는 항상 "최근 12주"
        // 기준이라 기간 프리셋과 무관, dateTo를 기준일로 넘기면 됨).
        fetch(`${origin}/api/scheduling/fit-score?code=${code}&date=${dateTo}`, forward).then((r) => r.json()),
        reportTier === "quarterly"
          ? supabase.rpc("get_channel_weekly_rating_trend", { p_channel_code: code, p_target_label: targetLabel, p_date_from: dateFrom, p_date_to: dateTo })
          : supabase.rpc("get_channel_monthly_rating_trend", { p_channel_code: code, p_target_label: targetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
      ]);
      fitScoreItems = fitScoreRes.ok ? (fitScoreRes.items ?? []) : [];
      trendSeries = (trendRes.data ?? []).map((row: Record<string, unknown>) => ({
        period_start: (row.week_start ?? row.month_start) as string,
        avg_rating: row.avg_rating as number | null,
      }));
      trendGranularity = reportTier === "quarterly" ? "week" : "month";

      if (reportTier === "annual") {
        const [breakdownRes] = await Promise.all([supabase.rpc("get_channel_quarterly_breakdown", { p_channel_code: code, p_target_label: targetLabel, p_date_from: dateFrom, p_date_to: dateTo })]);
        quarterlyBreakdown = breakdownRes.data ?? [];
        // Annual Rank Snapshot — Page 1 히어로 카드와 정확히 같은 값(dashboardJson.ytdAvgRating/
        // ytdAvgRank, 이미 1/1~오늘로 계산됨) 재사용. 새 조회 없음.
        annualRank = { avg_rank: dashboardJson.ytdAvgRank ?? null, avg_rating: dashboardJson.ytdAvgRating ?? null };
      }
    }

    const report = buildChannelPeriodReportData(channel, dashboardJson.dateFrom, dashboardJson.dateTo, periodLabel, comparisonLabel, {
      periodReport: dashboardJson.periodReport ?? null,
      periodProgramMovers: dashboardJson.periodProgramMovers ?? [],
      daypartOpportunity: dashboardJson.daypartOpportunity ?? [],
      topPrograms: dashboardJson.topPrograms ?? [],
      competitorPeriodTopPrograms: dashboardJson.competitorPeriodTopPrograms ?? [],
      aiSummary: null,
      reportTier,
      fitScoreItems,
      trendSeries,
      trendGranularity,
      quarterlyBreakdown,
      annualRank,
      periodDemographics: dashboardJson.periodDemographics ?? [],
      strategicImplications: null,
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
      growthDrivers: report.growthDrivers.map((d) => ({ name: d.name, ratingDelta: d.ratingDelta, isNewlyScheduled: d.priorAvgRating === null })),
      weaknessDrivers: report.weaknessDrivers.map((d) => ({ name: d.name, ratingDelta: d.ratingDelta, isNewlyScheduled: d.priorAvgRating === null })),
      winDaypart: report.win?.daypartLabel ?? null,
      weaknessDaypart: report.weakness?.daypartLabel ?? null,
    });

    // Strategic Implications(Quarterly/Annual tier 전용) — Turning Points까지 근거로 준 확장 종합.
    let strategicImplications: string | null = null;
    if (reportTier !== "standard") {
      strategicImplications = await buildStrategicImplicationsViaLlm({
        channelName: channel.name,
        periodLabel,
        reportTier,
        avgRating: dashboardJson.periodReport?.avg_rating ?? null,
        priorPeriodChangePct: dashboardJson.periodReport?.prior_period_change_pct ?? null,
        baselineChangePct: dashboardJson.periodReport?.baseline_change_pct ?? null,
        turningPoints: report.turningPoints.map((t) => ({ periodStart: t.periodStart, direction: t.direction, changePct: t.changePct })),
        growthDrivers: report.growthDrivers.map((d) => ({ name: d.name, ratingDelta: d.ratingDelta })),
        weaknessDrivers: report.weaknessDrivers.map((d) => ({ name: d.name, ratingDelta: d.ratingDelta })),
        winDaypart: report.win?.daypartLabel ?? null,
        weaknessDaypart: report.weakness?.daypartLabel ?? null,
        topCompetitor: report.competitorTopPrograms[0] ? { name: report.competitorTopPrograms[0].competitorName, rating: report.competitorTopPrograms[0].rating } : null,
      });
    }

    return NextResponse.json({ ok: true, mode: "period", report: { ...report, aiSummary, strategicImplications } });
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
