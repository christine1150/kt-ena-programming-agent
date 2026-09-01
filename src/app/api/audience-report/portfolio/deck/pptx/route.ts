// Phase 13(2026-09-01) — 종합(포트폴리오) Executive Deck 실제 PPT(.pptx) 다운로드.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildPortfolioReport } from "@/lib/audienceReport/portfolioBuilder";
import { buildPortfolioExecutiveDeck } from "@/lib/audienceReport/deckBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR, reportContentDisposition } from "@/lib/audienceReport/parseRequest";
import { renderDeckPptx } from "@/lib/audienceReport/exportRenderers";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildPortfolioReport(reportRequest);
    const deck = await buildPortfolioExecutiveDeck(report);
    const buffer = await renderDeckPptx(deck);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": reportContentDisposition("PORTFOLIO", `${report.period.label}_PPT`, "pptx"),
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "PPT를 생성하지 못했습니다." }, { status: 500 });
  }
}
