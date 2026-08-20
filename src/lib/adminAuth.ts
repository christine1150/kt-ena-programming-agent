// 서버 코드(API Route, 서버 컴포넌트)에서 "지금 로그인한 사람이 누구인지"
// 확인할 때 공통으로 쓰는 도우미 함수.
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, PD_COOKIE_NAME, verifySessionToken } from "@/lib/session";

/** 현재 요청의 쿠키에서 관리자 세션을 확인한다. 관리자가 아니면 null. */
export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const payload = await verifySessionToken(token);
  if (payload?.role !== "admin") return null;
  return payload;
}

/** 관리자 세션이 있으면 그것을, 없으면 PD 세션을 확인한다. 둘 다 없으면 null. */
export async function getCurrentSession() {
  const cookieStore = await cookies();
  const adminPayload = await verifySessionToken(cookieStore.get(ADMIN_COOKIE_NAME)?.value);
  if (adminPayload?.role === "admin") return adminPayload;

  const pdPayload = await verifySessionToken(cookieStore.get(PD_COOKIE_NAME)?.value);
  if (pdPayload?.role === "pd") return pdPayload;

  return null;
}
