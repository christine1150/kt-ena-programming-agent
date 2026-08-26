// 관리자 전용 화면 — 로그인하지 않았으면 로그인 화면으로 돌려보낸다.
// (실제로는 middleware.ts가 먼저 막지만, 직접 접근 시나리오 대비 이중 확인)
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/adminAuth";
import ShareLinkManager from "./ShareLinkManager";
import ChannelMasterUploader from "./ChannelMasterUploader";
// 사용자 지시(2026-08-26): "요일 별 리뷰 프로그램" 조회 위젯을 없애고 "주요 콘텐츠 관리"
// (FeaturedContentManager) 하나로 합쳤다 — 두 화면이 같은 정보를 나눠 보여주고 있었다.
// 옛 컴포넌트/API는 trash-can/으로 이동(사용자 최종 확인 후 삭제, CLAUDE.md 파일 관리 규칙).
import FeaturedContentManager from "./FeaturedContentManager";
import NielsenDailyUploader from "./NielsenDailyUploader";
import MailIngestionManager from "./MailIngestionManager";
import SkyUhdUploader from "./SkyUhdUploader";
import TargetGoalsManager from "./TargetGoalsManager";
import OlifeEpgUploader from "./OlifeEpgUploader";
import ManualDramaReportUploader from "./ManualDramaReportUploader";
import OlifeEpisodeCatalogUploader from "./OlifeEpisodeCatalogUploader";
import DailyNewsManager from "./DailyNewsManager";
import MarketYtdRankUploader from "./MarketYtdRankUploader";
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
          <div className="flex items-center gap-3">
            <Link
              href="/admin/login-history"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              로그인 이력
            </Link>
            <LogoutButton />
          </div>
        </div>

        <ShareLinkManager />

        <ChannelMasterUploader />

        <FeaturedContentManager />

        <NielsenDailyUploader />

        <MailIngestionManager />

        <SkyUhdUploader />

        <OlifeEpgUploader />

        <ManualDramaReportUploader />

        <OlifeEpisodeCatalogUploader />

        <TargetGoalsManager />

        <DailyNewsManager />

        <MarketYtdRankUploader />
      </div>
    </div>
  );
}
