// skyUHD·UHD 벤치마크(D3) 조회 API(IPTV 활용 3단계 6순위, 2026-11-11). 계산은 DB 함수 iptv_uhd_benchmark. 조회만 한다.
// ?to=YYYY-MM-DD(없으면 IPTV 마지막 날짜). IPTV 는 보조 자료 — 가구 기준만 있다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { loadUhdBenchmark } from "@/lib/iptvSlotMap";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const to = new URL(request.url).searchParams.get("to");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ ok: false, message: "to는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  try {
    const benchmark = await loadUhdBenchmark(supabase, { to });
    return NextResponse.json({ ok: true, benchmark }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
