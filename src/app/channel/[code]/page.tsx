// 채널별 딥다이브 화면 (개발 단위 15번). 실제 데이터/화면은 ChannelDeepDive가 그린다.
import { Suspense } from "react";
import ChannelDeepDive from "../ChannelDeepDive";

export default async function ChannelPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // UX 아키텍트 개선안(2026-09-09, IA 재배치 방안 2): ChannelDeepDive가 탭 상태를
  // useSearchParams(?tab=)로 관리하게 되어 Suspense 경계가 필요해짐(App Router 요구사항).
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-500">불러오는 중...</p>}>
      <ChannelDeepDive code={code} />
    </Suspense>
  );
}
