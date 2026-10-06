// 서버에서 세션 역할을 읽어 전역 메뉴(GlobalNav)에 넘기는 얇은 서버 컴포넌트(단계 07). 레이아웃에서 한 줄로 쓴다.
// 로그인하지 않은 요청은 role=null이라 메뉴가 보이지 않는다(접근 자체는 proxy.ts와 각 API가 막는다).
import { getCurrentSession } from "@/lib/adminAuth";
import { roleOfSession } from "@/lib/admin/permissions";
import GlobalNav from "./GlobalNav";

export default async function WorkspaceNav() {
  const session = await getCurrentSession();
  return <GlobalNav role={roleOfSession(session)} />;
}
