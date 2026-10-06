// 전역 메뉴(단계 07)를 이 경로 아래 모든 화면 위에 둔다. 메뉴 노출은 세션 역할에 따라 서버가 결정한다.
import WorkspaceNav from "@/components/workspace/WorkspaceNav";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkspaceNav />
      {children}
    </>
  );
}
