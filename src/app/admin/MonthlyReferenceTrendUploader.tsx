"use client";

// 사용자 지시(2026-09-07): "관리자 페이지에서 월간/연간 리포트 등을 세부 내역으로 올리게
// 되어 있는데, 엑셀 파일을 올리면 우리가 약속한 논리대로 분석해서 자동으로 리포트를 작성 및
// 보완하여 같이 배포하는 것으로 수정. 관리자 페이지 레이아웃도 함께 수정"
//
// 옛 컴포넌트(MonthlyContentReviewManager, trash-can/monthly-content-review-2026-09-07/로 이동)는
// PD가 장르별/프로그램별/시장TOP10/하이라이트를 셀 단위로 전부 손으로 옮겨 적는 화면이었는데,
// 조사 결과 그 값을 저장하던 channel_monthly_content_review 테이블은 **Page 1 어디에도
// 렌더링되지 않는 죽은 테이블**이었다 — PD가 입력해도 화면엔 반영되지 않고 있었다. 이 컴포넌트는
// 그 대신 실제로 Page 1 "월간 리뷰" 하단에 렌더링되는 channel_monthly_genre_trend/
// channel_monthly_program_trend(+신설 channel_monthly_narrative)에 엑셀 업로드 한 번으로
// 직접 반영한다 — 원본 사내 자료가 실제로 쓰는 "행=장르/프로그램, 열=월" 표 형태를 그대로
// 인식한다(src/lib/monthlyReferenceTrendParse.ts).
import { useEffect, useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type Channel = { id: string; code: string; name: string };
type UploadResult = {
  monthsFound: number[];
  genreRowCount: number;
  programRowCount: number;
  narrativeSaved: boolean;
  warnings: string[];
};
type PreviewGenreRow = { month: number; genre_key: string; genre_label: string; rating: number | null; updated_at: string };
type PreviewProgramRow = { month: number; category: string; program_name: string; rating: number | null; note: string | null; updated_at: string };
type PreviewNarrativeRow = { month: number; narrative_text: string; updated_at: string };

export default function MonthlyReferenceTrendUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelCode, setChannelCode] = useState("");
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [sourceNote, setSourceNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  // 사용자가 채널·연도를 바꿀 때마다 그 조합에 대한 미리보기를 다시 불러온다. previewKey로
  // "지금 화면에 있는 preview가 어느 채널·연도 것인지"를 추적해 로딩 여부를 파생시킨다(effect
  // 안에서 로딩 플래그를 곧바로 setState하지 않기 위함 — react-hooks/set-state-in-effect).
  const [preview, setPreview] = useState<{ genreRows: PreviewGenreRow[]; programRows: PreviewProgramRow[]; narrativeRows: PreviewNarrativeRow[] } | null>(
    null
  );
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const requestedKey = channelCode ? `${channelCode}:${year}` : null;
  const previewLoading = requestedKey !== null && previewKey !== requestedKey;

  useEffect(() => {
    fetch("/api/admin/channels")
      .then((r) => r.json())
      .then((body) => setChannels(Array.isArray(body) ? body : (body.channels ?? [])))
      .catch(() => setChannels([]));
  }, []);

  function loadPreview(code: string, y: number) {
    if (!code) return;
    const key = `${code}:${y}`;
    fetch(`/api/admin/upload/monthly-reference-trend?channelCode=${code}&year=${y}`)
      .then((r) => r.json())
      .then((body) => {
        setPreview(body.ok ? { genreRows: body.genreRows, programRows: body.programRows, narrativeRows: body.narrativeRows } : null);
        setPreviewKey(key);
      })
      .catch(() => {
        setPreview(null);
        setPreviewKey(key);
      });
  }

  useEffect(() => {
    if (channelCode) loadPreview(channelCode, year);
  }, [channelCode, year]);

  async function handleUpload() {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setErrorMessage("업로드할 엑셀 파일을 먼저 선택해주세요.");
      return;
    }
    if (!channelCode) {
      setErrorMessage("채널을 선택해주세요.");
      return;
    }
    setUploading(true);
    setErrorMessage(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", files[0]);
    formData.append("channelCode", channelCode);
    formData.append("year", String(year));
    if (sourceNote.trim()) formData.append("sourceNote", sourceNote.trim());

    const res = await fetch("/api/admin/upload/monthly-reference-trend", { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    setUploading(false);
    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "업로드에 실패했습니다.");
      return;
    }
    setResult(body);
    loadPreview(channelCode, year);
  }

  const inputCls = "w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm";
  const monthLabel = (m: number) => `${m}월`;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">월간 채널 추이 자료 업로드(장르별·프로그램별)</h2>
      <p className="mb-3 text-sm text-zinc-500">
        사내 &ldquo;전체 채널 월간 추이&rdquo; 자료(원본과 같은 &ldquo;행=장르/프로그램, 열=월&rdquo; 표 형태)를 엑셀로 올리면 자동으로 읽어
        1페이지 &ldquo;월간 리뷰&rdquo; 하단 참고 자료에 <b>즉시 반영</b>됩니다 — 이 화면에서 따로 저장 버튼을 누를 필요가 없습니다. 같은
        채널·연도를 다시 올리면 최신 값으로 안전하게 덮어씁니다.
      </p>
      <details className="mb-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
        <summary className="cursor-pointer font-medium text-zinc-600">엑셀 파일 형식 안내(펼치기)</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            <b>&ldquo;장르별&rdquo; 시트</b>(필수) — A열에 카테고리명(예: 자체드라마(본), 자체드라마(재), 자체예능(본), 자체예능(재), 구매 드라마,
            기타, 채널평균), 그 뒤로 월 열(&ldquo;1월&rdquo;~&ldquo;12월&rdquo; 또는 &ldquo;2026-08&rdquo; 형식)을 시청률 값으로 채웁니다.
          </li>
          <li>
            <b>&ldquo;프로그램별&rdquo; 시트</b>(선택) — A열 구분(자체드라마/자체예능 등), B열 프로그램명, 그 뒤로 월 열, 마지막에 &ldquo;비고&rdquo;
            열(해당 프로그램의 가장 최근 방영월에만 자동으로 붙습니다).
          </li>
          <li>
            <b>&ldquo;하이라이트&rdquo; 시트</b>(선택) — 서술형 하이라이트 원문을 자유롭게 적으면 가장 최근 달의 하이라이트로 저장되어 참고
            자료 하단에 그대로 노출됩니다.
          </li>
          <li>시트 이름은 위 키워드(장르/프로그램/하이라이트)가 포함돼 있으면 인식합니다 — 정확히 같은 이름이 아니어도 됩니다.</li>
        </ul>
      </details>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">채널</p>
          <select value={channelCode} onChange={(e) => setChannelCode(e.target.value)} className={inputCls}>
            <option value="">선택</option>
            {channels.map((c) => (
              <option key={c.id} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">연도</p>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputCls} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">자료 출처(선택)</p>
          <input
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
            className={inputCls}
            placeholder="예: 전체 채널 월간 추이(26년9월업데이트).xlsx"
          />
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xlsx,.xls" />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {uploading ? "업로드 중..." : "업로드 및 반영"}
        </button>
      </div>

      {errorMessage && <p className="mb-3 text-sm text-red-600">{errorMessage}</p>}
      {result && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {result.monthsFound.map(monthLabel).join(", ")} 반영 완료 — 장르별 {result.genreRowCount}행, 프로그램별 {result.programRowCount}행
          {result.narrativeSaved ? ", 하이라이트 저장됨" : ""}. 1페이지 월간 리뷰에서 바로 확인할 수 있습니다.
          {result.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-amber-700">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {channelCode && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500">
            현재 저장된 값 미리보기({year}년) {previewLoading && "— 불러오는 중..."}
          </p>
          {preview && preview.genreRows.length === 0 && preview.programRows.length === 0 && (
            <p className="text-xs text-zinc-400">아직 저장된 값이 없습니다.</p>
          )}
          {preview && preview.genreRows.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-zinc-400">
                    <th className="pb-1 pr-2 font-medium">장르</th>
                    <th className="pb-1 pr-2 font-medium">월</th>
                    <th className="pb-1 pr-2 text-right font-medium">시청률</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.genreRows.map((r, i) => (
                    <tr key={i} className="border-t border-zinc-50">
                      <td className="py-0.5 pr-2 text-zinc-600">{r.genre_label}</td>
                      <td className="py-0.5 pr-2 text-zinc-400">{monthLabel(r.month)}</td>
                      <td className="py-0.5 pr-2 text-right tabular-nums text-zinc-700">{r.rating ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview && preview.programRows.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-zinc-400">
                    <th className="pb-1 pr-2 font-medium">구분</th>
                    <th className="pb-1 pr-2 font-medium">프로그램</th>
                    <th className="pb-1 pr-2 font-medium">월</th>
                    <th className="pb-1 pr-2 text-right font-medium">시청률</th>
                    <th className="pb-1 pr-2 font-medium">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.programRows.map((r, i) => (
                    <tr key={i} className="border-t border-zinc-50">
                      <td className="py-0.5 pr-2 text-zinc-500">{r.category}</td>
                      <td className="py-0.5 pr-2 text-zinc-600">{r.program_name}</td>
                      <td className="py-0.5 pr-2 text-zinc-400">{monthLabel(r.month)}</td>
                      <td className="py-0.5 pr-2 text-right tabular-nums text-zinc-700">{r.rating ?? "—"}</td>
                      <td className="py-0.5 pr-2 text-zinc-400">{r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview && preview.narrativeRows.length > 0 && (
            <div className="rounded-lg bg-zinc-50 p-2 text-[11px] text-zinc-600">
              <p className="mb-1 font-medium text-zinc-500">하이라이트({monthLabel(preview.narrativeRows[preview.narrativeRows.length - 1].month)})</p>
              <p className="whitespace-pre-line">{preview.narrativeRows[preview.narrativeRows.length - 1].narrative_text}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
