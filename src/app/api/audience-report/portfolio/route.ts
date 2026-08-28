// Phase 8(2026-08-28, 계획서 J절 §07) — 종합(포트폴리오) 리포트 조립 API. Phase 6의
// /api/audience-report/[channel]과 같은 쿼리 파라미터 규약·인증을 그대로 따르되, 채널 파라미터가
// 없다(7개 채널을 한 번에 다룬다).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildPortfolioReport } from "@/lib/audienceReport/portfolioBuilder";
import type { AudienceReportRequest } from "@/lib/audienceReport/reportBuilder";
import type { PeriodPreset } from "@/lib/audienceReport/periodPresets";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const compareFrom = searchParams.get("compareFrom");
  const compareTo = searchParams.get("compareTo");
  const preset = searchParams.get("preset");
  const customFrom = searchParams.get("customFrom") ?? undefined;
  const customTo = searchParams.get("customTo") ?? undefined;

  let reportRequest: AudienceReportRequest | null = null;
  if (preset) {
    reportRequest = { mode: "cumulative", latest: dateTo ?? date ?? new Date().toISOString().slice(0, 10), preset: preset as PeriodPreset, customFrom, customTo };
  } else if (dateFrom && dateTo && compareFrom && compareTo) {
    reportRequest = { mode: "compare", dateFrom, dateTo, priorDateFrom: compareFrom, priorDateTo: compareTo };
  } else if (dateFrom && dateTo) {
    reportRequest = { mode: "range", dateFrom, dateTo };
  } else if (date) {
    reportRequest = { mode: "single_day", date };
  }

  if (!reportRequest) {
    return NextResponse.json({ ok: false, message: "date, 또는 dateFrom/dateTo, 또는 preset 파라미터가 필요합니다." }, { status: 400 });
  }

  try {
    const report = await buildPortfolioReport(reportRequest);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "리포트를 생성하지 못했습니다." }, { status: 500 });
  }
}
