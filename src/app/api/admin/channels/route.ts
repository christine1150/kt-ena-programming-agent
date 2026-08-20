// 채널 목록 조회 API (관리자 전용) — 주요 콘텐츠 등록 화면의 채널 선택 드롭다운에 사용.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase.from("channels").select("id, code, name").order("code");
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, channels: data });
}
