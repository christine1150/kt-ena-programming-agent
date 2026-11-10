// 구매 검토 "다른 채널 IPTV 성적" 조회 API(IPTV 활용 3단계 5순위, 2026-11-11). 계산은 DB 함수 iptv_peer_record. 조회만 한다.
// ?name=작품명(여러 개 가능) &to=YYYY-MM-DD(없으면 IPTV 마지막 날짜). IPTV 는 보조 자료 — 닐슨 예측과 섞지 않는다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { loadIptvPeerRecord } from "@/lib/iptvPeerRecord";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const names = searchParams.getAll("name").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const to = searchParams.get("to");
  if (names.length === 0) return NextResponse.json({ ok: false, message: "name 파라미터가 필요합니다." }, { status: 400 });
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ ok: false, message: "to는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  try {
    const record = await loadIptvPeerRecord(supabase, { names, to });
    return NextResponse.json({ ok: true, record }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
