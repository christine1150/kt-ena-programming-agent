// 이상적 1주일 편성 실행 조회(GET: 실행·IDEAL/CURRENT 블록) / 저장(PATCH: 이름 붙여 편성안으로 저장).
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadRun, saveRunAs } from "@/lib/idealSchedule/runStore";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  try {
    const loaded = await loadRun(runId);
    if (!loaded) return NextResponse.json({ ok: false, message: "실행을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, run: loaded.run, blocks: loaded.blocks });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 100) : null;
  try {
    const saved = await saveRunAs(runId, title, auth.actor);
    if (!saved) return NextResponse.json({ ok: false, message: "실행을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    return fail(e);
  }
}
