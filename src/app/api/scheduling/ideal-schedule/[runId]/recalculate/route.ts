// [다시 계산] — 원래 실행 파라미터로 새 실행을 만든다. keepOverrides=true면 수동 변경(Swap)·LOCK 블록을
// 최우선(rank 1) 제약으로 유지하고, false면 초기화한다(사용자 선택). 새 실행은 parent_run_id로 연결.
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { runIdealSchedule } from "@/lib/idealSchedule/engineRunner";
import { recalcRequestFrom, saveRun } from "@/lib/idealSchedule/runStore";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { keepOverrides?: unknown } | null;
  const keepOverrides = body?.keepOverrides !== false; // 기본 유지
  try {
    const { req, parentRunId } = await recalcRequestFrom(runId, keepOverrides);
    const out = await runIdealSchedule(req, { signal: request.signal });
    if (out.cancelled) return NextResponse.json({ ok: false, cancelled: true, message: "계산이 취소되어 저장하지 않았습니다. 이전 편성안은 그대로입니다." }, { status: 499 });
    const newRunId = await saveRun(req, out, auth.actor, parentRunId);
    return NextResponse.json({ ok: true, runId: newRunId, keptOverrides: req.extraLocks?.length ?? 0, summary: out.summary, conflicts: out.resolution.conflicts });
  } catch (e) {
    return fail(e);
  }
}
