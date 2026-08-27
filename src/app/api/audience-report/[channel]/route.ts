// Phase 6(2026-08-28, 계획서 J절 §11-9) — Audience Intelligence Report 조립 API. 구 시스템
// (/api/report/channel)과 완전히 분리(1·2페이지 형식을 따르지 않는다는 사용자 지시 그대로) —
// 이 라우트는 audienceReport/reportBuilder.ts만 호출한다.
//
// 쿼리 파라미터(설계서 §06 4개 모드에 그대로 대응):
// - date                                          → MODE A(하루)
// - dateFrom + dateTo                             → MODE B(시작~끝)
// - dateFrom + dateTo + compareFrom + compareTo   → MODE C(기간A vs 기간B)
// - preset(+customFrom/customTo)                  → MODE D(누적·트레일링·주기비교)
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildAudienceReport, type AudienceReportRequest } from "@/lib/audienceReport/reportBuilder";
import type { PeriodPreset } from "@/lib/audienceReport/periodPresets";

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { channel } = await params;
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
    const report = await buildAudienceReport(channel, reportRequest);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "리포트를 생성하지 못했습니다." }, { status: 500 });
  }
}
