// 라인업 구간 한 건 고치기·보관·되살리기(상세 패널) — 권한 lineup_edit(관리자만, 사용자 결정 2026-11-24).
// 변경 이력은 DB 트리거가 남기고, 수정 한 번을 'manual' 자료로 기록해 업로드 되돌리기가 사람이 고친 값을 건드리지 않게 한다.
import { NextResponse } from "next/server";
import { requireActorFor, bad, fail } from "@/lib/idealSchedule/apiUtil";
import { isIsoDate } from "@/lib/lineup/dates";
import { splitNames } from "@/lib/lineup/titles";
import { listChanges, patchRun, type RunPatch } from "@/lib/lineup/repo";

const STATUSES = new Set(["confirmed", "planned", "tentative"]);
const GENRES = new Set(["drama", "variety", "business", "other"]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActorFor("view");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
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
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: RunPatch = {};
    if (typeof body.title === "string") patch.title = body.title.slice(0, 200);
    if (body.shortTitle === null || typeof body.shortTitle === "string") patch.shortTitle = (body.shortTitle as string | null)?.slice(0, 60) ?? null;
    if (typeof body.tentative === "boolean") patch.tentative = body.tentative;
    if (typeof body.genre === "string") {
      if (!GENRES.has(body.genre)) return bad("장르 값이 올바르지 않습니다.");
      patch.genre = body.genre as RunPatch["genre"];
    }
    if (typeof body.status === "string") {
      if (!STATUSES.has(body.status)) return bad("상태 값이 올바르지 않습니다.");
      patch.status = body.status as RunPatch["status"];
    }
    for (const k of ["startDate", "endDate"] as const) {
      if (body[k] === null || body[k] === "") patch[k] = null;
      else if (body[k] !== undefined) {
        if (!isIsoDate(body[k])) return bad("날짜는 YYYY-MM-DD로 넣어 주세요.");
        patch[k] = body[k] as string;
      }
    }
    if (body.episodes === null || body.episodes === "") patch.episodes = null;
    else if (body.episodes !== undefined) {
      const n = Number(body.episodes);
      if (!Number.isInteger(n) || n <= 0 || n > 999) return bad("회차는 1~999 사이 정수로 넣어 주세요.");
      patch.episodes = n;
    }
    if (typeof body.cast === "string") patch.cast = splitNames(body.cast);
    if (body.logline === null || typeof body.logline === "string") patch.logline = (body.logline as string | null)?.slice(0, 1000) ?? null;
    if (body.note === null || typeof body.note === "string") patch.note = (body.note as string | null)?.slice(0, 500) || null;
    if (typeof body.archived === "boolean") patch.archived = body.archived;
    if (typeof body.needsReview === "boolean") patch.needsReview = body.needsReview;
    return NextResponse.json(await patchRun(id, patch, auth.actor));
  } catch (e) {
    return fail(e);
  }
}
