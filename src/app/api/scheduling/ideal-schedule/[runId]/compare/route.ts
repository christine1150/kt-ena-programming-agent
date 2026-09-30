// 현재 편성(CURRENT) vs 이상적 편성(IDEAL) 대조 — 둘 다 같은 모델로 계산해 저장된 값의 차이만 돌려준다.
// 이상적 편성의 기대값은 실제 미래 시청률이 아니라 "최근 12주 데이터 기반 기대 시청률"이다.
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { buildComparison, loadRun } from "@/lib/idealSchedule/runStore";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  try {
    const loaded = await loadRun(runId);
    if (!loaded) return NextResponse.json({ ok: false, message: "실행을 찾을 수 없습니다." }, { status: 404 });
    const run = loaded.run as { summary: Record<string, unknown>; current_week_start: string | null };
    return NextResponse.json({
      ok: true,
      currentWeekStart: run.current_week_start,
      totals: {
        ideal: { expectedAvgRating: run.summary.expectedAvgRating, expectedAvgShare: run.summary.expectedAvgShare, expectedAvgTimeSpent: run.summary.expectedAvgTimeSpent },
        current: run.summary.current ?? null,
      },
      rows: buildComparison(loaded.blocks as Record<string, unknown>[]),
      note: "기대값은 최근 12주 데이터 기반 기대 시청률(실제 미래 시청률 아님)",
    });
  } catch (e) {
    return fail(e);
  }
}
