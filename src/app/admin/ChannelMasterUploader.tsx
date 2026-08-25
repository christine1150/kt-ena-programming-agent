"use client";

// 관리자 화면에서 `채널기본정보.xlsx`를 업로드해 Channel Master / Competitor Master /
// 목표 시청률을 DB에 반영하는 위젯.
import { useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type UploadResult = {
  ok: boolean;
  message?: string;
  alert?: string;
  summary?: { channel: string; competitors: number; targetGoal: boolean }[];
  warnings?: string[];
};

export default function ChannelMasterUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    // 사용자 지시(2026-08-22): "버튼을 눌러도 반응이 없다" — 파일을 고르지 않고 누르면 여기서
    // 조용히 아무 일도 없이 끝나던 게 원인이었다(에러 메시지도, 아무 표시도 없었음). 항상 눈에
    // 보이는 결과를 남기도록 수정.
    if (!file) {
      setResult({ ok: false, message: "업로드할 파일을 먼저 선택해주세요." });
      return;
    }

    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/upload/channel-master", {
      method: "POST",
      body: formData,
    });
    const body: UploadResult = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    setResult(body);
    setUploading(false);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">Channel Master 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        <code>채널기본정보.xlsx</code>의 &ldquo;채널 별 경쟁채널&rdquo; 시트를 읽어 채널·경쟁채널·목표
        시청률({new Date().getFullYear()}년 기준)을 반영합니다. 다시 업로드하면 기존 값을 덮어씁니다.
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
          {result.alert === "DATA_QUALITY_ALERT" && (
            <p className="mb-1 font-semibold">🔴 DATA QUALITY ALERT</p>
          )}
          {result.message}
        </div>
      )}

      {result?.ok && result.summary && (
        <div className="space-y-3">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-zinc-400">
                <th className="pb-1 font-medium">채널</th>
                <th className="pb-1 font-medium">경쟁채널 수</th>
                <th className="pb-1 font-medium">목표 시청률</th>
              </tr>
            </thead>
            <tbody>
              {result.summary.map((row) => (
                <tr key={row.channel} className="border-t border-zinc-100">
                  <td className="py-1.5 text-zinc-800">{row.channel}</td>
                  <td className="py-1.5 text-zinc-600">{row.competitors}개</td>
                  <td className="py-1.5 text-zinc-600">{row.targetGoal ? "저장됨" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.warnings && result.warnings.length > 0 && (
            <ul className="list-inside list-disc rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
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
