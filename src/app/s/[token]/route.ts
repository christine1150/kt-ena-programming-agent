// PD 공유 링크 접속 지점. 관리자가 발급한 링크(/s/토큰값)로 들어오면
// 토큰이 유효한지 DB에서 확인하고, 맞으면 PD 세션 쿠키를 심어준 뒤 홈으로 보낸다.
// 틀리거나 재발급으로 무효화된(revoked) 링크면 안내 페이지로 보낸다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { PD_COOKIE_NAME, PD_SESSION_TTL_MS, createSessionToken } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const origin = new URL(request.url).origin;

  const { data: link } = await supabase
    .from("share_links")
    .select("token, is_active")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (!link) {
    return NextResponse.redirect(`${origin}/s/invalid`);
  }

  const sessionToken = await createSessionToken({
    role: "pd",
    exp: Date.now() + PD_SESSION_TTL_MS,
  });

  const response = NextResponse.redirect(`${origin}/`);
  response.cookies.set(PD_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PD_SESSION_TTL_MS / 1000,
  });
  return response;
}
