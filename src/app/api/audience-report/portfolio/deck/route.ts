// Phase 13(2026-09-01) — 종합(포트폴리오) Executive Deck 조립 API. 채널별 버전과 동일한 규약,
// 채널 파라미터만 없다(7개 채널을 한 번에 다룬다, portfolioBuilder.ts 재사용).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildPortfolioReport } from "@/lib/audienceReport/portfolioBuilder";
import { buildPortfolioExecutiveDeck } from "@/lib/audienceReport/deckBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR } from "@/lib/audienceReport/parseRequest";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildPortfolioReport(reportRequest);
    const deck = await buildPortfolioExecutiveDeck(report);
    return NextResponse.json({ ok: true, deck });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "PPT 보고서를 생성하지 못했습니다." }, { status: 500 });
  }
}
