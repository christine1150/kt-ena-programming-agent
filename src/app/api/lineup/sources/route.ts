// 라인업 자료(업로드·직접 수정) 목록과 최근 변경 이력 — 자료 관리 화면용. 권한 lineup_edit(관리자만).
import { NextResponse } from "next/server";
import { requireActorFor } from "@/lib/idealSchedule/apiUtil";
import { lineupFail } from "@/lib/lineup/apiGuard";
import { listChanges, listSources } from "@/lib/lineup/repo";

export async function GET() {
  const auth = await requireActorFor("lineup_edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const [sources, changes] = await Promise.all([listSources(40), listChanges({ limit: 60 })]);
    return NextResponse.json({ ok: true, sources, changes }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return lineupFail(e);
  }
}
