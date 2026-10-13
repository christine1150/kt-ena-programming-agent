"use client";
// 경쟁 채널 편성 자료 올리기(사용자 지시 2026-10-13: PD 담당 채널 ENA PLAY 에서 엑셀로). 순서: 양식 받기 → 파일 선택(자동 미리보기) → 확인 후 반영.
// 같은 경쟁채널·같은 방송일을 다시 올리면 그 날짜는 새 파일 내용으로 바뀌므로, 미리보기에서 바뀔 건수를 먼저 보여 준다.
import { useCallback, useEffect, useRef, useState } from "react";
import { CHANNEL_LABEL } from "@/lib/competitorAirings/scope";

interface Preview {
  fileName: string;
  sheetName: string;
  totalRows: number;
  acceptedRows: number;
  rejectedCount: number;
  rejected: { rowNo: number; reason: string }[];
  skippedExamples: number;
  competitors: { name: string; registered: boolean; rows: number; from: string; to: string; withRating: number }[];
  unregistered: { name: string; rows: number }[];
  withRating: number;
  withoutRating: number;
  period: { from: string; to: string } | null;
  storageReady: boolean;
  replaceExisting: number | null;
  targetNote: string | null;
}
interface Status {
  totalRows: number;
  dateFrom: string | null;
  dateTo: string | null;
  recent: { fileName: string | null; uploadedAt: string; rowCount: number; competitorCount: number; dateFrom: string | null; dateTo: string | null }[];
}

