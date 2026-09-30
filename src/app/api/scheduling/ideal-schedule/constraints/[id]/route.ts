// 필수 편성 수정(PATCH)·삭제(DELETE) — PD 포함 허용. 부분 수정은 기존 값과 합쳐 같은 검증을 다시 거친다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { constraintRowFrom } from "@/lib/idealSchedule/constraintInput";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("요청 본문이 없습니다.");
  try {
    const { data: cur, error } = await supabase.from("ideal_schedule_constraints").select("*").eq("id", id).maybeSingle();
    if (error) return fail(error);
    if (!cur) return NextResponse.json({ ok: false, message: "필수 편성을 찾을 수 없습니다." }, { status: 404 });
    const merged = {
      programId: cur.program_id,
      programName: cur.program_name,
      weekday: cur.weekday,
      startMin: cur.start_min,
      durationMin: cur.duration_min,
      activeFrom: cur.active_from,
      activeTo: cur.active_to,
      constraintType: cur.constraint_type,
      source: cur.source,
      priority: cur.priority,
      locked: cur.locked,
      note: cur.note,
      ...body,
    };
    const row = constraintRowFrom(merged);
    if (typeof row === "string") return bad(row);
    const { data, error: uErr } = await supabase
      .from("ideal_schedule_constraints")
      .update({ ...row, updated_by: auth.actor, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (uErr) return uErr.code === "23505" ? bad("같은 요일·시각·프로그램·시작일의 필수 편성이 이미 있습니다.", 409) : fail(uErr);
    return NextResponse.json({ ok: true, constraint: data });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const { error } = await supabase.from("ideal_schedule_constraints").delete().eq("id", id);
    if (error) return fail(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
