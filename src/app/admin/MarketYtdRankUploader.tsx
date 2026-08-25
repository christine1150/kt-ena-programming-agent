"use client";

// 누적(YTD 등) 채널 순위 업로드 위젯 — 예: "26년 채널 누적 시청률.xlsx".
// 사용자 지시(2026-08-21): 등록된 경쟁채널뿐 아니라 시장 전체(200개 이상) 채널의 기간 누적
// 순위·시청률을 담은 파일 — 같은 (타깃, 채널, 기간)으로 재업로드하면 덮어쓴다.
import { useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type UploadResult = {
  ok: boolean;
  message?: string;
  alert?: string;
  rowsUpserted?: number;
  targets?: string[];
  dateRange?: { from?: string; to?: string };
  channelCount?: number;
  warnings?: string[];
};

export default function MarketYtdRankUploader() {
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

    const res = await fetch("/api/admin/upload/market-ytd-rank", { method: "POST", body: formData });
    const body: UploadResult = await res
      .json()
      .catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    setResult(body);
    setUploading(false);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">누적 채널 순위 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        예: <code>26년 채널 누적 시청률.xlsx</code>. 등록된 경쟁채널뿐 아니라 시장 전체 채널의 기간
        누적 순위·시청률을 담은 파일입니다 — Page 1 히어로 카드의 &ldquo;누적 순위&rdquo;가 이
        시장 전체 기준 순위를 우선 사용합니다(같은 타깃·채널·기간으로 재업로드하면 덮어씀).
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
            {result.rowsUpserted}건 저장됨 ({result.dateRange?.from} ~ {result.dateRange?.to}, 타깃{" "}
            {result.targets?.join(", ")}, 채널 {result.channelCount}개)
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
