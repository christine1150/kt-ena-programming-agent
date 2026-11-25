// 라인업(/lineup) — 다른 화면처럼 전역 메뉴를 위에 둔다. 접근 제어는 proxy.ts(로그인 필수)와 각 API(권한표)가 서버에서 한다.
import WorkspaceNav from "@/components/workspace/WorkspaceNav";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="print:hidden">
        <WorkspaceNav />
      </div>
      {children}
    </>
  );
}
