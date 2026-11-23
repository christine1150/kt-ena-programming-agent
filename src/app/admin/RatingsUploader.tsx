"use client";

// 사용자 지시(2026-11-24): "Nielsen 시청률 업로드"와 "skyUHD 시청률 업로드"를 하나로 합쳐 "시청률 업로드"로.
// 파일 선택칸 하나에 아래 자료를 섞어 올려도 파일마다 알맞은 서버 경로로 보낸다(서버 API는 그대로).
//  · 닐슨 xls/xlsx(일간·주간·월간·연간)·TV INDEX CSV(채널별 IPTV 셋톱)  → /api/admin/upload/nielsen
//  · skyUHD 수기 xlsx(파일명에 skyUHD)·IPTV 셋톱 화면 캡처 그림(png/jpg/webp) → /api/admin/upload/skyuhd
//    (닐슨 경로가 못 읽은 xlsx 는 skyUHD 경로로 한 번 더 시도한다)
// 옛 NielsenUploader·SkyUhdUploader 는 trash-can/ 으로 옮겼다.
import { useRef, useState, type ReactNode } from "react";
import HelpTip from "./HelpTip";
import { FileInputTrigger } from "./FileInputTrigger";

type NielsenSummary = {
  fileName: string;
  kind: "daily" | "period" | "iptv";
  ok: boolean;
  message?: string;
  annual?: boolean;
  reportDate?: string;
  ratingsInserted?: number;
  missingSheets?: string[];
  periodType?: "weekly" | "monthly";
  dateFrom?: string;
  dateTo?: string;
  inserted?: number;
  skippedUnknown?: string[];
  duplicate?: boolean;
  revision?: number;
  partial?: boolean;
  qualityWarnings?: string[];
};

type ImageRow = { start: string; end: string; name: string; rating: number | null; belowFloor: boolean; isRerun: boolean };
type ImagePreview = { fileName: string; rows: ImageRow[]; errors: string[]; warnings: string[]; suggestedDate: string | null; suggestedMatch: string | null };

type SkyResult = {
  ok: boolean;
  message?: string;
  alert?: string;
  ratingsInserted?: number;
  dateRange?: { from?: string; to?: string };
  sheetName?: string;
  zeroRatingRows?: number;
  warnings?: string[];
};

// 화면에 한 줄로 보여줄 결과
type Line = { key: string; fileName: string; kind: string; period: string; ok: boolean; body: ReactNode; notes: ReactNode[] };

