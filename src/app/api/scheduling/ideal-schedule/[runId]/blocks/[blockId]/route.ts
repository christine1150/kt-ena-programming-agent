// 이상적 1주일 편성 블록 — 대체 후보 조회(GET) / Swap·LOCK(PATCH). PD 포함 허용(사용자 결정 2026-09-30).
// Swap은 저장된 대체 후보(엔진이 같은 자리 기준으로 계산한 값)로만 교체하며 MANUAL_OVERRIDE + LOCK이 된다.
// OPT06: 교체도 권리 판정을 거친다(권리상 불가 거부 · 조건부/미확인은 검토안만). 수정은 이력에 남아 실행 취소할 수 있고, 변경 이유를 함께 받는다.
// 권한은 권한표(admin/permissions.ts)의 schedule_edit 한 곳에서 판정한다.
import { NextResponse } from "next/server";
import { bad, fail, requireActor, requireActorFor } from "@/lib/idealSchedule/apiUtil";
import { loadCandidatesWithRights } from "@/lib/idealSchedule/blockCandidates";
import { setLockWithLog, swapWithLog } from "@/lib/idealSchedule/workingCopy";

type Ctx = { params: Promise<{ runId: string; blockId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId, blockId } = await params;
  try {
    const r = await loadCandidatesWithRights(runId, blockId);
    return NextResponse.json({ ok: true, candidates: r.candidates, rights: r.rights });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireActorFor("schedule_edit");
  if (auth instanceof NextResponse) return auth;
  const { runId, blockId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown; candidateId?: unknown; locked?: unknown; reason?: unknown; baseSeq?: unknown } | null;
  try {
    if (body?.action === "swap") {
      if (typeof body.candidateId !== "string") return bad("candidateId가 필요합니다.");
      const r = await swapWithLog(runId, blockId, body.candidateId, auth.actor, { reason: body.reason, baseSeq: body.baseSeq });
      return NextResponse.json({ ok: true, block: r.block, working: r.working, rights: r.rights });
    }
    if (body?.action === "lock") {
      if (typeof body.locked !== "boolean") return bad("locked(true/false)가 필요합니다.");
      const r = await setLockWithLog(runId, blockId, body.locked, auth.actor, { baseSeq: body.baseSeq });
      return NextResponse.json({ ok: true, block: r.block, working: r.working });
    }
    return bad("action은 swap 또는 lock이어야 합니다.");
  } catch (e) {
    return fail(e);
  }
}
