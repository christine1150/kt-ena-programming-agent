"use client";

// 사용자 지시(2026-09-02): "시청률/주간/월간/연간 순위 업로드 하는 칸을 하나로 만들고, 시스템이
// 알아서 일일 데이터와 주간/월간/연간 분류할 수 있게" — 기존 NielsenDailyUploader/
// NielsenPeriodUploader 두 카드를 하나로 합쳤다(옛 컴포넌트는 trash-can/으로 이동). 서버가
// 파일마다 시트 안의 "분석기간"으로 종류를 자동 판정하므로(/api/admin/upload/nielsen), 화면은
// 파일 선택 하나 + 업로드 버튼 하나만 두고, 결과 표에 "종류" 열로 무엇으로 처리됐는지 보여준다.
import { useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type FileSummary = {
  fileName: string;
  kind: "daily" | "period";
  ok: boolean;
  message?: string;
  // daily
  annual?: boolean;
  reportDate?: string;
  ratingsInserted?: number;
  missingSheets?: string[];
  // period
  periodType?: "weekly" | "monthly";
  dateFrom?: string;
  dateTo?: string;
  inserted?: number;
  skippedUnknown?: string[];
};

function kindLabel(r: FileSummary): string {
  if (r.kind === "period") return r.periodType === "weekly" ? "주간" : "월간";
  return r.annual ? "연간(YoY)" : "일간";
}

function dateOrPeriodLabel(r: FileSummary): string {
  if (r.kind === "period") return r.dateFrom && r.dateTo ? `${r.dateFrom} ~ ${r.dateTo}` : "—";
  return r.reportDate ?? "—";
}

export default function NielsenUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [results, setResults] = useState<FileSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleUpload() {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setErrorMessage("업로드할 파일을 먼저 선택해주세요.");
      return;
    }

    setUploading(true);
    setErrorMessage(null);
    setResults(null);
    setProgressText(`${files.length}개 파일 업로드 중... (파일이 많으면 시간이 걸릴 수 있습니다)`);

    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);

    const res = await fetch("/api/admin/upload/nielsen", { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));

    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "업로드에 실패했습니다.");
    } else {
      setResults(body.files);
    }
    setProgressText(null);
    setUploading(false);
  }

  const successCount = results?.filter((r) => r.ok).length ?? 0;
  const failCount = results ? results.length - successCount : 0;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">Nielsen 시청률 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        <code>닐슨_채널시청률(YYMMDD).xls</code>(일별), <code>(YYMMDD-YYMMDD).xls</code>(주간·월간),
        1/1~12/31 전체를 덮는 연간 파일까지 한 번에 올릴 수 있습니다 — 파일명이 아니라 시트 안의{" "}
        <code>분석기간</code>을 보고 종류를 자동으로 구분합니다. 일별은 6개 채널(ENA/ENA Drama/ENA
        Play/ENA Story/OLIFE/ONCE)의 시청률에, 주간·월간은 그 기간의 <b>시장 전체 순위</b>(2페이지
        &ldquo;주간 순위 변화&rdquo;용)에, 연간 파일은 YoY(전년 대비) 비교용 기준값에 반영됩니다.
        여러 파일을 한 번에 선택할 수 있고, 같은 날짜(또는 같은 기간·연도)를 다시 올리면 그
        데이터를 덮어씁니다. (skyUHD는 별도 카드에서 처리)
      </p>

      <div className="mb-4 flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xls,.xlsx" multiple />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {uploading ? "업로드 중..." : "업로드"}
        </button>
      </div>

      {progressText && <p className="mb-3 text-sm text-zinc-500">{progressText}</p>}
      {errorMessage && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage}</div>}

      {results && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            성공 {successCount}개 {failCount > 0 && <span className="text-red-600">/ 실패 {failCount}개</span>}
          </p>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-zinc-400">
                  <th className="pb-1 font-medium">파일</th>
                  <th className="pb-1 font-medium">종류</th>
                  <th className="pb-1 font-medium">날짜/기간</th>
                  <th className="pb-1 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.fileName} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-800">{r.fileName}</td>
                    <td className="py-1.5 text-zinc-600">{r.ok ? kindLabel(r) : "—"}</td>
                    <td className="py-1.5 text-zinc-600">{r.ok ? dateOrPeriodLabel(r) : "—"}</td>
                    <td className="py-1.5">
                      {r.ok ? (
                        <span className="text-zinc-600">{r.kind === "period" ? r.inserted : r.ratingsInserted}건 저장</span>
                      ) : (
                        <span className="text-red-600">{r.message}</span>
                      )}
                      {r.kind === "daily" && r.missingSheets && r.missingSheets.length > 0 && (
                        <div className="text-xs text-amber-600">누락된 시트(참고용, 처리엔 영향 없음): {r.missingSheets.join(", ")}</div>
                      )}
                      {r.kind === "period" && r.skippedUnknown && r.skippedUnknown.length > 0 && (
                        <div className="text-xs text-amber-600">매핑 실패로 건너뜀: {r.skippedUnknown.join(", ")}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
