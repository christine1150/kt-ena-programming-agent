// Phase 13(2026-09-01) — 채널별 Executive Deck 실제 PPT(.pptx) 다운로드.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildAudienceReport } from "@/lib/audienceReport/reportBuilder";
import { buildChannelExecutiveDeck } from "@/lib/audienceReport/deckBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR, reportContentDisposition } from "@/lib/audienceReport/parseRequest";
import { renderDeckPptx } from "@/lib/audienceReport/exportRenderers";

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { channel } = await params;
  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildAudienceReport(channel, reportRequest);
    const deck = await buildChannelExecutiveDeck(report);
    const buffer = await renderDeckPptx(deck);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": reportContentDisposition(report.channelCode, `${report.period.label}_PPT`, "pptx"),
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "PPT를 생성하지 못했습니다." }, { status: 500 });
  }
}
