// Phase 6(2026-08-28, 계획서 J절 §11-9) — Audience Intelligence Report 조립 API. 구 시스템
// (/api/report/channel)과 완전히 분리(1·2페이지 형식을 따르지 않는다는 사용자 지시 그대로) —
// 이 라우트는 audienceReport/reportBuilder.ts만 호출한다.
//
// 쿼리 파라미터 해석은 parseRequest.ts에 단일화돼 있다(2026-09-01, N절 Phase 2a) — JSON·Word·
// PPT 세 라우트가 같은 규칙을 각자 복사해 갖다가 한쪽만 고쳐져 갈라지는 것을 막기 위함.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildAudienceReport } from "@/lib/audienceReport/reportBuilder";
import { parseAudienceReportRequest, AUDIENCE_REPORT_PARAM_ERROR } from "@/lib/audienceReport/parseRequest";

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { channel } = await params;
  const reportRequest = parseAudienceReportRequest(new URL(request.url).searchParams);
  if (!reportRequest) {
    return NextResponse.json({ ok: false, message: AUDIENCE_REPORT_PARAM_ERROR }, { status: 400 });
  }

  try {
    const report = await buildAudienceReport(channel, reportRequest);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "리포트를 생성하지 못했습니다." }, { status: 500 });
  }
}
