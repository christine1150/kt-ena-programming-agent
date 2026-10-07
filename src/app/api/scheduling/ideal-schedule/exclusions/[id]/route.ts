// 제외 편성 삭제 — 다시 편성 후보로 쓸 수 있게 되돌린다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const { error } = await supabase.from("ideal_schedule_exclusions").delete().eq("id", id);
    if (error) return fail(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
