// 제외 편성 조회·등록 — 종영·방영권 만료·사용 비권장·임시 중단으로 편성표에 넣지 않을 프로그램(사용자 지시 2026-10-06/07). 필수 편성과 같은 권한(PD 포함).
// channelCode가 없으면(전 채널 적용) channel_id를 비워 저장한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const channelCode = new URL(request.url).searchParams.get("channel");
  try {
    let q = supabase.from("ideal_schedule_exclusions").select("*").order("created_at", { ascending: false });
    if (channelCode) {
      const ch = await loadChannelRef(channelCode);
      q = q.or(`channel_id.eq.${ch.id},channel_id.is.null`);
    }
    const { data, error } = await q;
    if (error) return fail(error);
    return NextResponse.json({ ok: true, exclusions: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("요청 본문이 없습니다.");
  const names = (Array.isArray(body.programNames) ? body.programNames : [body.programName])
    .map((n) => (typeof n === "string" ? n.trim() : ""))
    .filter((n) => n.length > 0);
  if (names.length === 0) return bad("제외할 프로그램명을 입력해 주세요.");
  if (names.some((n) => n.length > 80)) return bad("프로그램명이 너무 깁니다(80자 이내).");
  const activeFrom = typeof body.activeFrom === "string" && body.activeFrom ? body.activeFrom : null;
  const activeTo = typeof body.activeTo === "string" && body.activeTo ? body.activeTo : null;
  if ((activeFrom && !DATE.test(activeFrom)) || (activeTo && !DATE.test(activeTo))) return bad("날짜 형식이 올바르지 않습니다.");
  if (activeFrom && activeTo && activeTo < activeFrom) return bad("종료일이 시작일보다 빠릅니다.");
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 200) : null;
  try {
    const channelId = typeof body.channelCode === "string" && body.channelCode ? (await loadChannelRef(body.channelCode)).id : null;
    const rows = names.map((program_name) => ({ channel_id: channelId, program_name, reason, active_from: activeFrom, active_to: activeTo, created_by: auth.actor }));
    const { data, error } = await supabase.from("ideal_schedule_exclusions").insert(rows).select("*");
    if (error) return error.code === "23505" ? bad("이미 같은 제외 항목이 있습니다.", 409) : fail(error);
    return NextResponse.json({ ok: true, exclusions: data });
  } catch (e) {
    return fail(e);
  }
}
