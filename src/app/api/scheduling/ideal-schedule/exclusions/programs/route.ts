// 제외 편성 입력용 프로그램 이름 검색 — 이 채널의 프로그램 중 이름에 검색어가 들어간 것(공백·부호 무시). 입력 칸 자동완성에만 쓴다(읽기 전용).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  const q = (params.get("q") ?? "").trim();
  if (!channelCode) return bad("channel이 필요합니다.");
  if (q.length < 1) return NextResponse.json({ ok: true, programs: [] });
  try {
    const ch = await loadChannelRef(channelCode);
    const key = normalizeProgramCanonicalName(q).replace(/[%_,()]/g, "");
    if (!key) return NextResponse.json({ ok: true, programs: [] });
    const { data, error } = await supabase.from("programs").select("canonical_name").eq("channel_id", ch.id).ilike("canonical_name", `%${key}%`).order("canonical_name").limit(15);
    if (error) return fail(error);
    const names = [...new Set((data ?? []).map((p) => p.canonical_name as string))];
    return NextResponse.json({ ok: true, programs: names });
  } catch (e) {
    return fail(e);
  }
}
