"use client";

// 2026-09-17(사용자 지시) — 종합 보고서의 **PPT 미리보기**. 채널 버전과 같은 구조이고,
// 다루는 문서만 7개 채널 비교 분석(flattenPortfolioReport)이다. 이전에 있던 6~9장짜리 임원
// 요약 덱은 제거했다 — 보고서는 채널(Word/PPT)·종합(Word/PPT) 4종뿐이다.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PptPreviewPayload } from "@/lib/audienceReport/pptSlidePlan";
import { PptPreview } from "@/components/audienceReport/pptPreview";

function PortfolioPptPreviewInner() {
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
        const res = await fetch(`/api/audience-report/portfolio/deck?${searchParams.toString()}`);
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
  }, [searchParams]);

  if (loading) return <div className="p-8 text-neutral-500">불러오는 중...</div>;
  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!payload) return null;

  const qs = searchParams.toString();
  return (
    <PptPreview
      payload={payload}
      pptxHref={`/api/audience-report/portfolio/pptx?${qs}`}
      wordHref={`/audience-report/portfolio?${qs}`}
      headerLabel="PPT 미리보기 · 종합 보고서(7채널 비교)"
    />
  );
}

export default function PortfolioPptPreviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500">불러오는 중...</div>}>
      <PortfolioPptPreviewInner />
    </Suspense>
  );
}
