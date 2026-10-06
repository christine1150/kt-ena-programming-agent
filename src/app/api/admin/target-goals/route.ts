// 목표 시청률 관리 API (관리자 전용). 실제 업로드 파일 형식이 아직 없어서(현재는
// 채널기본정보.xlsx의 "채널 별 경쟁채널" 시트로 2026년 목표가 들어옴), 이후 연도의 목표는
// 관리자가 화면에서 직접 입력/수정하도록 만들었다 — 존재하지 않는 파일 형식을 추측해서
// 파서를 만들지 않는다는 원칙(CLAUDE.md) 때문.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { checkPercentValue } from "@/lib/dataQuality";
import { getActiveLock, releaseLock, setManualLock } from "@/lib/admin/lockStore";

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
  // 단계 05: 수동 잠금 상태(잠금 테이블이 없으면 lockAvailable=false)
  const lockInfo = await Promise.all(channels.map(async (c) => [c.code as string, await getActiveLock("target_goal", `${c.code}:${year}`)] as const));
  const lockByCode = new Map(lockInfo);
  const rows = channels.map((c) => ({
    locked: !!lockByCode.get(c.code)?.lock,
    lockedBy: lockByCode.get(c.code)?.lock?.lockedBy ?? null,
    lockedAt: lockByCode.get(c.code)?.lock?.lockedAt ?? null,
    lockReason: lockByCode.get(c.code)?.lock?.reason ?? null,
    channelId: c.id,
    code: c.code,
    name: c.name,
    primaryTarget: c.primary_target,
    targetRank: goalByChannelId.get(c.id)?.target_rank ?? null,
    targetRating: goalByChannelId.get(c.id)?.target_rating ?? null,
  }));

  return NextResponse.json({ ok: true, year, rows, lockAvailable: lockInfo.some(([, l]) => l.available) });
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

  // 단계 05: 화면에서 직접 입력한 목표는 수동 잠금으로 남겨 Channel Master 재업로드가 덮지 못하게 한다(변경자·근거·적용일 기록).
  const { data: ch } = await supabase.from("channels").select("code").eq("id", channelId).maybeSingle();
  const locked = ch?.code
    ? await setManualLock({ field: "target_goal", key: `${ch.code}:${year}`, value: { target_rank: targetRank || null, target_rating: targetRating }, actor: admin.email, reason: typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "관리자 화면에서 직접 입력", effectiveFrom: `${year}-01-01` })
    : false;

  return NextResponse.json({ ok: true, locked });
}

// 수동 잠금 해제(관리자 전용): 해제하면 이후 Channel Master 파일 업로드가 이 목표를 다시 덮어쓸 수 있다. 값 자체는 바꾸지 않는다.
export async function DELETE(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const year = parseInt(searchParams.get("year") ?? "", 10);
  if (!channelId || Number.isNaN(year)) {
    return NextResponse.json({ ok: false, message: "channelId와 year가 필요합니다." }, { status: 400 });
  }
  const { data: ch } = await supabase.from("channels").select("code").eq("id", channelId).maybeSingle();
  if (!ch?.code) return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  const released = await releaseLock({ field: "target_goal", key: `${ch.code}:${year}`, actor: admin.email, reason: "관리자 화면에서 잠금 해제" });
  if (!released) return NextResponse.json({ ok: false, message: "해제할 수동 잠금이 없습니다(또는 잠금 테이블 미적용)." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
