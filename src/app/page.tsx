// 홈 화면 = Page 1 종합 대시보드 (개발 단위 14번).
// (proxy.ts가 관리자/PD 세션이 없으면 이 화면에 오기 전에 /access-denied로 돌려보낸다)
import { getCurrentSession } from "@/lib/adminAuth";
import Dashboard from "./Dashboard";

export default async function Home() {
  const session = await getCurrentSession();

  return <Dashboard isAdmin={session?.role === "admin"} />;
}
