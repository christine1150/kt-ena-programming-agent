// "베타" 메뉴 — OLIFE 시청률 지도(OLIFE 걸어서 세계속으로·세계테마기행, 2026-07~10 닐슨 × 나라·도시·테마 분류).
// 정식 기능 전 시험 공개이므로 본문은 별도 문서(iframe)로 띄워 기존 화면·스타일에 영향을 주지 않는다.
import type { Metadata } from "next";

export const metadata: Metadata = { title: "OLIFE 시청률 지도 (베타)" };

export default function GeoMapBetaPage() {
  // 레이아웃이 flex 세로 배치라 mx-auto만 두면 내용 폭으로 줄어든다 — w-full로 가로를 꽉 채운다. 본문 랜드마크(<main>)는 layout.tsx에 이미 있어 div로 둔다.
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-3 py-3 sm:px-6">
      <iframe src="/beta/geo-map/frame" title="OLIFE 시청률 지도" className="h-[calc(100vh-110px)] min-h-[680px] w-full rounded-2xl border border-zinc-200 bg-white" />
    </div>
  );
}
