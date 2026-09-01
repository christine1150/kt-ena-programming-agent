// Phase 13(2026-09-01, 사용자 지시 — "PPT 아이콘 클릭 시 6-슬라이드 임원 보고용 PPT") —
// 채널별 Executive Deck 조립 API. 쿼리 파라미터 규약은 /api/audience-report/[channel]과 동일
// (parseRequest.ts 재사용) — 화면과 문서가 다른 기간을 보여주는 사고를 원천 차단.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildAudienceReport } from "@/lib/audienceReport/reportBuilder";
import { buildChannelExecutiveDeck } from "@/lib/audienceReport/deckBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR } from "@/lib/audienceReport/parseRequest";

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { channel } = await params;
  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildAudienceReport(channel, reportRequest);
    const deck = await buildChannelExecutiveDeck(report);
    return NextResponse.json({ ok: true, deck });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "PPT 보고서를 생성하지 못했습니다." }, { status: 500 });
  }
}
