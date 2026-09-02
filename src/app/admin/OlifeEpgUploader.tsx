"use client";

// OLIFE EPG(일일운행표) 업로드 위젯 — 사용자 지시(2026-08-21): 닐슨 자료에 없는 회차·부제를
// 이 파일로 보완한다. 사용자 지시(2026-08-26)로 백엔드(olifeEpgStaging.ts)는 이미 순서 무관하게
// 동작하도록 바뀌었다 — EPG를 먼저 올리면 olife_epg_staging에 저장만 해두고(hasRatings=false),
// 그 날짜 Nielsen 파일이 나중에 올라올 때(nielsenIngest.ts) 자동으로 다시 매칭을 시도한다. 이
// 화면의 설명 문구만 "Nielsen이 먼저"라는 옛 순서를 여전히 안내하고 있던 것을 사용자 지적
// (2026-09-02)으로 실제 동작에 맞게 정정했다 — 화면 텍스트만 바뀌었을 뿐 동작은 그대로.
import { useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type FileSummary = {
  fileName: string;
  ok: boolean;
  message?: string;
  datesProcessed?: string[];
  matchedCount?: number;
  unmatchedCount?: number;
};

export default function OlifeEpgUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<FileSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleUpload() {
    const files = fileInputRef.current?.files;
    // 사용자 지시(2026-08-22): "버튼을 눌러도 반응이 없다" — 파일 미선택 시 조용히 종료되던
    // 것을 항상 눈에 보이는 메시지로.
    if (!files || files.length === 0) {
      setErrorMessage("업로드할 파일을 먼저 선택해주세요.");
      return;
    }

    setUploading(true);
    setErrorMessage(null);
    setResults(null);

    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);

    const res = await fetch("/api/admin/upload/olife-epg", { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));

    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "업로드에 실패했습니다.");
    } else {
      setResults(body.files);
    }
    setUploading(false);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      {/* 사용자 지시(2026-09-02): 제목을 "OLIFE EPG 업로드"로. */}
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">OLIFE EPG 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        <code>일일운행표_YYYYMMDD.xlsx</code> 파일을 올리면 그 날짜의 Nielsen 프로그램 데이터에
        회차·부제를 매칭해 채웁니다. <b>순서는 상관없습니다</b> — Nielsen 일일 데이터가 먼저 있으면
        즉시 매칭되고, EPG를 먼저 올려두면 일단 저장만 해뒀다가 그 날짜의 Nielsen 파일이 나중에
        올라올 때 자동으로 매칭됩니다(다시 올릴 필요 없음). 시작시간이 ±60분 이내이고 프로그램명이
        일치하는 EPG 항목을 자동으로 찾으며, 못 찾은 방영분은 비워둡니다.
      </p>

      <div className="mb-4 flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xlsx" multiple />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {uploading ? "업로드 중..." : "업로드"}
        </button>
      </div>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      {results && (
        <div className="flex flex-col gap-1.5 text-sm">
          {results.map((r, i) => (
            <div key={i} className={r.ok ? "text-zinc-600" : "text-red-600"}>
              <span className="font-medium">{r.fileName}</span>:{" "}
              {r.ok
                ? r.message ?? `${r.datesProcessed?.join(", ")} — 매칭 ${r.matchedCount}건, 미매칭 ${r.unmatchedCount}건`
                : r.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
