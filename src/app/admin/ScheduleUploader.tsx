"use client";

// 사용자 지시(2026-11-24): "OLIFE EPG 업로드"와 "주간 편성표 업로드"를 하나로 합쳐 "편성표 업로드"로.
// 파일 선택칸 하나에 올리면 파일마다 알맞은 서버 경로로 보낸다(서버 API는 그대로).
//  · 파일명에 "일일운행표"가 있으면 OLIFE EPG(일일운행표)   → /api/admin/upload/olife-epg
//  · 그 외 편성표 엑셀은 채널·주차를 자동 인식하는 주간 편성표 → /api/admin/upload/schedule-grid
//    (주간 편성표로 읽지 못하면 OLIFE EPG 경로(일일운행표·OLIFE 주간 달력 형식)로 한 번 더 시도한다)
// 옛 OlifeEpgUploader·ScheduleGridUploader 는 trash-can/ 으로 옮겼다.
import { useRef, useState } from "react";
import Link from "next/link";
import HelpTip from "./HelpTip";
import { FileInputTrigger } from "./FileInputTrigger";

type GridOutcome = { channelCode?: string; weekStart?: string; weekEnd?: string; rowsSaved?: number; rowsMatched?: number | null };
type EpgQueueItem = { date: string; programName: string; startTime: string; status: "ambiguous" | "unmatched"; reason: string; candidates: { title: string; startTime: string; episodeNumber: number | null; subtitle: string | null; diffMinutes: number; nameMatch: "exact" | "partial" }[] };
type EpgOutcome = {
  message?: string;
  datesProcessed?: string[];
  matchedCount?: number;
  unmatchedCount?: number;
  ambiguousCount?: number;
  unmatchedQueue?: EpgQueueItem[];
  sourceFormat?: "daily_epg" | "weekly_schedule";
};

type Outcome = {
  fileName: string;
  ok: boolean;
  via: "grid" | "epg";
  message?: string;
  grid?: GridOutcome;
  epg?: EpgOutcome;
};

const EPG_FORMAT_LABEL: Record<string, string> = { daily_epg: "일일운행표", weekly_schedule: "주간 편성표(OLIFE)" };

async function postGrid(file: File): Promise<Outcome> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/admin/upload/schedule-grid", { method: "POST", body: fd });
    const body = await res.json();
    return { fileName: file.name, ok: res.ok && body.ok === true, via: "grid", message: body.message, grid: body };
  } catch {
    return { fileName: file.name, ok: false, via: "grid", message: "업로드 중 오류가 발생했습니다." };
  }
}

async function postEpg(file: File): Promise<Outcome> {
  const fd = new FormData();
  fd.append("files", file);
  try {
    const res = await fetch("/api/admin/upload/olife-epg", { method: "POST", body: fd });
    const body = await res.json();
    if (!res.ok || !body.ok) return { fileName: file.name, ok: false, via: "epg", message: body.message ?? "업로드에 실패했습니다." };
    const r = body.files?.[0] as (EpgOutcome & { ok: boolean }) | undefined;
    if (!r) return { fileName: file.name, ok: false, via: "epg", message: "업로드 응답을 읽지 못했습니다." };
    return { fileName: file.name, ok: r.ok, via: "epg", message: r.message, epg: r };
  } catch {
    return { fileName: file.name, ok: false, via: "epg", message: "업로드 중 오류가 발생했습니다." };
  }
}

