// 2026-09-17 — 종합(포트폴리오) 상세 PPT 미리보기 payload. 채널별 버전과 동일한 규약,
// 채널 파라미터만 없다(7개 채널을 한 번에 다룬다, portfolioBuilder.ts 재사용).
// 다운로드(/api/audience-report/portfolio/pptx)와 같은 FlatReport·같은 슬라이드 계획을 돌려준다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildPortfolioReport } from "@/lib/audienceReport/portfolioBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR } from "@/lib/audienceReport/parseRequest";
import { flattenPortfolioReport } from "@/lib/audienceReport/portfolioFlatten";
import { buildPptPreviewPayload } from "@/lib/audienceReport/pptSlidePlan";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildPortfolioReport(reportRequest);
    return NextResponse.json({ ok: true, preview: buildPptPreviewPayload(flattenPortfolioReport(report)) });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "PPT 미리보기를 생성하지 못했습니다." }, { status: 500 });
  }
}
