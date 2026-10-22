// 프로그램 성과(작품 × 채널 비교) — 전역 메뉴 아래에 둔다. 접근 제어는 proxy.ts(로그인 필수)와 API가 서버에서 한다.
import type { Metadata } from "next";
import WorkspaceNav from "@/components/workspace/WorkspaceNav";
import { PAGE_TITLE } from "@/lib/ui/pageTitles";

export const metadata: Metadata = { title: PAGE_TITLE.program };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkspaceNav />
      {children}
    </>
  );
}