const md = (d: string | null) => (d ? d.slice(2).replace(/-/g, ".") : "-");
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function CompetitorAiringUploadCard({ channelCode }: { channelCode: string }) {
  const label = CHANNEL_LABEL[channelCode.toUpperCase()] ?? channelCode;
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [allowUnregistered, setAllowUnregistered] = useState(false);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  const fetchStatus = useCallback(() => fetch(`/api/competitor-airings?channel=${channelCode}`).then((r) => r.json()).catch(() => null), [channelCode]);
  const applyStatus = useCallback((j: (Status & { ok?: boolean; message?: string }) | null) => {
    if (j?.ok) setStatus(j);
    else if (j?.message) setNotice({ ok: false, text: j.message });
  }, []);
  useEffect(() => {
    let alive = true;
    void fetchStatus().then((j) => {
      if (alive) applyStatus(j);
    });
    return () => {
      alive = false;
    };
  }, [fetchStatus, applyStatus]);

  async function send(f: File, mode: "preview" | "commit", allow: boolean) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("channelCode", channelCode);
    fd.append("mode", mode);
    fd.append("allowUnregistered", String(allow));
    return fetch("/api/competitor-airings", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, message: "서버에 연결하지 못했습니다." }));
  }

  async function pick(f: File | undefined) {
    if (input.current) input.current.value = "";
    if (!f) return;
    setFile(f);
    setPreview(null);
    setNotice(null);
    setAllowUnregistered(false);
    setBusy("preview");
    const j = await send(f, "preview", false);
    setBusy(null);
    if (j.ok) setPreview(j);
    else setNotice({ ok: false, text: j.message ?? "파일을 확인하지 못했습니다." });
  }

  async function changeAllow(next: boolean) {
    setAllowUnregistered(next);
    if (!file) return;
    setBusy("preview");
    const j = await send(file, "preview", next); // 미등록 포함 여부에 따라 바뀔 건수가 달라지므로 다시 계산한다.
    setBusy(null);
    if (j.ok) setPreview(j);
  }

  async function commit() {
    if (!file) return;
    setBusy("commit");
    const j = await send(file, "commit", allowUnregistered);
    setBusy(null);
    if (j.ok) {
      setNotice({ ok: true, text: `${j.saved.toLocaleString()}건을 반영했습니다${j.removed ? ` (같은 날짜의 기존 ${j.removed.toLocaleString()}건은 새 내용으로 바뀜)` : ""}.` });
      setFile(null);
      setPreview(null);
      void fetchStatus().then(applyStatus);
    } else setNotice({ ok: false, text: j.message ?? "반영하지 못했습니다." });
  }

  return (
    <section className="mx-auto mt-8 max-w-6xl px-4 pb-10" aria-labelledby="comp-airing-title">
      <details className="rounded-xl border border-zinc-200 bg-white p-4 open:shadow-sm">
        <summary id="comp-airing-title" className="cursor-pointer text-sm font-semibold text-zinc-800">
          경쟁 채널 편성 자료 올리기 · {label}
          <span className="ml-2 font-normal text-zinc-500">
            {status ? (status.totalRows ? `${status.totalRows.toLocaleString()}건 · ${md(status.dateFrom)} ~ ${md(status.dateTo)}` : "아직 올린 자료 없음") : ""}
          </span>
        </summary>

        <div className="mt-3 space-y-3 text-sm text-zinc-700">
          <p>
            경쟁 채널의 방송일·시작 시각·프로그램(·시청률) 엑셀을 올립니다. 시청률은 비워 두면 편성 예정으로 저장됩니다. 같은 경쟁채널·같은 방송일을 다시 올리면 그 날짜는 새 파일 내용으로 바뀝니다.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/competitor-airings/template?channel=${channelCode}`} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50">
              양식 내려받기
            </a>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
              className="rounded-lg border border-zinc-800 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {busy === "preview" ? "확인 중..." : "엑셀 선택"}
            </button>
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} aria-label="경쟁 채널 편성 엑셀 파일 선택" />
            {file && <span className="text-xs text-zinc-500">{file.name}</span>}
          </div>

          <div role="status" aria-live="polite">
            {notice && <p className={notice.ok ? "text-emerald-700" : "text-red-700"}>{notice.text}</p>}
          </div>

          {preview && (
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="font-medium text-zinc-800">
                미리보기 · 반영 대상 {preview.acceptedRows.toLocaleString()}건 / 읽은 {preview.totalRows.toLocaleString()}줄
                {preview.period && ` · ${md(preview.period.from)} ~ ${md(preview.period.to)}`}
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-zinc-600">
                <li>시청률 있음 {preview.withRating.toLocaleString()}건 · 편성 예정/미집계(시청률 없음) {preview.withoutRating.toLocaleString()}건</li>
                {preview.replaceExisting === null ? (
                  <li className="text-amber-700">저장소가 아직 준비되지 않아(마이그레이션 적용 대기) 지금은 미리보기만 할 수 있습니다. 반영은 적용 후에 가능합니다.</li>
                ) : (
                  <li className={preview.replaceExisting ? "text-amber-700" : ""}>
                    같은 경쟁채널·방송일의 기존 {preview.replaceExisting.toLocaleString()}건이 이 파일 내용으로 바뀝니다.
                  </li>
                )}
                {preview.targetNote && <li>{preview.targetNote}</li>}
                {preview.skippedExamples > 0 && <li>예시 줄 {preview.skippedExamples}개는 무시했습니다.</li>}
              </ul>

              <table className="w-full text-left text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">경쟁채널</th>
                    <th className="py-1 pr-2 font-medium">건수</th>
                    <th className="py-1 pr-2 font-medium">기간</th>
                    <th className="py-1 font-medium">시청률 입력</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.competitors.map((c) => (
                    <tr key={c.name} className="border-t border-zinc-200">
                      <td className="py-1 pr-2">
                        {c.name}
                        {!c.registered && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">미등록</span>}
                      </td>
                      <td className="py-1 pr-2">{c.rows.toLocaleString()}</td>
                      <td className="py-1 pr-2">
                        {md(c.from)} ~ {md(c.to)}
                      </td>
                      <td className="py-1">{c.withRating.toLocaleString()}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {preview.unregistered.length > 0 && (
                <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                  <input type="checkbox" checked={allowUnregistered} disabled={busy !== null} onChange={(e) => void changeAllow(e.target.checked)} className="mt-0.5" />
                  <span>
                    채널 기본정보에 등록되지 않은 경쟁채널({preview.unregistered.map((u) => `${u.name} ${u.rows}건`).join(", ")})도 반영합니다. 이름이 오타가 아닌지 확인해 주세요. 체크하지 않으면 이 줄들은 반영되지 않습니다.
                  </span>
                </label>
              )}

              {preview.rejectedCount > 0 && (
                <details className="text-xs text-red-700">
                  <summary className="cursor-pointer">반영하지 않는 줄 {preview.rejectedCount.toLocaleString()}건 (사유 보기)</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {preview.rejected.map((r) => (
                      <li key={r.rowNo}>
                        {r.rowNo}행: {r.reason}
                      </li>
                    ))}
                    {preview.rejectedCount > preview.rejected.length && <li>그 밖에 {preview.rejectedCount - preview.rejected.length}건 더 있습니다.</li>}
                  </ul>
                </details>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy !== null || preview.acceptedRows === 0 || !preview.storageReady}
                  onClick={() => void commit()}
                  className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {busy === "commit" ? "반영 중..." : `${preview.acceptedRows.toLocaleString()}건 반영하기`}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setPreview(null);
                    setFile(null);
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {status && status.recent.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-zinc-500">최근 반영</p>
              <ul className="space-y-0.5 text-xs text-zinc-600">
                {status.recent.map((b, i) => (
                  <li key={i}>
                    {when(b.uploadedAt)} · {b.fileName ?? "파일"} · {b.rowCount.toLocaleString()}건 · 경쟁채널 {b.competitorCount}개 · {md(b.dateFrom)} ~ {md(b.dateTo)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
