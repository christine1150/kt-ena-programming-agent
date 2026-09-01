"use client";

// O절(2026-09-01) — 닐슨 주간·월간 파일 업로드 위젯. NielsenDailyUploader의 구조를 그대로
// 따르되(같은 화면에서 두 카드가 다르게 동작하면 혼란스러우므로) 결과 컬럼만 기간에 맞췄다.
import { useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type FileSummary = {
  fileName: string;
  ok: boolean;
  message?: string;
  periodType?: string;
  dateFrom?: string;
  dateTo?: string;
  inserted?: number;
  skippedUnknown?: string[];
};

export default function NielsenPeriodUploader() {
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
    setProgressText(`${files.length}개 파일 업로드 중...`);

    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);

    const res = await fetch("/api/admin/upload/nielsen-period", { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));

    if (!res.ok || !body.ok) setErrorMessage(body.message ?? "업로드에 실패했습니다.");
    else setResults(body.files);
    setProgressText(null);
    setUploading(false);
  }

  const successCount = results?.filter((r) => r.ok).length ?? 0;
  const failCount = results ? results.length - successCount : 0;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">Nielsen 주간·월간 순위 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        <code>닐슨_채널시청률(YYMMDD-YYMMDD).xls</code> 형태의 주간·월간 파일을 올리면 그 기간의{" "}
        <b>시장 전체 순위</b>가 저장됩니다. 이 순위는 닐슨이 기간 전체로 매긴 값이라 일별 순위를
        평균 내서는 만들 수 없어, 2페이지의 &ldquo;주간 순위 변화&rdquo;에 쓰입니다. 기간은 파일명이
        아니라 시트 안의 <code>분석기간</code>에서 읽습니다. 같은 기간을 다시 올리면 덮어씁니다.
        일별 파일을 잘못 올리면 이유를 알려주고 거부합니다(위 &ldquo;Nielsen 시청률 업로드&rdquo; 카드를 쓰세요).
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
                  <th className="pb-1 font-medium">기간</th>
                  <th className="pb-1 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.fileName} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-800">{r.fileName}</td>
                    <td className="py-1.5 text-zinc-600">
                      {r.ok ? `${r.periodType === "weekly" ? "주간" : "월간"} ${r.dateFrom}~${r.dateTo}` : "—"}
                    </td>
                    <td className="py-1.5">
                      {r.ok ? <span className="text-zinc-600">{r.inserted}건 저장</span> : <span className="text-red-600">{r.message}</span>}
                      {r.skippedUnknown && r.skippedUnknown.length > 0 && (
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
