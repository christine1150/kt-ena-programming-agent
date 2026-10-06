"use client";

// 보고서 데이터 시점 안내(단계 07) — 보고서 링크에 실린 화면의 데이터 시점(cut)과 보고서가 계산한 시점·기간을 비교해
// ① 아직 받지 못한 날을 포함하거나 ② 화면과 다른 시점(이전 snapshot / 그 사이 갱신)이면 문서 맨 위에서 알린다.
// 판단은 reportGate.ts(순수 함수)가 한다. 이미 만들어진 문서를 막을 수는 없으므로 '막힘'은 경고로 표시한다.
import { useSearchParams } from "next/navigation";
import { cutoffFromQuery, evaluateReportGuard } from "@/lib/workspace/reportGate";

export default function ReportSnapshotNotice({ periodTo, reportCutoff }: { periodTo: string | null; reportCutoff: string | null }) {
  const sp = useSearchParams();
  const linkCutoff = cutoffFromQuery((k) => sp.get(k));
  const guard = evaluateReportGuard({
    status: "ready",
    isCurrent: true,
    requestedTo: periodTo,
    // 보고서가 자기 데이터 시점을 알면 그것을, 모르면 링크를 만든 화면의 시점을 '최신 수신일'로 본다.
    latestAvailableDate: reportCutoff ?? linkCutoff,
    linkCutoff,
    reportCutoff,
  });
  if (guard.mode === "ok" || !guard.message) return null;
  return (
    <div
      role="status"
      data-report-snapshot-notice={guard.code ?? ""}
      className={`mt-2 rounded p-2 text-xs ${guard.mode === "blocked" ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}
    >
      {guard.mode === "blocked" ? "⚠ " : ""}
      {guard.message}
    </div>
  );
}
