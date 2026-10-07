// 작업본 되돌리기·다시 실행·재평가(OPT06). 수정 이력은 실행 요약(summary.workingCopy)에 남는다 — 마이그레이션 없음.
//  · undo/redo: 한 단계씩. 화면이 마지막으로 본 editSeq(baseSeq)가 다르면 거부한다(다른 화면에서 바뀜).
//  · reevaluate: 탐색 없이 지금 편성 그대로를 같은 모델로 다시 평가(인접·반복·합계). 다른 칸을 바꾸는 [다시 계산]과 다르다.
import { NextResponse } from "next/server";
import { bad, fail, requireActorFor } from "@/lib/idealSchedule/apiUtil";
import { redoEdit, reevaluateWorkingCopy, undoEdit } from "@/lib/idealSchedule/workingCopy";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActorFor("schedule_edit");
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown; baseSeq?: unknown } | null;
  try {
    if (body?.action === "undo") {
      const r = await undoEdit(runId, auth.actor, { baseSeq: body.baseSeq });
      return NextResponse.json({ ok: true, block: r.block, working: r.working });
    }
    if (body?.action === "redo") {
      const r = await redoEdit(runId, auth.actor, { baseSeq: body.baseSeq });
      return NextResponse.json({ ok: true, block: r.block, working: r.working });
    }
    if (body?.action === "reevaluate") {
      const r = await reevaluateWorkingCopy(runId, { baseSeq: body.baseSeq });
      return NextResponse.json({ ok: true, working: r.working });
    }
    return bad("action은 undo, redo, reevaluate 중 하나여야 합니다.");
  } catch (e) {
    return fail(e);
  }
}
