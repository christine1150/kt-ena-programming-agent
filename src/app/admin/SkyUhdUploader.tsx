"use client";

// skyUHD 시청률 업로드 위젯 — 수기로 누적 정리한 파일 하나를 올리면 매번 전체를 새로 반영한다.
import { useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type UploadResult = {
  ok: boolean;
  message?: string;
  alert?: string;
  ratingsInserted?: number;
  dateRange?: { from?: string; to?: string };
  sheetName?: string;
  zeroRatingRows?: number;
  warnings?: string[];
};

export default function SkyUhdUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    // 사용자 지시(2026-08-22): "버튼을 눌러도 반응이 없다" — 파일 미선택 시 조용히 종료되던
    // 것을 항상 눈에 보이는 메시지로.
    if (!file) {
      setResult({ ok: false, message: "업로드할 파일을 먼저 선택해주세요." });
      return;
    }

    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/upload/skyuhd", { method: "POST", body: formData });
    const body: UploadResult = await res
      .json()
      .catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    setResult(body);
    setUploading(false);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">skyUHD 시청률 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        {/* 변경(2026-09-17): 누적 파일뿐 아니라 월별 세부 내역 파일도 올릴 수 있게 되어(시트명
            대신 헤더로 시트를 찾고, 파일에 담긴 날짜 구간만 교체) 안내 문구를 맞춘다. */}
        <code>26 skyUHD 시청률 (MMDD).xlsx</code>의 &ldquo;26 UHD ALL&rdquo; 시트, 또는 같은 항목
        (날짜·시작시간·프로그램명·시청률)을 가진 월별 세부 내역 시트를 반영합니다. 파일에 담긴 날짜
        구간만 이 파일 내용으로 교체되므로, 한 달치만 올려도 다른 달 데이터는 그대로 남습니다.
        시청률 칸이 비어 있는 행은 실제 시청률 0으로 반영됩니다(화면에는 빈 칸으로 표시).
      </p>

      <div className="mb-4 flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xlsx,.xls" />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {uploading ? "업로드 중..." : "업로드"}
        </button>
      </div>

      {result && !result.ok && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {result.alert === "DATA_QUALITY_ALERT" && <p className="mb-1 font-semibold">🔴 DATA QUALITY ALERT</p>}
          {result.message}
        </div>
      )}

      {result?.ok && (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-700">
            {result.ratingsInserted}건 저장됨 ({result.dateRange?.from} ~ {result.dateRange?.to})
            {result.sheetName && <span className="text-zinc-400"> · 시트 &ldquo;{result.sheetName}&rdquo;</span>}
            {typeof result.zeroRatingRows === "number" && result.zeroRatingRows > 0 && (
              <span className="text-zinc-400"> · 시청률 빈 칸 {result.zeroRatingRows}건을 0으로 반영</span>
            )}
          </p>
          {result.warnings && result.warnings.length > 0 && (
            <ul className="list-inside list-disc rounded-lg bg-amber-50 p-3 text-amber-800">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
