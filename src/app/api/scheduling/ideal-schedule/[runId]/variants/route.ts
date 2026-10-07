// 편성안 비교 카드(기준안·최소변경·균형·성과우선) + 주요 변경 5건(OPT06). 조회·계산뿐 — 권리 예약·편성 저장 없음.
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { computeVariants } from "@/lib/idealSchedule/variantsServer";

export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  try {
    return NextResponse.json({ ok: true, ...(await computeVariants(runId)) });
  } catch (e) {
    return fail(e);
  }
}
