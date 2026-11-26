// 라인업 외부 이벤트 한 건 — 변경 이력(GET)·수정·보관(PATCH). 권한: 읽기 view, 쓰기 lineup_edit(관리자만).
import { NextResponse } from "next/server";
import { requireActorFor, bad, fail } from "@/lib/idealSchedule/apiUtil";
import { parseEventInput } from "@/lib/lineup/events";
import { eventsSchemaExtended, listChanges, patchEvent } from "@/lib/lineup/repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActorFor("view");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return bad("이벤트 id가 올바르지 않습니다.");
  try {
    return NextResponse.json({ ok: true, changes: await listChanges({ entityId: id, limit: 10 }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActorFor("lineup_edit");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return bad("이벤트 id가 올바르지 않습니다.");
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const archived = typeof body.archived === "boolean" ? body.archived : undefined;
    // 보관만 하는 요청(필드 없이 archived만)은 입력 검사를 건너뛴다
    const onlyArchive = archived !== undefined && body.name === undefined;
    let value = null;
    if (!onlyArchive) {
      const parsed = parseEventInput(body, await eventsSchemaExtended());
      if (!parsed.ok) return bad(parsed.message);
      value = parsed.value;
    }
    return NextResponse.json(await patchEvent(id, value, archived, auth.actor));
  } catch (e) {
    return fail(e);
  }
}
