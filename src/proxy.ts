// 모든 화면 접근을 여기서 한 번 걸러준다.
// - /admin/* (로그인 화면 제외): 관리자 세션이 없으면 로그인 화면으로 돌려보낸다.
// - 그 외 일반 화면: 관리자 세션이든 PD 세션이든 하나는 있어야 하고,
//   둘 다 없으면 "/access-denied"로 돌려보낸다 (회원가입 없음 — PRD 원칙).
// (Next.js 16부터 이 역할의 파일명이 middleware.ts → proxy.ts로 바뀌었다)
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, PD_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const adminSession = await verifySessionToken(request.cookies.get(ADMIN_COOKIE_NAME)?.value);
  const isAdmin = adminSession?.role === "admin";

  if (pathname.startsWith("/admin")) {
    if (!isAdmin) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  const pdSession = await verifySessionToken(request.cookies.get(PD_COOKIE_NAME)?.value);
  const isPd = pdSession?.role === "pd";

  if (!isAdmin && !isPd) {
    return NextResponse.redirect(new URL("/access-denied", request.url));
  }

  return NextResponse.next();
}

// 아래 경로들은 로그인/공유 링크 확인 없이도 열려야 하므로 대상에서 제외한다:
// _next 정적 파일, favicon, 모든 /api/* (각 API가 자체적으로 인증 확인),
// /s/* (공유 링크 진입점 + 무효 링크 안내), /admin/login, /access-denied, 확장자 있는 정적 파일.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|s/|admin/login|access-denied|.*\\..*).*)",
  ],
};
