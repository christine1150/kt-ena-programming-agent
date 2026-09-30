// 대체 후보 직접 추가 — GET ?q= 이 채널 프로그램 검색 / POST {programId} 그 자리에서 엔진과 같은 방식으로 평가해 후보로 저장.
import { NextResponse } from "next/server";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { addManualCandidate, searchChannelPrograms } from "@/lib/idealSchedule/manualCandidate";

export const maxDuration = 60;

type Ctx = { params: Promise<{ runId: string; blockId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId, blockId } = await params;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ ok: true, programs: [] });
  try {
    return NextResponse.json({ ok: true, programs: await searchChannelPrograms(runId, blockId, q) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId, blockId } = await params;
  const body = (await request.json().catch(() => null)) as { programId?: unknown } | null;
  if (typeof body?.programId !== "string") return bad("programId가 필요합니다.");
  try {
    return NextResponse.json({ ok: true, candidate: await addManualCandidate(runId, blockId, body.programId) });
  } catch (e) {
    return fail(e);
  }
}
