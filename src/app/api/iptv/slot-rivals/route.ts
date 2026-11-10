// 시간대 경쟁 지도(D1) 조회 API(IPTV 활용 3단계 6순위, 2026-11-11). 계산은 DB 함수 iptv_slot_rivals. 조회만 한다.
// ?channel=ENA(닐슨 채널 코드) &to=YYYY-MM-DD(없으면 IPTV 마지막 날짜). IPTV 는 보조 자료 — 점유율이 아니다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { loadSlotRivals } from "@/lib/iptvSlotMap";
import { IPTV_NAME_BY_CODE } from "@/lib/iptvSlotMapText";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const channel = (searchParams.get("channel") ?? "").toUpperCase();
  const to = searchParams.get("to");
  if (!IPTV_NAME_BY_CODE[channel]) return NextResponse.json({ ok: false, message: "channel 은 자사 채널 코드여야 합니다." }, { status: 400 });
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ ok: false, message: "to는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  try {
    const map = await loadSlotRivals(supabase, { channelCode: channel, to });
    return NextResponse.json({ ok: true, map }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
