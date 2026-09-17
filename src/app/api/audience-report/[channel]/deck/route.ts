// 2026-09-17(사용자 지시 — "P를 누르면 Powerpoint 상세버전 미리보기") — 채널별 상세 PPT
// 미리보기 payload. 예전에는 6~9장짜리 임원 요약 덱(deckBuilder.ts)을 돌려줘서 미리보기와
// 실제 다운로드(.pptx)가 서로 다른 문서였다 — 지금은 다운로드와 **같은 FlatReport·같은 슬라이드
// 계획**을 그대로 돌려준다(/api/audience-report/[channel]/pptx와 동일한 입력).
// 쿼리 파라미터 규약은 /api/audience-report/[channel]과 동일(parseRequest.ts 재사용).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildAudienceReport } from "@/lib/audienceReport/reportBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR } from "@/lib/audienceReport/parseRequest";
import { flattenAudienceReport } from "@/lib/audienceReport/reportFlatten";
import { buildPptPreviewPayload } from "@/lib/audienceReport/pptSlidePlan";

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { channel } = await params;
  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });

  try {
    const report = await buildAudienceReport(channel, reportRequest);
    return NextResponse.json({ ok: true, preview: buildPptPreviewPayload(flattenAudienceReport(report)) });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "PPT 미리보기를 생성하지 못했습니다." }, { status: 500 });
  }
}
