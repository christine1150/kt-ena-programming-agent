"use client";

// skyUHD 시청률 업로드 위젯 — 수기로 누적 정리한 파일 하나를 올리면 매번 전체를 새로 반영한다.
import { useRef, useState } from "react";

type UploadResult = {
  ok: boolean;
  message?: string;
  alert?: string;
  ratingsInserted?: number;
  dateRange?: { from?: string; to?: string };
  warnings?: string[];
};

export default function SkyUhdUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

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
        <code>26 skyUHD 시청률 (MMDD).xlsx</code>의 &ldquo;26 UHD ALL&rdquo; 시트를 반영합니다. 수기로
        누적 정리된 파일이라, 다시 올리면 skyUHD 데이터 전체가 이 파일 내용으로 교체됩니다.
      </p>

      <div className="mb-4 flex items-center gap-3">
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="text-sm" />
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
