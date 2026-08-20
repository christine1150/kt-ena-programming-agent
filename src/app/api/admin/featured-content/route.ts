// 주요 콘텐츠(featured_content) 목록 조회 · 수동 등록 API (관리자 전용).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("featured_content")
    .select(
      "id, category, broadcast_schedule_text, broadcast_day_of_week, broadcast_time, broadcast_start_date, broadcast_end_date, programs(id, canonical_name, channel_id, channels(code, name))"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: data });
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const channelId = body?.channelId;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";

  if (!channelId || !title || !category) {
    return NextResponse.json(
      { ok: false, message: "채널·타이틀·분류는 반드시 입력해야 합니다." },
      { status: 400 }
    );
  }

  const { data: program, error: programError } = await supabase
    .from("programs")
    .upsert(
      {
        channel_id: channelId,
        canonical_name: title,
        raw_name: title,
        episode_number: body?.episodeCount ?? null,
      },
      { onConflict: "channel_id,canonical_name" }
    )
    .select("id")
    .single();

  if (programError || !program) {
    return NextResponse.json(
      { ok: false, message: `프로그램 저장 실패 — ${programError?.message}` },
      { status: 500 }
    );
  }

  const { error: featuredError } = await supabase.from("featured_content").upsert(
    {
      program_id: program.id,
      category,
      broadcast_schedule_text: body?.scheduleText || null,
      broadcast_day_of_week: Array.isArray(body?.dayOfWeek) && body.dayOfWeek.length > 0 ? body.dayOfWeek : null,
      broadcast_time: body?.time || null,
      broadcast_start_date: body?.startDate || null,
      broadcast_end_date: body?.endDate || null,
    },
    { onConflict: "program_id" }
  );

  if (featuredError) {
    return NextResponse.json(
      { ok: false, message: `주요 콘텐츠 저장 실패 — ${featuredError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
