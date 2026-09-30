// 필수 편성(금주 필수·수동 필수·고정 슬롯) 조회·등록 — PD 포함 허용(사용자 결정 2026-09-30).
// 주요 콘텐츠 자동 연동분은 여기 저장하지 않는다(featured_content를 실행 시 직접 읽음).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { constraintRowFrom } from "@/lib/idealSchedule/constraintInput";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const channelCode = new URL(request.url).searchParams.get("channel");
  if (!channelCode) return bad("channel이 필요합니다.");
  try {
    const ch = await loadChannelRef(channelCode);
    const { data, error } = await supabase.from("ideal_schedule_constraints").select("*").eq("channel_id", ch.id).order("weekday").order("start_min");
    if (error) return fail(error);
    return NextResponse.json({ ok: true, constraints: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.channelCode !== "string") return bad("channelCode가 필요합니다.");
  const row = constraintRowFrom(body);
  if (typeof row === "string") return bad(row);
  try {
    const ch = await loadChannelRef(body.channelCode);
    const { data, error } = await supabase
      .from("ideal_schedule_constraints")
      .insert({ ...row, channel_id: ch.id, created_by: auth.actor, updated_by: auth.actor })
      .select("*")
      .single();
    if (error) return error.code === "23505" ? bad("같은 요일·시각·프로그램·시작일의 필수 편성이 이미 있습니다.", 409) : fail(error);
    return NextResponse.json({ ok: true, constraint: data });
  } catch (e) {
    return fail(e);
  }
}
