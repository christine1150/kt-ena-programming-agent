// 사내 소개 발표 「도와줘, 편성 비서!」(2026-11-27, 사용자 요청) — 만화와 실제 사이트 화면을 한 발표 안에서 오간다.
// 로그인은 proxy.ts가 다른 화면과 똑같이 확인한다. 실제 화면은 같은 사이트를 iframe으로 띄우므로 로그인 쿠키가 그대로 쓰인다.
// 전역 메뉴가 없는 전체 화면(이 경로에는 layout이 없다). 10분 판은 /intro?min=10.
import type { Metadata } from "next";
import IntroDeck from "./IntroDeckClient";

export const metadata: Metadata = {
  title: "도와줘, 편성 비서!",
  robots: { index: false, follow: false },
};

export default async function IntroPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const short = sp.min === "10";
  return <IntroDeck short={short} />;
}
