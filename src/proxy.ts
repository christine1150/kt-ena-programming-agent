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

  // 사용자 지시(2026-09-02, 보안 점검): "관리자 외에는 그냥 들어올 수 없고 반드시 /pd/login을
  // 통해서 들어와서 이력이 남게" — 확인 결과 로그인 안 한 방문자가 대시보드를 그대로 볼 수는
  // 없었지만(이 분기 자체가 이미 그걸 막고 있었음), 도착지가 /access-denied(안내 화면, 버튼을
  // 한 번 더 눌러야 로그인 폼)였다. 곧바로 /pd/login으로 보내 로그인까지 한 번에 이어지게
  // 하고(그 로그인은 /api/pd/login이 이미 recordLogin()으로 이력을 남김), 관리자 로그인 경로는
  // /pd/login 화면 하단 링크로 유지한다(/access-denied 페이지 자체는 남겨두되 더 이상 기본
  // 도착지로 쓰지 않음).
  //
  // 사용자 지시(2026-09-02, 추가 점검): 익명 "PD 공유 링크"(/s/토큰)를 폐지하면서(로그인 이력
  // 없이 PD 권한을 주던 구멍 — trash-can/anonymous-pd-share-link-2026-09-02/README.md 참고),
  // 아래 matcher의 "s/" 제외도 함께 제거했다 — 이제 옛 공유 링크로 들어와도(경로 자체는
  // 사라졌지만 북마크가 남아있을 수 있음) 이 분기를 그대로 타 /pd/login으로 안내된다.
  if (!isAdmin && !isPd) {
    return NextResponse.redirect(new URL("/pd/login", request.url));
  }

  return NextResponse.next();
}

// 아래 경로들은 로그인 확인 없이도 열려야 하므로 대상에서 제외한다:
// _next 정적 파일, favicon, 모든 /api/* (각 API가 자체적으로 인증 확인),
// /admin/login, /pd/login, /access-denied, 확장자 있는 정적 파일.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|admin/login|pd/login|access-denied|.*\\..*).*)",
  ],
};