export default function ScheduleUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleUpload() {
    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) {
      setErrorMessage("업로드할 파일을 먼저 선택해주세요.");
      return;
    }
    setUploading(true);
    setErrorMessage(null);
    setOutcomes(null);
    const results: Outcome[] = [];
    for (const file of files) {
      if (/일일\s*운행표/.test(file.name)) {
        results.push(await postEpg(file));
        continue;
      }
      const g = await postGrid(file);
      if (g.ok) {
        results.push(g);
        continue;
      }
      // 주간 편성표로 읽히지 않으면 OLIFE EPG 경로로 한 번 더 — 둘 다 실패하면 두 사유를 함께 보여 준다
      const e = await postEpg(file);
      results.push(e.ok ? e : { ...e, message: `주간 편성표로 읽지 못함 — ${g.message ?? "사유 없음"} / OLIFE EPG로도 읽지 못함 — ${e.message ?? "사유 없음"}` });
    }
    setOutcomes(results);
    setUploading(false);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">
          편성표 업로드
          <HelpTip>
            편성표 엑셀을 한 곳에서 올립니다. 여러 파일을 섞어서 선택해도 파일마다 알맞게 처리합니다.
            <br />
            <b>주간 편성표</b> — 방송사 주간 편성표 엑셀을 올리면 채널·주차를 자동 인식해 저장하고, 이미 적재된 시청률과 매칭합니다. 여러 주를 한 번에 선택할 수 있습니다.
            <br />
            <b>OLIFE EPG</b> <code>일일운행표_YYYYMMDD.xlsx</code> — 그 날짜의 Nielsen 프로그램 데이터에 회차·부제를 매칭해 채웁니다. 순서는 상관없습니다
            (Nielsen 일일 데이터가 먼저 있으면 즉시 매칭, EPG를 먼저 올리면 저장해 두었다가 그 날짜 Nielsen 파일이 올라올 때 자동 매칭). 시작시간이 ±60분
            이내이고 프로그램명이 일치하는 항목을 찾으며, 못 찾은 방영분은 비워 둡니다. 일일운행표가 없는 날은 OLIFE 주간 편성표(요일×시간 달력 형식)로
            대신할 수 있고, 같은 날짜에 일일운행표가 나중에 올라오면 그쪽이 항상 우선 적용됩니다.
          </HelpTip>
        </h2>
        <Link href="/admin/schedule-grid" className="text-sm font-medium text-zinc-500 underline hover:text-zinc-700">
          업로드된 편성표 보기
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-3">
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

      {errorMessage && <p className="text-sm text-red-600" role="alert">{errorMessage}</p>}

      {outcomes && (
        <ul className="flex flex-col gap-2">
          {outcomes.map((o, i) => (
            <li key={i} className={`rounded-lg px-3 py-2 text-sm ${o.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
              <span className="font-medium">{o.fileName}</span>
              {o.ok && o.via === "grid" && o.grid && (
                <>
                  <span className="ml-1 text-xs opacity-70">[주간 편성표]</span> — {o.grid.channelCode} {o.grid.weekStart}~{o.grid.weekEnd}, {o.grid.rowsSaved}건 저장
                  {typeof o.grid.rowsMatched === "number" && `(시청률 매칭 ${o.grid.rowsMatched}건)`}
                  {o.grid.weekStart && (
                    <>
                      {" "}
                      <Link href={`/admin/schedule-grid?channel=${o.grid.channelCode}&week=${o.grid.weekStart}`} className="underline">
                        보기
                      </Link>
                    </>
                  )}
                </>
              )}
              {o.ok && o.via === "epg" && o.epg && (
                <>
                  <span className="ml-1 text-xs opacity-70">[OLIFE EPG{o.epg.sourceFormat ? ` · ${EPG_FORMAT_LABEL[o.epg.sourceFormat]}` : ""}]</span> —{" "}
                  {o.epg.message ?? `${o.epg.datesProcessed?.join(", ")} — 매칭 ${o.epg.matchedCount}건, 미매칭 ${o.epg.unmatchedCount}건, 모호(가까운 후보로 채움·확인 필요) ${o.epg.ambiguousCount ?? 0}건`}
                  {o.epg.unmatchedQueue && o.epg.unmatchedQueue.length > 0 && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer font-medium">미매칭·모호 목록 {o.epg.unmatchedQueue.length}건 (미매칭은 비워 둠, 모호는 가까운 후보로 채움)</summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {o.epg.unmatchedQueue.map((q, qi) => (
                          <li key={qi} className="rounded bg-white/60 p-1.5">
                            <b>{q.date} {q.startTime} {q.programName}</b> — {q.status === "ambiguous" ? "모호(채움)" : "미매칭(비움)"}: {q.reason}
                            {q.candidates.map((c, ci) => (
                              <div key={ci} className="pl-2 opacity-80">
                                후보 {c.title} · {c.startTime} · 시각 차이 {c.diffMinutes}분 · {c.nameMatch === "exact" ? "이름 일치" : "이름 부분 일치"}
                                {c.episodeNumber !== null ? ` · ${c.episodeNumber}회` : ""}
                                {c.subtitle ? ` · 부제 ${c.subtitle}` : ""}
                              </div>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
              {!o.ok && <> — {o.message}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
