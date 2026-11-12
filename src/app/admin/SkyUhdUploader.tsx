"use client";

// skyUHD 시청률 업로드 위젯 — 수기로 누적 정리한 파일 하나를 올리면 매번 전체를 새로 반영한다.
// 2026-11-13 추가: IPTV 셋톱 시청률 "화면 캡처 그림"(png/jpg/webp)을 올리면 표를 읽어 미리 보여 주고, 날짜를 확인한 뒤 반영한다.
import { useRef, useState } from "react";
import HelpTip from "./HelpTip";
import { FileInputTrigger } from "./FileInputTrigger";

type ImageRow = { start: string; end: string; name: string; rating: number | null; belowFloor: boolean; isRerun: boolean };
type ImagePreview = {
  fileName: string;
  rows: ImageRow[];
  errors: string[];
  warnings: string[];
  suggestedDate: string | null;
  suggestedMatch: string | null;
};

const yesterdayKst = () => new Date(Date.now() + 9 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);

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
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const [calendarDate, setCalendarDate] = useState("");
  const [applying, setApplying] = useState(false);

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
    setPreview(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/upload/skyuhd", { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    setUploading(false);
    // 그림이면 저장 전 미리보기만 받는다 — 날짜를 확인하고 "반영" 버튼을 눌러야 저장된다.
    if (body.ok && body.mode === "image_preview") {
      setPreview(body as ImagePreview);
      setCalendarDate((body as ImagePreview).suggestedDate ?? yesterdayKst());
      return;
    }
    setResult(body as UploadResult);
  }

  async function handleApplyImage() {
    if (!preview) return;
    setApplying(true);
    setResult(null);
    const res = await fetch("/api/admin/upload/skyuhd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply_image", calendarDate, rows: preview.rows, fileName: preview.fileName }),
    });
    const body = await res.json().catch(() => ({ ok: false, message: "반영 응답을 읽지 못했습니다." }));
    setApplying(false);
    if (body.ok) {
      setResult({
        ok: true,
        message: `IPTV 셋톱 시청률 ${body.saved}건 반영됨 (방송일 ${(body.broadcastDates as string[]).join(", ")})`,
        warnings: body.warnings,
      });
      setPreview(null);
    } else {
      setResult({ ok: false, message: body.message });
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">skyUHD 시청률 업로드<HelpTip>
        {/* 변경(2026-09-17): 누적 파일뿐 아니라 월별 세부 내역 파일도 올릴 수 있게 되어(시트명
            대신 헤더로 시트를 찾고, 파일에 담긴 날짜 구간만 교체) 안내 문구를 맞춘다. */}
        <code>26 skyUHD 시청률 (MMDD).xlsx</code>의 &ldquo;26 UHD ALL&rdquo; 시트, 또는 같은 항목
        (날짜·시작시간·프로그램명·시청률)을 가진 월별 세부 내역 시트를 반영합니다. 파일에 담긴 날짜
        구간만 이 파일 내용으로 교체되므로, 한 달치만 올려도 다른 달 데이터는 그대로 남습니다.
        시청률 칸이 비어 있는 행은 실제 시청률 0으로 반영됩니다(화면에는 빈 칸으로 표시).
        <br />
        <b>IPTV 셋톱 시청률 그림</b>(png·jpg·webp): 방영 시간대·프로그램·시청률(%) 표를 캡처한 그림을 올리면 표를 읽어
        미리 보여 줍니다. 날짜를 확인하고 &ldquo;이 내용으로 반영&rdquo;을 누르면 1페이지 skyUHD 일간 세부 내역의 IPTV 열에 쓰입니다.
        [재] 배지가 없는 줄은 &lt;본&gt;으로 저장됩니다. 그림은 글자 인식을 위해 OpenAI로 전송되므로 읽은 값은 꼭 눈으로 확인해 주세요.
      </HelpTip></h2>

      <div className="mb-4 flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xlsx,.xls,.png,.jpg,.jpeg,.webp" />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {uploading ? "읽는 중..." : "업로드"}
        </button>
      </div>

      {preview && (
        <div className="mb-4 space-y-3 rounded-xl border border-zinc-200 p-4 text-sm">
          <p className="font-medium text-zinc-900">
            IPTV 셋톱 시청률 그림 인식 결과 <span className="font-normal text-zinc-400">· {preview.fileName} · {preview.rows.length}줄</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-zinc-600" htmlFor="stb-date">그림의 달력 날짜</label>
            <input
              id="stb-date"
              type="date"
              value={calendarDate}
              onChange={(e) => setCalendarDate(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1"
            />
            <span className="text-xs text-zinc-500">
              {preview.suggestedDate
                ? `닐슨 편성과 비교해 ${preview.suggestedDate}로 추정했습니다(시작 시각 ${preview.suggestedMatch} 일치). 틀리면 고쳐 주세요.`
                : "그림에 날짜가 없어 어제 날짜를 넣었습니다. 맞는 날짜인지 확인해 주세요."}
            </span>
          </div>
          {preview.errors.length > 0 && (
            <ul className="list-inside list-disc rounded-lg bg-red-50 p-3 text-red-700">
              {preview.errors.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {preview.warnings.length > 0 && (
            <ul className="list-inside list-disc rounded-lg bg-amber-50 p-3 text-amber-800">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="max-h-96 overflow-auto rounded-lg ring-1 ring-zinc-100">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-1.5">방영 시간대</th>
                  <th className="px-3 py-1.5">프로그램</th>
                  <th className="px-3 py-1.5">본/재</th>
                  <th className="px-3 py-1.5 text-right">시청률(%)</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="px-3 py-1.5 tabular-nums">{r.start} ~ {r.end}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5">{r.isRerun ? "재" : "본"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.belowFloor ? "< 0.0001" : (r.rating ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleApplyImage}
              disabled={applying || preview.errors.length > 0 || !calendarDate}
              className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {applying ? "반영 중..." : "이 내용으로 반영"}
            </button>
            <button onClick={() => setPreview(null)} className="rounded-lg px-3 py-2 text-zinc-600 hover:bg-zinc-100">
              취소
            </button>
            {preview.errors.length > 0 && <span className="text-xs text-red-600">오류가 있어 반영할 수 없습니다. 그림을 다시 올려 주세요.</span>}
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {result.alert === "DATA_QUALITY_ALERT" && <p className="mb-1 font-semibold">🔴 DATA QUALITY ALERT</p>}
          {result.message}
        </div>
      )}

      {result?.ok && (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-700">
            {result.ratingsInserted === undefined ? (
              result.message
            ) : (
              <>
                {result.ratingsInserted}건 저장됨 ({result.dateRange?.from} ~ {result.dateRange?.to})
              </>
            )}
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
