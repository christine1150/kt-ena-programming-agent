// 주요 콘텐츠 개별 항목 수정·삭제 API (관리자 전용).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { computeExpectedEndDate } from "@/lib/featuredContentSchedule";

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
  if ("expectedEpisodeCount" in (body ?? {}))
    update.expected_episode_count = body.expectedEpisodeCount ? Number(body.expectedEpisodeCount) : null;

  // 사용자 지시(2026-08-21): 이번 수정으로 첫 방송일자·매주 반복 요일·예상 회차가 전부(이번
  // 요청 값 또는 기존 저장값) 갖춰지면 끝 방송일자를 자동 재계산한다 — 부분 수정(PATCH)이라
  // 현재 저장된 값과 이번 변경값을 합쳐서 계산해야 한다.
  const touchesScheduleFields = "startDate" in (body ?? {}) || "dayOfWeek" in (body ?? {}) || "expectedEpisodeCount" in (body ?? {});
  if (touchesScheduleFields) {
    const { data: current } = await supabase
      .from("featured_content")
      .select("broadcast_start_date, broadcast_day_of_week, expected_episode_count")
      .eq("id", id)
      .maybeSingle();
    const finalStartDate = ("startDate" in (body ?? {}) ? update.broadcast_start_date : current?.broadcast_start_date) as string | null;
    const finalDayOfWeek = ("dayOfWeek" in (body ?? {}) ? update.broadcast_day_of_week : current?.broadcast_day_of_week) as string[] | null;
    const finalEpisodeCount = ("expectedEpisodeCount" in (body ?? {}) ? update.expected_episode_count : current?.expected_episode_count) as
      | number
      | null;
    const autoEndDate = computeExpectedEndDate(finalStartDate, finalDayOfWeek, finalEpisodeCount);
    if (autoEndDate) update.broadcast_end_date = autoEndDate;
  }

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
