// Tier 3(2026-08-26, 원 제안 11번 "AI 가설" 별도 섹션 — 화면 제목 "AI 편성 비서 - 스마트
// 편성 팁"). ChannelDeepDive.tsx가 이미 화면에 표시 중인(=이미 DB에서 검증된) 값들을 그대로
// 넘겨받아 OpenAI로 한 번 더 종합할 뿐, 이 라우트는 DB를 직접 조회하지 않는다(중복 쿼리 방지
// — 클라이언트가 /api/dashboard/channel에서 이미 받아둔 값 재사용).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { generateSmartProgrammingTips, type SmartTipsInput } from "@/lib/smartProgrammingTips";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  let input: SmartTipsInput;
  try {
    const body = await request.json();
    if (!body || typeof body.channelName !== "string") {
      return NextResponse.json({ ok: false, message: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    input = {
      channelName: body.channelName,
      rootCauseTriggered: Boolean(body.rootCauseTriggered),
      rootCauseStreakDays: typeof body.rootCauseStreakDays === "number" ? body.rootCauseStreakDays : null,
      rootCauseCompetitorMoves: Array.isArray(body.rootCauseCompetitorMoves) ? body.rootCauseCompetitorMoves : [],
      opportunityTriggered: Boolean(body.opportunityTriggered),
      opportunityChangePct: typeof body.opportunityChangePct === "number" ? body.opportunityChangePct : null,
      weakCompetitors: Array.isArray(body.weakCompetitors) ? body.weakCompetitors : [],
      daypartOpportunities: Array.isArray(body.daypartOpportunities) ? body.daypartOpportunities : [],
      hourBlockOpportunities: Array.isArray(body.hourBlockOpportunities) ? body.hourBlockOpportunities : [],
      topPrograms: Array.isArray(body.topPrograms) ? body.topPrograms : [],
      periodProgramMovers: Array.isArray(body.periodProgramMovers) ? body.periodProgramMovers : [],
      fitScoreCandidates: Array.isArray(body.fitScoreCandidates) ? body.fitScoreCandidates : [],
    };
  } catch {
    return NextResponse.json({ ok: false, message: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const tips = await generateSmartProgrammingTips(input);
  if (tips === null) {
    return NextResponse.json({ ok: false, message: "AI 팁 생성에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, tips });
}
