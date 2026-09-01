// N절 Phase 2a(2026-09-01) — Audience Intelligence Report PPT(.pptx) 다운로드.
// docx 라우트와 완전히 같은 흐름을 타고 렌더러만 다르다(reportFlatten.ts가 내용을 단독 결정).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildAudienceReport } from "@/lib/audienceReport/reportBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR, reportContentDisposition } from "@/lib/audienceReport/parseRequest";
import { flattenAudienceReport } from "@/lib/audienceReport/reportFlatten";
import { renderReportPptx } from "@/lib/audienceReport/exportRenderers";

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { channel } = await params;
  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildAudienceReport(channel, reportRequest);
    const buffer = await renderReportPptx(flattenAudienceReport(report));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": reportContentDisposition(report.channelCode, report.period.label, "pptx"),
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "문서를 생성하지 못했습니다." }, { status: 500 });
  }
}
