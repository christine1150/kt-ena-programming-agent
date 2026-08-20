// 주요 콘텐츠 개별 항목 수정·삭제 API (관리자 전용).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const update: Record<string, unknown> = {};
  if (typeof body?.category === "string") update.category = body.category.trim();
  if ("scheduleText" in (body ?? {})) update.broadcast_schedule_text = body.scheduleText || null;
  if ("dayOfWeek" in (body ?? {}))
    update.broadcast_day_of_week = Array.isArray(body.dayOfWeek) && body.dayOfWeek.length > 0 ? body.dayOfWeek : null;
  if ("time" in (body ?? {})) update.broadcast_time = body.time || null;
  if ("startDate" in (body ?? {})) update.broadcast_start_date = body.startDate || null;
  if ("endDate" in (body ?? {})) update.broadcast_end_date = body.endDate || null;

  const { error } = await supabase.from("featured_content").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }
  const { id } = await params;

  const { error } = await supabase.from("featured_content").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
