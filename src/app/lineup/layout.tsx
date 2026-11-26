// 라인업(/lineup) — 다른 화면처럼 전역 메뉴를 위에 둔다. 접근 제어는 proxy.ts(로그인 필수)와 각 API(권한표)가 서버에서 한다.
// lineup.css = 라인업 전용 디자인 토큰(.lu 범위, 2026-11-26 리디자인) — 다른 메뉴에는 영향이 없다.
import WorkspaceNav from "@/components/workspace/WorkspaceNav";
import "./lineup.css";

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
