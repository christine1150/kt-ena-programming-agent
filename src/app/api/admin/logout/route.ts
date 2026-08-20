// 관리자 로그아웃 API — 세션 쿠키를 지운다.
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
