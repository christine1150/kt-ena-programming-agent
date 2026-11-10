// IPTV 셋톱 시리즈 회차 흐름 분포(예측 오차 범위 설명의 보조 근거, IPTV 활용 3단계 4순위 2026-11-11). 최신 버전만 돌려준다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { loadLifecycleTable } from "@/lib/iptvLifecycle";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const table = await loadLifecycleTable(supabase);
    return NextResponse.json({ ok: true, table }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
