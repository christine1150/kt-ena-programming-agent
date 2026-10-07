// 확정 준비 재검사(OPT06) — 최신 Avail·공유 잔여·회차 길이·필수 편성·동시 수정 상태로 지금 편성안을 다시 본다.
// 읽기 전용 검사다: 권리 예약·원장 기록·편성 저장·운영 반영을 하지 않는다(operationApplied는 항상 false).
// record=true면 검사 결과 요약만 작업본에 남긴다("검토안으로 저장" — 실행 가능이 아니면 그 사실이 함께 남는다).
import { NextResponse } from "next/server";
import { fail, requireActorFor } from "@/lib/idealSchedule/apiUtil";
import { computeReadiness, recordReadiness } from "@/lib/idealSchedule/readinessServer";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActorFor("schedule_finalize");
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { planVersion?: unknown; editSeq?: unknown; record?: unknown } | null;
  try {
    const out = await computeReadiness(runId, { seen: { planVersion: body?.planVersion, editSeq: body?.editSeq } });
    const stored = body?.record === true ? await recordReadiness(runId, out, auth.actor) : null;
    return NextResponse.json({ ok: true, ...out, recorded: stored, operationApplied: false });
  } catch (e) {
    return fail(e);
  }
}
