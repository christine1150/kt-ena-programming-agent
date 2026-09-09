// 홈 화면 = Page 1 종합 대시보드 (개발 단위 14번).
// (proxy.ts가 관리자/PD 세션이 없으면 이 화면에 오기 전에 /access-denied로 돌려보낸다)
import { headers } from "next/headers";
import { getCurrentSession } from "@/lib/adminAuth";
import { recordAccessIfNotLoggedToday } from "@/lib/loginLog";
import Dashboard from "./Dashboard";

export default async function Home() {
  const session = await getCurrentSession();

  // 사용자 지시(2026-09-09): "30일간 재로그인하지 않아도 접속하면 기록을 남게 할 수는 있어?"
  // — PD/관리자 세션이 길게 유지되는 동안엔 로그인 API가 아예 호출되지 않아 접속 이력이
  // 비어 있었다. 여기서(대시보드 진입점) 하루 1회로 제한해 기록한다 — 이력 저장이 실패해도
  // 화면 렌더링에는 영향을 주지 않는다(loginLog.ts 내부에서 에러를 흡수).
  if (session) {
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : h.get("x-real-ip");
    const userAgent = h.get("user-agent");
    const actorId = session.role === "admin" ? session.adminId : session.pdId;
    const actorName = session.role === "admin" ? session.email : session.name;
    await recordAccessIfNotLoggedToday({ role: session.role, actorId, actorName, ip, userAgent });
  }

  return <Dashboard isAdmin={session?.role === "admin"} />;
}
