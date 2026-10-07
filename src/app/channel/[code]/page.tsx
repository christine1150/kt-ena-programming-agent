// 채널별 딥다이브 화면 (개발 단위 15번). 실제 데이터/화면은 ChannelDeepDive가 그린다.
// 단계 07: ChannelDeepDive가 URL 쿼리(기간 프리셋·직접 선택 기간·동요일)를 읽으므로 Suspense 안에서 렌더링한다.
// 단계 15: 화면 낭독기용 최상위 제목(h1)을 둔다(화면에는 보이지 않음).
import { Suspense } from "react";
import ChannelDeepDive from "../ChannelDeepDive";

export default async function ChannelPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <>
      <h1 className="sr-only-ko">채널 분석 · {code}</h1>
      <Suspense fallback={<p className="p-8 text-sm text-zinc-500" role="status">불러오는 중...</p>}>
        <ChannelDeepDive code={code} />
      </Suspense>
    </>
  );
}
