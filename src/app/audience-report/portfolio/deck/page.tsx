"use client";

// 종합 보고서의 PPT 미리보기. 단계 14: 다운로드되는 .pptx와 같은 스냅샷·같은 슬라이드 계획(본문 최대 10장 + 부록)을 그대로 보여 준다.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PptPreview } from "@/components/audienceReport/pptPreview";
import { ReportError, ReportLoading, periodQuery } from "@/components/audienceReport/useSnapshotReport";
import { useDeckPlan } from "@/components/audienceReport/useDeckPlan";

function PortfolioPptPreviewInner() {
  const searchParams = useSearchParams();
  const snapshotParam = searchParams.get("snapshot");
  const { state, retry } = useDeckPlan("/api/audience-report/portfolio/deck", snapshotParam ? `snapshot=${snapshotParam}` : periodQuery(searchParams));

  if (state.status === "loading") return <ReportLoading what="PPT 미리보기" hint="저장된 보고서 원본에서 슬라이드를 구성하는 중입니다(원본이 없으면 새로 계산해 30초~1분 걸립니다)." />;
  if (state.status === "error") return <ReportError message={state.message} onRetry={retry} />;
  const { plan, snapshot } = state;
  const id = snapshot.persisted ? snapshot.id : null;
  const q = id ? `snapshot=${id}` : snapshotParam ? `snapshot=${snapshotParam}` : periodQuery(searchParams);
  return (
    <PptPreview
      payload={plan}
      snapshot={snapshot}
      pptxHref={`/api/audience-report/portfolio/pptx?${q}`}
      wordHref={`/api/audience-report/portfolio/docx?${q}`}
      viewHref={id ? `/audience-report/view/${id}` : `/audience-report/portfolio?${periodQuery(searchParams)}`}
      reportHref={`/audience-report/portfolio?${periodQuery(searchParams)}`}
      headerLabel="PPT 미리보기 · 종합 보고서(7채널)"
    />
  );
}

export default function PortfolioPptPreviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500" role="status">불러오는 중...</div>}>
      <PortfolioPptPreviewInner />
    </Suspense>
  );
}
