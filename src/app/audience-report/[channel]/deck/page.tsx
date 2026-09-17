"use client";

// 2026-09-17(사용자 지시) — 채널 리포트의 **PPT 미리보기**. 2페이지 헤더의 P 버튼이 이 경로로
// 들어온다. 이전에는 여기에 6~9장짜리 임원 요약 덱이 떴는데, 사용자가 요구한 보고서 구성은
// 채널(Word/PPT)·종합(Word/PPT) 4종뿐이므로 요약 덱을 없애고 **다운로드되는 상세 .pptx와 같은
// 내용**을 그대로 보여준다.
//
// 화면 자체는 서버가 만든 슬라이드 계획(pptSlidePlan.ts)을 PptPreview 컴포넌트가 그린다 —
// 이 페이지는 데이터를 받아 넘기는 일만 한다. 채널·종합 두 미리보기가 같은 컴포넌트를 쓴다.
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { PptPreviewPayload } from "@/lib/audienceReport/pptSlidePlan";
import { PptPreview } from "@/components/audienceReport/pptPreview";

function ChannelPptPreviewInner() {
  const params = useParams<{ channel: string }>();
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<PptPreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/audience-report/${params.channel}/deck?${searchParams.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) setError(json.message ?? "PPT 미리보기를 불러오지 못했습니다.");
        else setPayload(json.preview);
      } catch {
        if (!cancelled) setError("PPT 미리보기를 불러오는 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.channel, searchParams]);

  if (loading) return <div className="p-8 text-neutral-500">불러오는 중...</div>;
  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!payload) return null;

  const qs = searchParams.toString();
  return (
    <PptPreview
      payload={payload}
      // 이 미리보기의 형식 그대로 — PPT 미리보기에서는 .pptx만 받는다(2026-09-17 사용자 지시).
      pptxHref={`/api/audience-report/${params.channel}/pptx?${qs}`}
      wordHref={`/audience-report/${params.channel}?${qs}`}
      headerLabel="PPT 미리보기 · 채널 리포트"
    />
  );
}

export default function ChannelPptPreviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500">불러오는 중...</div>}>
      <ChannelPptPreviewInner />
    </Suspense>
  );
}
