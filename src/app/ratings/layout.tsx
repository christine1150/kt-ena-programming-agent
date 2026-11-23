// 시청률 표(/ratings) — 다른 화면처럼 전역 메뉴를 위에 둔다(메뉴가 없어 홈·다른 화면으로 돌아갈 수 없던 문제, 2026-11-23).
// 전역 메뉴는 sticky가 아니라 스크롤하면 위로 사라지고, 아래 보기 탭 머리줄만 화면 위에 붙어 표가 한 화면에 보이게 한다.
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
