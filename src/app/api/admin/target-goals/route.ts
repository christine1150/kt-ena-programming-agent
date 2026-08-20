// 목표 시청률 관리 API (관리자 전용). 실제 업로드 파일 형식이 아직 없어서(현재는
// 채널기본정보.xlsx의 "채널 별 경쟁채널" 시트로 2026년 목표가 들어옴), 이후 연도의 목표는
// 관리자가 화면에서 직접 입력/수정하도록 만들었다 — 존재하지 않는 파일 형식을 추측해서
// 파서를 만들지 않는다는 원칙(CLAUDE.md) 때문.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { checkPercentValue } from "@/lib/dataQuality";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()), 10);

  const { data: channels, error: channelsError } = await supabase
    .from("channels")
    .select("id, code, name, primary_target")
    .order("code");
  if (channelsError) {
    return NextResponse.json({ ok: false, message: channelsError.message }, { status: 500 });
  }

  const { data: goals, error: goalsError } = await supabase
    .from("target_goals")
    .select("channel_id, target_rank, target_rating")
    .eq("year", year);
  if (goalsError) {
    return NextResponse.json({ ok: false, message: goalsError.message }, { status: 500 });
  }

  const goalByChannelId = new Map(goals?.map((g) => [g.channel_id, g]));
  const rows = channels.map((c) => ({
    channelId: c.id,
    code: c.code,
    name: c.name,
    primaryTarget: c.primary_target,
    targetRank: goalByChannelId.get(c.id)?.target_rank ?? null,
    targetRating: goalByChannelId.get(c.id)?.target_rating ?? null,
  }));

  return NextResponse.json({ ok: true, year, rows });
}

export async function PUT(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const channelId = body?.channelId;
  const year = body?.year;
  const targetRank = body?.targetRank ?? null;
  const targetRating = body?.targetRating;

  if (!channelId || !year || typeof targetRating !== "number") {
    return NextResponse.json(
      { ok: false, message: "channelId, year, targetRating(숫자)가 필요합니다." },
      { status: 400 }
    );
  }

  const issue = checkPercentValue(targetRating, "목표 시청률", `channelId=${channelId}`);
  if (issue) {
    return NextResponse.json({ ok: false, message: issue.message }, { status: 422 });
  }

  const { error } = await supabase
    .from("target_goals")
    .upsert(
      { channel_id: channelId, year, target_rank: targetRank || null, target_rating: targetRating },
      { onConflict: "channel_id,year" }
    );

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
