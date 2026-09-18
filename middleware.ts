// 모든 화면 접근을 여기서 한 번 걸러준다.
// - /admin/* (로그인 화면 제외): 관리자 세션이 없으면 로그인 화면으로 돌려보낸다.
// - 그 외 일반 화면: 관리자 세션이든 PD 세션이든 하나는 있어야 하고,
//   둘 다 없으면 "/access-denied"로 돌려보낸다 (회원가입 없음 — PRD 원칙).
//
// 사용자 지시(2026-09-20, 보안 점검): 이 파일이 trash-can/(gitignore 대상)에만 있고 git에는
// 한 번도 커밋된 적이 없어(git log 이력 없음), 실제 배포본에는 이 보호가 전혀 반영되지 않고
// 있었다 — /admin/* 화면 셸이 관리자 세션 없이도 그대로 열려 있었다(각 /api/admin/* 라우트
// 자체의 getAdminSession() 확인은 살아있어 데이터 자체는 새지 않았지만, 화면 진입은 막히지
// 않았다). 프로젝트 루트로 복원해 git에 커밋한다.
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, PD_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function middleware(request: NextRequest) {
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

// 아래 경로들은 로그인/공유 링크 확인 없이도 열려야 하므로 미들웨어 대상에서 제외한다:
// _next 정적 파일, favicon, 모든 /api/* (각 API가 자체적으로 인증 확인),
// /s/* (공유 링크 진입점 + 무효 링크 안내), /admin/login, /access-denied, 확장자 있는 정적 파일.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|s/|admin/login|access-denied|.*\\..*).*)",
  ],
};
