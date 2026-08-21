"use client";

// Nielsen 일별 채널시청률 파일 업로드 위젯. 여러 날짜를 한 번에 올릴 수 있다 (백필용).
import { useRef, useState } from "react";

type FileSummary = {
  fileName: string;
  ok: boolean;
  message?: string;
  reportDate?: string;
  ratingsInserted?: number;
  missingSheets?: string[];
};

export default function NielsenDailyUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
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
    setProgressText(`${files.length}개 파일 업로드 중... (파일이 많으면 시간이 걸릴 수 있습니다)`);

    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);

    const res = await fetch("/api/admin/upload/nielsen-daily", { method: "POST", body: formData });
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
        <code>닐슨_채널시청률(YYMMDD).xls</code>(일별) 파일을 올리면 6개 채널(ENA/ENA Drama/ENA
        Play/ENA Story/OLIFE/ONCE)의 시청률이 반영됩니다. <code>닐슨_채널시청률(YYMMDD-YYMMDD).xls</code>
        가 1/1~12/31 전체를 덮는 연간 파일이면 YoY(전년 대비) 비교용 기준값으로 별도 저장됩니다.
        여러 파일을 한 번에 선택할 수 있고, 같은 날짜(또는 같은 연도)를 다시 올리면 그 데이터를
        덮어씁니다. (skyUHD는 별도 카드에서 처리)
      </p>

      <div className="mb-4 flex items-center gap-3">
        <input ref={fileInputRef} type="file" accept=".xls,.xlsx" multiple className="text-sm" />
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
                  <th className="pb-1 font-medium">날짜</th>
                  <th className="pb-1 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.fileName} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-800">{r.fileName}</td>
                    <td className="py-1.5 text-zinc-600">{r.reportDate ?? "—"}</td>
                    <td className="py-1.5">
                      {r.ok ? (
                        <span className="text-zinc-600">{r.ratingsInserted}건 저장</span>
                      ) : (
                        <span className="text-red-600">{r.message}</span>
                      )}
                      {r.missingSheets && (
                        <div className="text-xs text-amber-600">
                          누락된 시트(참고용, 처리엔 영향 없음): {r.missingSheets.join(", ")}
                        </div>
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
