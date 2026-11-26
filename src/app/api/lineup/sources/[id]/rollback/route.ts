// 라인업 업로드 한 번 되돌리기 — 그 자료로 생긴 구간은 보관, 바뀐 구간은 바뀌기 전 값으로. 권한 lineup_edit(관리자만).
import { NextResponse } from "next/server";
import { requireActorFor } from "@/lib/idealSchedule/apiUtil";
import { isUuid, lineupFail, rejectCrossSite } from "@/lib/lineup/apiGuard";
import { rollbackSource } from "@/lib/lineup/repo";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActorFor("lineup_edit");
  if (auth instanceof NextResponse) return auth;
  const cross = rejectCrossSite(request);
  if (cross) return cross;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ ok: false, message: "잘못된 id입니다." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await rollbackSource(id, auth.actor)) });
  } catch (e) {
    return lineupFail(e);
  }
}
