// 통합 로그아웃 API — 관리자·PD 세션 쿠키를 둘 다 지운다(둘 중 하나만 있어도 안전하게 동작).
// 사용자 지시(2026-09-09): "로그인 안하면 못들어가게 막아줘" — 실제로는 이미 proxy.ts가
// 로그인 없는 접근을 전부 /pd/login으로 돌려보내고 있었지만, PD 세션은 로그아웃 기능
// 자체가 없어(admin/logout만 존재) 한 번 로그인하면 30일간 재로그인 화면을 볼 일이 없었다
// — "로그인을 안 했는데도 들어가진다"는 신고는 이 로그아웃 부재 때문이었다. 관리자/admin
// 전용이던 /api/admin/logout(그대로 유지, 관리자 화면 내부에서 계속 씀)과 별개로, 대시보드
// 헤더(모두가 보는 화면)에서 쓸 공용 로그아웃을 신설한다.
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, PD_COOKIE_NAME } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  response.cookies.set(PD_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
