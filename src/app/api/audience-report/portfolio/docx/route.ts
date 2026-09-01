// Phase 13(2026-09-01, 사용자 지시 — 종합 보고서도 실제 다운로드 가능한 Word 필요) —
// 포트폴리오 리포트 Word(.docx) 다운로드. 채널별 docx 라우트와 같은 흐름(portfolioFlatten.ts가
// 내용을 단독 결정, 렌더러는 exportRenderers.ts의 FlatReport 기반 함수를 그대로 재사용).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildPortfolioReport } from "@/lib/audienceReport/portfolioBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR, reportContentDisposition } from "@/lib/audienceReport/parseRequest";
import { flattenPortfolioReport } from "@/lib/audienceReport/portfolioFlatten";
import { renderReportDocx } from "@/lib/audienceReport/exportRenderers";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildPortfolioReport(reportRequest);
    const buffer = await renderReportDocx(flattenPortfolioReport(report));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": reportContentDisposition("PORTFOLIO", report.period.label, "docx"),
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "문서를 생성하지 못했습니다." }, { status: 500 });
  }
}
