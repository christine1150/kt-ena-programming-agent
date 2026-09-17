// 종합(포트폴리오) 리포트 상세 PPT(.pptx) 다운로드 — 7채널 비교 분석 전체를 표 위주로 옮긴다.
// 2026-09-17 — 미리보기(/audience-report/portfolio/deck)가 이 파일과 같은 FlatReport·같은
// 슬라이드 계획(pptSlidePlan.ts)을 그리므로, 화면과 받은 파일의 내용이 같다.
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
