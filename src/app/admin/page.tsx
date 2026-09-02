// 관리자 전용 화면 — 로그인하지 않았으면 로그인 화면으로 돌려보낸다.
// (실제로는 middleware.ts가 먼저 막지만, 직접 접근 시나리오 대비 이중 확인)
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/adminAuth";
import ChannelMasterUploader from "./ChannelMasterUploader";
// 사용자 지시(2026-08-26): "요일 별 리뷰 프로그램" 조회 위젯을 없애고 "주요 콘텐츠 관리"
// (FeaturedContentManager) 하나로 합쳤다 — 두 화면이 같은 정보를 나눠 보여주고 있었다.
// 옛 컴포넌트/API는 trash-can/으로 이동(사용자 최종 확인 후 삭제, CLAUDE.md 파일 관리 규칙).
import FeaturedContentManager from "./FeaturedContentManager";
import NielsenDailyUploader from "./NielsenDailyUploader";
import NielsenPeriodUploader from "./NielsenPeriodUploader";
import MailIngestionManager from "./MailIngestionManager";
import SkyUhdUploader from "./SkyUhdUploader";
import TargetGoalsManager from "./TargetGoalsManager";
import OlifeEpgUploader from "./OlifeEpgUploader";
// 사용자 지시(2026-09-01, 관리자 화면 중복 점검): "PD 수동 회차 리포트"(드라마 양식)와
// "PD 수동 오리지널예능 리포트"(예능 양식) 두 카드를 ManualReportUploader 하나로 합쳤다 —
// 화면·채널 선택·결과 표시가 사실상 같은 코드였고, 같은 테이블(program_manual_reports)에
// 같은 키로 저장해 Page 1의 같은 섹션을 채우고 있었다. 이제 양식을 자동 판별한다.
// 옛 컴포넌트 2개는 trash-can/으로 이동(사용자 최종 확인 후 삭제, CLAUDE.md 파일 관리 규칙).
import ManualReportUploader from "./ManualReportUploader";
import OlifeEpisodeCatalogUploader from "./OlifeEpisodeCatalogUploader";
import DailyNewsManager from "./DailyNewsManager";
import MarketYtdRankUploader from "./MarketYtdRankUploader";
import LogoutButton from "./LogoutButton";

// 묶음 소제목 — 카드가 아니라 구분선 역할만 한다(첫 묶음은 위 여백을 주지 않아도 되게 mt로만 조정).
function AdminSectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-2 border-t border-zinc-200 pt-4">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-700">{title}</h2>
      <p className="text-xs text-zinc-400">{description}</p>
    </div>
  );
}

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  return (
    // 사용자 지시(2026-08-26): "관리자 화면 자체를 옆으로 넓힙시다 — 주요 콘텐츠 관리(요일별
    // 리뷰 프로그램) 내용이 좌우로 잘 보이게". 기존 max-w-2xl(672px)이 FeaturedContentManager의
    // grid-cols-2/3·표를 좁게 눌러 담고 있었다 — max-w-6xl(1152px)로 넓힘.
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">관리자 화면</h1>
            <p className="text-sm text-zinc-500">{session.email}로 로그인됨</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 사용자 지시(2026-09-02): "관리자 화면에서 바로 1페이지 또는 2페이지로 넘어갈 수
                있는 링크 버튼" — 익명 PD 공유 링크를 없앤 뒤 관리자가 화면을 확인하려면 직접
                URL을 치고 들어가야 했던 불편을 해소. 2페이지는 채널별 화면이라 기본값으로
                ENA(다른 nav들도 첫 채널로 쓰는 코드)를 연다.
                사용자 재지시(2026-09-02): 새 창으로 열리게 — 관리자 화면 탭을 잃지 않도록
                target="_blank"(+ noopener noreferrer로 새 탭이 원본 탭을 조작 못 하게 방지).
                사용자 재지시(2026-09-02, 재확인+이름 변경): 버튼 이름을 실제 화면 성격에 맞게
                "일일 종합 리포트"(1페이지)/"채널별 분석"(2페이지)으로. */}
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              일일 종합 리포트
            </Link>
            <Link
              href="/channel/ENA"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              채널별 분석
            </Link>
            <Link
              href="/admin/login-history"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              로그인 이력
            </Link>
            <Link
              href="/admin/ask-gaps"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              질문하기 사각지대
            </Link>
            <LogoutButton />
          </div>
        </div>

        {/* 사용자 지시(2026-08-26): 아래 순서로 고정, 나머지는 중요도 순(PD 실사용 빈도·영향
            범위 기준).
            사용자 지시(2026-09-01, 배치 점검): 카드 14개가 아무 구분 없이 한 줄로 이어져 있어
            "지금 뭘 해야 하는 화면인지"가 보이지 않았다 — 실제 사용 주기(매일 / 수시 / 가끔
            바뀌는 기준 정보 / 점검용)로 4개 묶음으로 나누고 소제목을 붙였다. 카드 자체와 그
            안의 동작은 하나도 바꾸지 않았고 순서도 기존 중요도 순을 유지한다(위치만 묶음 안으로).
            사용자 지시(2026-09-02, 보안 점검): "PD 공유 링크" 위젯 제거 — 이름·비밀번호 없이
            PD 권한을 주는 익명 접속 경로였고, 로그인 이력에도 남지 않는 문제가 있었다(개별 PD
            로그인이 이미 있어 더 이상 필요하지 않음). trash-can/anonymous-pd-share-link-2026-09-02/
            로 이동. */}

        <AdminSectionHeading title="매일 올리는 자료" description="닐슨이 보내주는 파일을 그대로 올리는 곳입니다." />
        <NielsenDailyUploader />
        <NielsenPeriodUploader />
        <SkyUhdUploader />
        <OlifeEpgUploader />

        <AdminSectionHeading title="1페이지에 바로 반영되는 내용" description="PD가 수시로 올리거나 고치는 항목 — 올리는 즉시 대시보드 화면이 바뀝니다." />
        <DailyNewsManager />
        <FeaturedContentManager />
        <ManualReportUploader />

        <AdminSectionHeading title="기준 정보(가끔 바뀜)" description="채널·목표·경쟁채널처럼 한 번 정하면 오래 쓰는 값입니다." />
        <ChannelMasterUploader />
        <TargetGoalsManager />
        <MarketYtdRankUploader />
        <OlifeEpisodeCatalogUploader />

        <AdminSectionHeading title="점검" description="자동 수집이 제대로 돌고 있는지 확인합니다." />
        <MailIngestionManager />
      </div>
    </div>
  );
}
