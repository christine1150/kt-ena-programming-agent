// 화면 제목(단계 15) — 브라우저 탭 이름을 업무 이름으로 둔다.
import type { Metadata } from "next";
import { PAGE_TITLE } from "@/lib/ui/pageTitles";

export const metadata: Metadata = { title: PAGE_TITLE.denied };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
