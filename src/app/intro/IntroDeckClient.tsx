"use client";

// 발표 화면은 창 크기·주소의 #번호·iframe을 다루므로 브라우저에서만 그린다(서버 렌더 없음).
import dynamic from "next/dynamic";

const IntroDeck = dynamic(() => import("./IntroDeck"), {
  ssr: false,
  loading: () => <div className="fixed inset-0" style={{ background: "#111" }} />,
});

export default function IntroDeckClient({ short }: { short: boolean }) {
  return <IntroDeck short={short} />;
}
