// 관리자 전용 화면 — 로그인하지 않았으면 로그인 화면으로 돌려보낸다.
// (실제로는 middleware.ts가 먼저 막지만, 직접 접근 시나리오 대비 이중 확인)
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/adminAuth";
import ShareLinkManager from "./ShareLinkManager";
import ChannelMasterUploader from "./ChannelMasterUploader";
import FeaturedContentManager from "./FeaturedContentManager";
import NielsenDailyUploader from "./NielsenDailyUploader";
import MailIngestionManager from "./MailIngestionManager";
import SkyUhdUploader from "./SkyUhdUploader";
import TargetGoalsManager from "./TargetGoalsManager";
import LogoutButton from "./LogoutButton";

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">관리자 화면</h1>
            <p className="text-sm text-zinc-500">{session.email}로 로그인됨</p>
          </div>
          <LogoutButton />
        </div>

        <ShareLinkManager />

        <ChannelMasterUploader />

        <FeaturedContentManager />

        <NielsenDailyUploader />

        <MailIngestionManager />

        <SkyUhdUploader />

        <TargetGoalsManager />
      </div>
    </div>
  );
}
