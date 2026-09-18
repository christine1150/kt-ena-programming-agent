"use client";

// 사용자 지시(2026-09-19): "2주간 편성표를 넣으면 실제 나온 시청률을 편성표 안에 적어주고,
// 히트맵으로 그라데이션으로 보여주기도 하고, 엑셀로 다운받을 수도 있는 기능을 만들고 싶어.
// 한 페이지에 두 편성표를 한 번에 볼 수 있게 하면 더 좋고." 업로드는 채널·주차를 파일 자체
// (제목·파일명)에서 자동 인식한다 — 관리자가 고를 항목이 없다(자동 업로드 개선 방향 반영).
// 여러 주(예: 2주치)를 한 번에 선택하면 파일마다 순서대로 업로드한다.
import { useRef, useState } from "react";
import Link from "next/link";
import { FileInputTrigger } from "./FileInputTrigger";

interface UploadOutcome {
  fileName: string;
  ok: boolean;
  message?: string;
  channelCode?: string;
  weekStart?: string;
  weekEnd?: string;
  rowsSaved?: number;
  rowsMatched?: number | null;
}

export default function ScheduleGridUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [outcomes, setOutcomes] = useState<UploadOutcome[] | null>(null);

  async function handleUpload() {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setOutcomes(null);
    const results: UploadOutcome[] = [];
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/admin/upload/schedule-grid", { method: "POST", body: formData });
        const body = await res.json();
        results.push({ fileName: file.name, ok: res.ok && body.ok === true, ...body });
      } catch {
        results.push({ fileName: file.name, ok: false, message: "업로드 중 오류가 발생했습니다." });
      }
    }
    setOutcomes(results);
    setUploading(false);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-900">주간 편성표 업로드</h2>
        <Link href="/admin/schedule-grid" className="text-sm font-medium text-zinc-500 underline hover:text-zinc-700">
          업로드된 편성표 보기
        </Link>
      </div>
      <p className="mb-3 text-sm text-zinc-500">
        방송사 주간 편성표 엑셀을 올리면 채널·주차를 자동으로 인식해 저장하고, 이미 적재된 시청률과 매칭합니다. 여러 주를 한 번에 선택할 수 있습니다.
      </p>
      <div className="flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xlsx,.xls" multiple />
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {uploading ? "업로드 중..." : "업로드"}
        </button>
      </div>
      {outcomes && (
        <ul className="mt-4 flex flex-col gap-2">
          {outcomes.map((o, i) => (
            <li key={i} className={`rounded-lg px-3 py-2 text-sm ${o.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
              <span className="font-medium">{o.fileName}</span>
              {o.ok ? (
                <>
                  {" "}
                  — {o.channelCode} {o.weekStart}~{o.weekEnd}, {o.rowsSaved}건 저장
                  {typeof o.rowsMatched === "number" && `(시청률 매칭 ${o.rowsMatched}건)`}
                  {o.weekStart && (
                    <>
                      {" "}
                      <Link href={`/admin/schedule-grid?channel=${o.channelCode}&week=${o.weekStart}`} className="underline">
                        보기
                      </Link>
                    </>
                  )}
                </>
              ) : (
                <> — {o.message}</>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
