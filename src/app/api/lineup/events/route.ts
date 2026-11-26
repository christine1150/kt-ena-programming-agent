// 라인업 외부 이벤트 등록(2026-11-26 리디자인) — 권한 lineup_edit(관리자만, 라인업 편집과 같은 권한).
// 공휴일은 public_holidays(읽기 전용)라 여기서 만들지 않는다. 확장 항목은 마이그레이션 승인 전에는 저장되지 않고 응답의 dropped로 알린다.
import { NextResponse } from "next/server";
import { requireActorFor, bad } from "@/lib/idealSchedule/apiUtil";
import { lineupFail, rejectCrossSite } from "@/lib/lineup/apiGuard";
import { parseEventInput } from "@/lib/lineup/events";
import { createEvent, eventsSchemaExtended } from "@/lib/lineup/repo";

export async function POST(request: Request) {
  const auth = await requireActorFor("lineup_edit");
  if (auth instanceof NextResponse) return auth;
  const cross = rejectCrossSite(request);
  if (cross) return cross;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseEventInput(body, await eventsSchemaExtended());
    if (!parsed.ok) return bad(parsed.message);
    return NextResponse.json(await createEvent(parsed.value, auth.actor));
  } catch (e) {
    return lineupFail(e);
  }
}
