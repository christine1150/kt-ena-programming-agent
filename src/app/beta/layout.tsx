// 베타 화면(시청률 지도) — 다른 화면처럼 전역 메뉴를 위에 둔다(메뉴가 없어 1페이지로 돌아갈 수 없던 문제, 2026-10-26).
// 접근 제어는 proxy.ts(로그인 필수)가 서버에서 한다.
import WorkspaceNav from "@/components/workspace/WorkspaceNav";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkspaceNav />
      {children}
    </>
  );
}
