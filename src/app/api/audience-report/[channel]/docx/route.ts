// N절 Phase 2a(2026-09-01) — Audience Intelligence Report Word(.docx) 다운로드.
// 구 시스템(/api/report/channel/docx)에서 이식하되 구조를 바꿨다: 문서 내용을 이 라우트가
// 직접 조립하지 않고, buildAudienceReport() → flattenAudienceReport() → renderReportDocx()로
// 흐른다. 내용 결정은 reportFlatten.ts 한 곳뿐이라 Word/PPT가 갈라질 수 없다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildAudienceReport } from "@/lib/audienceReport/reportBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR, reportFileName } from "@/lib/audienceReport/parseRequest";
import { flattenAudienceReport } from "@/lib/audienceReport/reportFlatten";
import { renderReportDocx } from "@/lib/audienceReport/exportRenderers";

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { channel } = await params;
  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildAudienceReport(channel, reportRequest);
    const buffer = await renderReportDocx(flattenAudienceReport(report));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${reportFileName(report.channelCode, report.period.label, "docx")}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "문서를 생성하지 못했습니다." }, { status: 500 });
  }
}
