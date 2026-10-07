"use client";

// 채널 보고서의 PPT 미리보기. 단계 14: 다운로드되는 .pptx와 같은 스냅샷·같은 슬라이드 계획(deckPlan.ts)을 그대로 보여 준다.
// 주소에 snapshot=<ID>가 있으면 저장된 그 원본을, 없으면 기간 파라미터로 만들거나 방금 만든 것을 쓴다.
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PptPreview } from "@/components/audienceReport/pptPreview";
import { ReportError, ReportLoading, periodQuery } from "@/components/audienceReport/useSnapshotReport";
import { useDeckPlan } from "@/components/audienceReport/useDeckPlan";

function ChannelPptPreviewInner() {
  const params = useParams<{ channel: string }>();
  const searchParams = useSearchParams();
  const snapshotParam = searchParams.get("snapshot");
  const { state, retry } = useDeckPlan(`/api/audience-report/${params.channel}/deck`, snapshotParam ? `snapshot=${snapshotParam}` : periodQuery(searchParams));

  if (state.status === "loading") return <ReportLoading what="PPT 미리보기" hint="저장된 보고서 원본에서 슬라이드를 구성하는 중입니다(원본이 없으면 새로 계산해 30초~1분 걸립니다)." />;
  if (state.status === "error") return <ReportError message={state.message} onRetry={retry} />;
  const { plan, snapshot } = state;
  // 이후 모든 링크는 이 스냅샷 ID로 — 미리보기에서 본 것과 받은 파일이 같은 원본이다.
  const id = snapshot.persisted ? snapshot.id : null;
  const q = id ? `snapshot=${id}` : snapshotParam ? `snapshot=${snapshotParam}` : periodQuery(searchParams);
  return (
    <PptPreview
      payload={plan}
      snapshot={snapshot}
      pptxHref={`/api/audience-report/${params.channel}/pptx?${q}`}
      wordHref={`/api/audience-report/${params.channel}/docx?${q}`}
      viewHref={id ? `/audience-report/view/${id}` : `/audience-report/${params.channel}?${periodQuery(searchParams)}`}
      reportHref={`/audience-report/${params.channel}?${periodQuery(searchParams)}`}
      headerLabel="PPT 미리보기 · 채널 보고서"
    />
  );
}

export default function ChannelPptPreviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500" role="status">불러오는 중...</div>}>
      <ChannelPptPreviewInner />
    </Suspense>
  );
}
