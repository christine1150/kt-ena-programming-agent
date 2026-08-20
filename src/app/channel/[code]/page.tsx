// 채널별 딥다이브 화면 (개발 단위 15번). 실제 데이터/화면은 ChannelDeepDive가 그린다.
import ChannelDeepDive from "../ChannelDeepDive";

export default async function ChannelPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ChannelDeepDive code={code} />;
}
