"use client";

// OLIFE 회차 카탈로그(EBS 콘텐츠 리스트) 업로드 위젯 — 사용자 지시(2026-08-22): 세계테마기행/
// 극한직업/한국기행의 국가·부제 상세 메타데이터를 보완한다(EPG 업로드와 별개 — EPG는 방영
// 시간·회차·부제만, 이 파일은 국가/테마까지 채운다).
import { useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type FileSummary =
  | { fileName: string; ok: true; seriesCounts: Record<string, number>; totalRows: number; upserted: number }
  | { fileName: string; ok: false; message: string };

export default function OlifeEpisodeCatalogUploader() {
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

    const res = await fetch("/api/admin/upload/olife-episode-catalog", { method: "POST", body: formData });
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
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">OLIFE 회차 카탈로그(EBS 콘텐츠 리스트) 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        세계테마기행/극한직업/한국기행 시트가 담긴 EBS 콘텐츠 리스트 엑셀을 올리면, 회차별 부제에서
        국가(사전 매칭 성공 시)·상세 조각·(극한직업만) 테마를 추출해 저장합니다. Nielsen/EPG 데이터의
        부제(episode_subtitle)와 텍스트가 일치하는 방영분에만 매칭되므로(부제 원문이 카탈로그에 없는
        회차는 매칭되지 않음), 카탈로그가 늘어날수록 매칭률도 함께 늘어납니다.
      </p>

      <div className="mb-4 flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xls,.xlsx" multiple />
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
                ? `${Object.entries(r.seriesCounts).map(([s, n]) => `${s} ${n}건`).join(", ")} — 총 ${r.totalRows}건 저장(${r.upserted}건 반영)`
                : r.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
