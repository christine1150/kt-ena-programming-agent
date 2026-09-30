// 이상적 1주일 편성 블록 — 대체 후보 조회(GET) / Swap·LOCK(PATCH). PD 포함 허용(사용자 결정 2026-09-30).
// Swap은 저장된 대체 후보(엔진이 같은 자리 기준으로 계산한 값)로만 교체하며 MANUAL_OVERRIDE + LOCK이 된다.
import { NextResponse } from "next/server";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadCandidates, setBlockLock, swapBlock } from "@/lib/idealSchedule/runStore";

type Ctx = { params: Promise<{ runId: string; blockId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId, blockId } = await params;
  try {
    return NextResponse.json({ ok: true, candidates: await loadCandidates(runId, blockId) });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId, blockId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown; candidateId?: unknown; locked?: unknown } | null;
  try {
    if (body?.action === "swap") {
      if (typeof body.candidateId !== "string") return bad("candidateId가 필요합니다.");
      return NextResponse.json({ ok: true, block: await swapBlock(runId, blockId, body.candidateId, auth.actor) });
    }
    if (body?.action === "lock") {
      if (typeof body.locked !== "boolean") return bad("locked(true/false)가 필요합니다.");
      return NextResponse.json({ ok: true, block: await setBlockLock(runId, blockId, body.locked, auth.actor) });
    }
    return bad("action은 swap 또는 lock이어야 합니다.");
  } catch (e) {
    return fail(e);
  }
}
