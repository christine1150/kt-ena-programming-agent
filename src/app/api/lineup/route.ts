// 라인업 조회 API — 로그인 사용자 전부(사용자 결정 2026-11-24: 타사 상세도 로그인 사용자에게 보임).
// 라인업은 대외비: 응답은 캐시하지 않고, LLM 경로로 보내지 않는다. 그리기 값(자리 점유 끝·맞대결·빈 주)은 서버가 계산한다.
import { NextResponse } from "next/server";
import { requireActorFor, bad } from "@/lib/idealSchedule/apiUtil";
import { lineupFail } from "@/lib/lineup/apiGuard";
import { getCurrentSession } from "@/lib/adminAuth";
import { can, roleOfSession } from "@/lib/admin/permissions";
import { daysBetween, isIsoDate } from "@/lib/lineup/dates";
import { loadLineup } from "@/lib/lineup/repo";
import { kstToday } from "@/lib/workspace/dates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireActorFor("view");
  if (auth instanceof NextResponse) return auth;
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isIsoDate(from) || !isIsoDate(to)) return bad("기간(from·to, YYYY-MM-DD)을 주세요.");
  const span = daysBetween(from, to);
  if (span < 0 || span > 800) return bad("기간은 0~800일 사이여야 합니다.");
  try {
    const session = await getCurrentSession();
    const payload = await loadLineup(from, to, kstToday(), can(roleOfSession(session), "lineup_edit"));
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return lineupFail(e);
  }
}
