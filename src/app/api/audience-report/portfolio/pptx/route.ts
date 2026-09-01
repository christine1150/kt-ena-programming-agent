// Phase 13(2026-09-01) — 포트폴리오 리포트 상세 PPT(.pptx) 다운로드(표 위주 전체 리포트 —
// 6-슬라이드 Executive Deck과는 다른 문서, /portfolio/deck/pptx 참고).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildPortfolioReport } from "@/lib/audienceReport/portfolioBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR, reportContentDisposition } from "@/lib/audienceReport/parseRequest";
import { flattenPortfolioReport } from "@/lib/audienceReport/portfolioFlatten";
import { renderReportPptx } from "@/lib/audienceReport/exportRenderers";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildPortfolioReport(reportRequest);
    const buffer = await renderReportPptx(flattenPortfolioReport(report));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": reportContentDisposition("PORTFOLIO", report.period.label, "pptx"),
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "문서를 생성하지 못했습니다." }, { status: 500 });
  }
}