const yesterdayKst = () => new Date(Date.now() + 9 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const CSV_RE = /\.csv$/i;
const SKY_NAME_RE = /sky\s*uhd/i;

function nielsenKind(r: NielsenSummary): string {
  if (r.kind === "iptv") return "IPTV 셋톱(TV INDEX)";
  if (r.kind === "period") return r.periodType === "weekly" ? "주간" : "월간";
  return r.annual ? "연간(YoY)" : "일간";
}

function nielsenLine(r: NielsenSummary, i: number): Line {
  const period = r.ok ? (r.kind === "period" || r.kind === "iptv" ? (r.dateFrom && r.dateTo ? `${r.dateFrom} ~ ${r.dateTo}` : "—") : r.reportDate ?? "—") : "—";
  const notes: ReactNode[] = [];
  if (r.kind === "daily" && r.missingSheets && r.missingSheets.length > 0) notes.push(<>누락된 시트(참고용, 처리엔 영향 없음): {r.missingSheets.join(", ")}</>);
  if (r.ok && !r.duplicate) for (const w of r.qualityWarnings ?? []) notes.push(w);
  if (r.kind === "period" && r.skippedUnknown && r.skippedUnknown.length > 0) notes.push(<>매핑 실패로 건너뜀: {r.skippedUnknown.join(", ")}</>);
  const body = !r.ok ? (
    r.message
  ) : r.duplicate ? (
    "변경 없음(이미 반영된 동일 파일)"
  ) : (
    <>
      {r.kind === "period" || r.kind === "iptv" ? r.inserted : r.ratingsInserted}건 저장{r.kind === "iptv" && r.message ? ` · ${r.message}` : ""}
      {r.revision && r.revision > 1 ? ` · 개정 ${r.revision}` : ""}
      {r.partial ? " · 일부 항목 실패(아래 경고)" : ""}
    </>
  );
  return { key: `n${i}-${r.fileName}`, fileName: r.fileName, kind: r.ok ? nielsenKind(r) : "—", period, ok: r.ok, body, notes };
}

function skyLine(fileName: string, r: SkyResult, i: number): Line {
  const body = !r.ok ? (
    <>
      {r.alert === "DATA_QUALITY_ALERT" ? "🔴 " : ""}
      {r.message}
    </>
  ) : r.ratingsInserted === undefined ? (
    r.message
  ) : (
    <>
      {r.ratingsInserted}건 저장됨{r.sheetName ? ` · 시트 "${r.sheetName}"` : ""}
      {typeof r.zeroRatingRows === "number" && r.zeroRatingRows > 0 ? ` · 시청률 빈 칸 ${r.zeroRatingRows}건을 0으로 반영` : ""}
    </>
  );
  const period = r.ok && r.dateRange?.from ? `${r.dateRange.from} ~ ${r.dateRange.to}` : "—";
  return { key: `s${i}-${fileName}`, fileName, kind: r.ok ? (r.ratingsInserted === undefined ? "IPTV 셋톱(CSV)" : "skyUHD") : "—", period, ok: r.ok, body, notes: r.ok ? (r.warnings ?? []) : [] };
}

export default function RatingsUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previews, setPreviews] = useState<ImagePreview[]>([]);
  const [calendarDate, setCalendarDate] = useState("");
  const [applying, setApplying] = useState(false);
  const preview = previews[0] ?? null;

  async function postSky(file: File): Promise<{ status: number; body: Record<string, unknown> }> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload/skyuhd", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    return { status: res.status, body };
  }

  async function handleUpload() {
    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) {
      setErrorMessage("업로드할 파일을 먼저 선택해주세요.");
      return;
    }
    setUploading(true);
    setErrorMessage(null);
    setLines(null);
    setPreviews([]);
    const out: Line[] = [];
    const newPreviews: ImagePreview[] = [];

    // ① 파일 종류별로 보낼 곳을 나눈다
    const images = files.filter((f) => IMAGE_RE.test(f.name));
    const skyXlsx = files.filter((f) => !IMAGE_RE.test(f.name) && !CSV_RE.test(f.name) && SKY_NAME_RE.test(f.name));
    const nielsenFiles = files.filter((f) => !images.includes(f) && !skyXlsx.includes(f));

    // ② 닐슨·TV INDEX (한 번에)
    if (nielsenFiles.length > 0) {
      setProgressText(`${nielsenFiles.length}개 파일 업로드 중... (파일이 많으면 시간이 걸릴 수 있습니다)`);
      const fd = new FormData();
      for (const f of nielsenFiles) fd.append("files", f);
      const res = await fetch("/api/admin/upload/nielsen", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
      if (!res.ok || !body.ok) {
        setErrorMessage(body.message ?? "업로드에 실패했습니다.");
      } else {
        const sums = body.files as NielsenSummary[];
        for (let i = 0; i < sums.length; i++) {
          const s = sums[i];
          const f = nielsenFiles.find((x) => x.name === s.fileName);
          // 닐슨 파일이 아닌 엑셀(skyUHD 수기 파일 등)은 skyUHD 경로로 한 번 더 시도한다
          if (!s.ok && f && !CSV_RE.test(f.name)) {
            setProgressText(`${f.name} — skyUHD 파일로 다시 시도 중...`);
            const r = await postSky(f);
            if (r.body.ok) {
              out.push(skyLine(f.name, r.body as SkyResult, i));
              continue;
            }
          }
          out.push(nielsenLine(s, i));
        }
      }
    }

    // ③ skyUHD 수기 엑셀 (파일마다)
    for (let i = 0; i < skyXlsx.length; i++) {
      setProgressText(`skyUHD 파일 ${skyXlsx[i].name} 읽는 중...`);
      const r = await postSky(skyXlsx[i]);
      out.push(skyLine(skyXlsx[i].name, r.body as SkyResult, 100 + i));
    }

    // ④ IPTV 셋톱 화면 캡처 그림 — 저장 전 미리보기만 받는다
    for (let i = 0; i < images.length; i++) {
      setProgressText(`그림 ${images[i].name} 읽는 중... (수십 초 걸릴 수 있습니다)`);
      const r = await postSky(images[i]);
      if (r.body.ok && r.body.mode === "image_preview") newPreviews.push(r.body as unknown as ImagePreview);
      else out.push(skyLine(images[i].name, r.body as SkyResult, 200 + i));
    }

    setLines(out);
    setPreviews(newPreviews);
    if (newPreviews.length > 0) setCalendarDate(newPreviews[0].suggestedDate ?? yesterdayKst());
    setProgressText(null);
    setUploading(false);
  }

  function nextPreview() {
    const rest = previews.slice(1);
    setPreviews(rest);
    if (rest.length > 0) setCalendarDate(rest[0].suggestedDate ?? yesterdayKst());
  }

  async function handleApplyImage() {
    if (!preview) return;
    setApplying(true);
    const res = await fetch("/api/admin/upload/skyuhd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply_image", calendarDate, rows: preview.rows, fileName: preview.fileName }),
    });
    const body = await res.json().catch(() => ({ ok: false, message: "반영 응답을 읽지 못했습니다." }));
    setApplying(false);
    const line: SkyResult = body.ok
      ? { ok: true, message: `IPTV 셋톱 시청률 ${body.saved}건 반영됨 (방송일 ${(body.broadcastDates as string[]).join(", ")})`, warnings: body.warnings }
      : { ok: false, message: body.message };
    setLines((prev) => [...(prev ?? []), { ...skyLine(preview.fileName, line, 300 + (prev?.length ?? 0)), kind: body.ok ? "IPTV 셋톱(그림)" : "—" }]);
    nextPreview();
  }

  const okCount = lines?.filter((l) => l.ok).length ?? 0;
  const failCount = lines ? lines.length - okCount : 0;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">시청률 업로드<HelpTip>
        시청률 자료를 한 곳에서 올립니다. 여러 파일을 섞어서 한 번에 선택해도 파일마다 알맞게 처리합니다.
        <br />
        <b>닐슨 파일</b> <code>닐슨_채널시청률(YYMMDD).xls</code>(일별), <code>(YYMMDD-YYMMDD).xls</code>(주간·월간), 1/1~12/31 전체를
        덮는 연간 파일 — 파일명이 아니라 시트 안의 <code>분석기간</code>을 보고 종류를 자동으로 구분합니다. 일별은 6개 채널(ENA/ENA
        Drama/ENA Play/ENA Story/OLIFE/ONCE)의 시청률에, 주간·월간은 그 기간의 <b>시장 전체 순위</b>(2페이지 &ldquo;주간 순위 변화&rdquo;용)에,
        연간 파일은 YoY(전년 대비) 비교용 기준값에 반영됩니다. 같은 파일을 다시 올리면 건너뛰고, 같은 날짜·기간의 수정본은 덮어쓰면서
        이전 반영본과 달라진 건수를 알려줍니다.
        <br />
        <b>TV INDEX &ldquo;프로그램 방영 성과&rdquo; CSV</b> — 파일 안의 채널·타깃(가구 또는 수도권 개인 2049)을 읽어 일일 시청률 표·일간 세부
        내역의 IPTV 셋톱 열에 자동 반영합니다(채널당 파일 1개, 여러 채널 동시 선택 가능). skyUHD 가구 파일은 기존 셋톱표에도 반영하며
        캡처 등으로 이미 있는 시간대와 겹치는 구간은 기존 값을 유지합니다.
        <br />
        <b>skyUHD 수기 파일</b> <code>26 skyUHD 시청률 (MMDD).xlsx</code>의 &ldquo;26 UHD ALL&rdquo; 시트, 또는 같은 항목(날짜·시작시간·프로그램명·시청률)을
        가진 월별 세부 내역 시트 — 파일에 담긴 날짜 구간만 이 파일 내용으로 교체되므로 한 달치만 올려도 다른 달은 그대로 남습니다.
        시청률 칸이 비어 있는 행은 실제 시청률 0으로 반영됩니다(화면에는 빈 칸으로 표시).
        <br />
        <b>IPTV 셋톱 시청률 그림</b>(png·jpg·webp) — 방영 시간대·프로그램·시청률(%) 표를 캡처한 그림을 올리면 표를 읽어 미리 보여 줍니다.
        날짜를 확인하고 &ldquo;이 내용으로 반영&rdquo;을 누르면 skyUHD 일간 세부 내역의 IPTV 열에 쓰입니다. [재] 배지가 없는 줄은 &lt;본&gt;으로
        저장됩니다. 그림은 글자 인식을 위해 OpenAI로 전송되므로 읽은 값은 꼭 눈으로 확인해 주세요.
      </HelpTip></h2>

      <div className="mb-4 flex items-center gap-3">
        <FileInputTrigger inputRef={fileInputRef} accept=".xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp" multiple />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {uploading ? "업로드 중..." : "업로드"}
        </button>
      </div>

      {progressText && <p className="mb-3 text-sm text-zinc-500">{progressText}</p>}
      {errorMessage && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{errorMessage}</div>}

      {preview && (
        <div className="mb-4 space-y-3 rounded-xl border border-zinc-200 p-4 text-sm">
          <p className="font-medium text-zinc-900">
            IPTV 셋톱 시청률 그림 인식 결과 <span className="font-normal text-zinc-400">· {preview.fileName} · {preview.rows.length}줄{previews.length > 1 ? ` · 대기 중인 그림 ${previews.length - 1}장 더` : ""}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-zinc-600" htmlFor="stb-date">그림의 달력 날짜</label>
            <input id="stb-date" type="date" value={calendarDate} onChange={(e) => setCalendarDate(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1" />
            <span className="text-xs text-zinc-500">
              {preview.suggestedDate
                ? `닐슨 편성과 비교해 ${preview.suggestedDate}로 추정했습니다(시작 시각 ${preview.suggestedMatch} 일치). 틀리면 고쳐 주세요.`
                : "그림에 날짜가 없어 어제 날짜를 넣었습니다. 맞는 날짜인지 확인해 주세요."}
            </span>
          </div>
          {preview.errors.length > 0 && (
            <ul className="list-inside list-disc rounded-lg bg-red-50 p-3 text-red-700">{preview.errors.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {preview.warnings.length > 0 && (
            <ul className="list-inside list-disc rounded-lg bg-amber-50 p-3 text-amber-800">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
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
            <button onClick={nextPreview} className="rounded-lg px-3 py-2 text-zinc-600 hover:bg-zinc-100">
              {previews.length > 1 ? "이 그림 건너뛰기" : "취소"}
            </button>
            {preview.errors.length > 0 && <span className="text-xs text-red-600">오류가 있어 반영할 수 없습니다. 그림을 다시 올려 주세요.</span>}
          </div>
        </div>
      )}

      {lines && lines.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            성공 {okCount}개 {failCount > 0 && <span className="text-red-600">/ 실패 {failCount}개</span>}
          </p>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-zinc-400">
                  <th className="pb-1 font-medium">파일</th>
                  <th className="pb-1 font-medium">종류</th>
                  <th className="pb-1 font-medium">날짜/기간</th>
                  <th className="pb-1 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-t border-zinc-100 align-top">
                    <td className="py-1.5 text-zinc-800">{l.fileName}</td>
                    <td className="py-1.5 text-zinc-600">{l.kind}</td>
                    <td className="py-1.5 text-zinc-600">{l.period}</td>
                    <td className="py-1.5">
                      <span className={l.ok ? "text-zinc-600" : "text-red-600"} role={l.ok ? undefined : "alert"}>{l.body}</span>
                      {l.notes.map((n, i) => (
                        <div key={i} className="text-xs text-amber-600">{n}</div>
                      ))}
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
