"use client";

// PD 수동 회차 리포트 업로드 위젯 — 사용자 지시(2026-08-26): "1페이지 <주요 컨텐츠 리뷰>는 내가 작성한 보고서
// 내용으로 덮어써서 반영하자." PD가 직접 작성한 회차 리포트를 올리면 그 안의 분당 시청률·헤드라인 문구·동시간대
// 경쟁 정보·동시간대 순위를 저장해 Page 1이 자동 계산 대신 우선 보여준다.
//
// 단순화(사용자 지시 2026-10-06): "업로드 단계가 2개(파일 선택 → 업로드 버튼)이고 채널 선택은 굳이 할 필요가 없으니
// 업로드하는 틀을 단순히." 이제 파일을 고르거나 끌어다 놓는 즉시 올라간다(여러 파일 가능). 채널은 리포트 안의
// 채널명(예: "ENA 수도권 2049")에서 서버가 자동 인식하고, 파일에서 못 찾을 때만 채널 선택칸이 나타난다.
// 양식(오리지널 드라마 / 오리지널 예능)도 자동 판별한다 — 드라마 양식으로 먼저 시도하고, 그 양식이 아니면 예능
// 양식으로 재시도한다(두 파서 모두 "이 양식이 아니다"를 명확히 거부하므로 잘못된 양식이 조용히 저장되지 않는다).
// 저장 대상은 같은 테이블(program_manual_reports)이라 같은 컨텐츠를 다시 올리면 최신 내용으로 덮어쓴다.
import { useEffect, useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type Channel = { id: string; code: string; name: string };
type SavedEpisode = { episodeNumber: number; broadcastDate: string; canonicalNameNormalized: string; programName?: string | null; channelCode: string };
type ReportFormat = "drama" | "original";
type UploadResult = { fileName: string; ok: boolean; saved?: SavedEpisode[]; format?: ReportFormat; message?: string };

const FORMAT_LABEL: Record<ReportFormat, string> = {
  drama: "오리지널 드라마 양식",
  original: "오리지널 예능 양식",
};
const ENDPOINT: Record<ReportFormat, string> = {
  drama: "/api/admin/upload/manual-drama-report",
  original: "/api/admin/upload/manual-original-report",
};

export default function ManualReportUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  // 파일에서 채널을 찾지 못해 사용자의 채널 선택을 기다리는 파일
  const [pending, setPending] = useState<File[] | null>(null);
  // 사용자 지시(2026-08-26): "중CM1/중CM2" 등 광고 브레이크 시각 — PD 엑셀의 네이티브 차트 텍스트 상자로만 있어
  // 자동 파싱이 불가능하다(supabase/migrations/20260826190000 참고). 업로드 직후 관리자가 그 차트를 육안으로 보고
  // 한 줄씩 입력하면 별도 PATCH로 저장한다(선택 사항).
  const [cmBreaksText, setCmBreaksText] = useState<Record<string, string>>({});
  const [cmBreaksSaving, setCmBreaksSaving] = useState<string | null>(null);
  const [cmBreaksMessage, setCmBreaksMessage] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/channels")
      .then((r) => r.json())
      .then((body) => setChannels(Array.isArray(body) ? body : (body.channels ?? [])))
      .catch(() => setChannels([]));
  }, []);

  const channelName = (code: string) => channels.find((c) => c.code === code)?.name ?? code;

  async function postTo(format: ReportFormat, file: File, channelCode?: string) {
    const formData = new FormData();
    formData.append("file", file);
    if (channelCode) formData.append("channelCode", channelCode);
    const res = await fetch(ENDPOINT[format], { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    return { ok: res.ok && body.ok === true, body } as { ok: boolean; body: { saved?: SavedEpisode[]; message?: string; needChannel?: boolean } };
  }

  async function uploadFiles(files: File[], channelCode?: string) {
    setUploading(true);
    setPending(null);
    const done: UploadResult[] = [];
    const waiting: File[] = [];
    for (const file of files) {
      if (!/\.xlsx$/i.test(file.name)) {
        done.push({ fileName: file.name, ok: false, message: "엑셀(.xlsx) 파일만 올릴 수 있습니다." });
        continue;
      }
      const drama = await postTo("drama", file, channelCode);
      if (drama.ok) {
        done.push({ fileName: file.name, ok: true, saved: drama.body.saved ?? [], format: "drama" });
        continue;
      }
      const original = await postTo("original", file, channelCode);
      if (original.ok) {
        done.push({ fileName: file.name, ok: true, saved: original.body.saved ?? [], format: "original" });
        continue;
      }
      if (drama.body.needChannel || original.body.needChannel) {
        waiting.push(file);
        continue;
      }
      done.push({
        fileName: file.name,
        ok: false,
        message: `어느 양식으로도 읽지 못했습니다.\n· ${FORMAT_LABEL.drama}: ${drama.body.message ?? "실패"}\n· ${FORMAT_LABEL.original}: ${original.body.message ?? "실패"}`,
      });
    }
    setResults((prev) => [...(channelCode ? prev : []), ...done]);
    if (waiting.length > 0) setPending(waiting);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
  }

  // "HH:MM 라벨" 한 줄씩(예: "22:38 중CM1") → [{time,label}]. 형식이 안 맞는 줄은 조용히
  // 건너뛴다(억지로 추정하지 않음 — 관리자가 다시 고쳐 쓰면 됨).
  function parseCmBreaksText(text: string): { time: string; label: string }[] {
    return text
      .split("\n")
      .map((line) => {
        const m = line.trim().match(/^(\d{1,2}:\d{2})\s+(.+)$/);
        if (!m) return null;
        const [h, mm] = m[1].split(":");
        return { time: `${h.padStart(2, "0")}:${mm}`, label: m[2].trim() };
      })
      .filter((v): v is { time: string; label: string } => v !== null);
  }

  async function saveCmBreaks(episode: SavedEpisode) {
    const key = `${episode.channelCode}-${episode.broadcastDate}-${episode.episodeNumber}`;
    setCmBreaksSaving(key);
    setCmBreaksMessage((prev) => ({ ...prev, [key]: "" }));
    const cmBreaks = parseCmBreaksText(cmBreaksText[key] ?? "");
    // PATCH는 program_manual_reports.cm_breaks만 갱신하고 양식을 따지지 않으므로, 어느 양식으로
    // 저장된 회차든 이 엔드포인트 하나로 처리된다.
    const res = await fetch(ENDPOINT.drama, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelCode: episode.channelCode, canonicalNameNormalized: episode.canonicalNameNormalized, broadcastDate: episode.broadcastDate, cmBreaks }),
    });
    const body = await res.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }));
    setCmBreaksMessage((prev) => ({ ...prev, [key]: !res.ok || !body.ok ? (body.message ?? "저장 실패") : `저장 완료(${cmBreaks.length}건)` }));
    setCmBreaksSaving(null);
  }

  const savedEpisodes = results.flatMap((r) => (r.ok ? (r.saved ?? []) : []));

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">PD 수동 회차 리포트 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        엑셀 리포트를 올리면 채널·프로그램·회차를 자동으로 인식해 1페이지 주요 콘텐츠 리뷰에 반영합니다. 같은 회차를 다시 올리면 최신 내용으로
        덮어씁니다.
      </p>

      <FileInputTrigger inputRef={fileInputRef} accept=".xlsx" multiple onFiles={(files) => void uploadFiles(files)} />
      {uploading && <p className="mt-3 text-sm text-zinc-500">올리는 중...</p>}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>파일에서 채널을 찾지 못했습니다({pending.map((f) => f.name).join(", ")}). 채널을 고르면 바로 올립니다.</span>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void uploadFiles(pending, e.target.value);
            }}
            className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-sm text-zinc-700"
          >
            <option value="">채널 선택</option>
            {channels.map((c) => (
              <option key={c.id} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((r, i) =>
            r.ok ? (
              (r.saved ?? []).map((s) => (
                <li key={`${i}-${s.channelCode}-${s.broadcastDate}-${s.episodeNumber}`} className="text-emerald-700">
                  ✓ {s.programName ? `<${s.programName}> ` : ""}
                  {s.episodeNumber}회 · {s.broadcastDate} · {channelName(s.channelCode)}
                  {r.format && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{FORMAT_LABEL[r.format]}</span>}
                </li>
              ))
            ) : (
              <li key={i} className="whitespace-pre-line text-red-600">
                ✕ {r.fileName}: {r.message}
              </li>
            )
          )}
        </ul>
      )}

      {/* 광고 브레이크(중CM) 시각은 엑셀 안 차트를 눈으로 보고 입력해야 해서(자동 파싱 불가) 선택 항목으로만 둔다 */}
      {savedEpisodes.length > 0 && (
        <div className="mt-3 space-y-2">
          {savedEpisodes.map((s) => {
            const key = `${s.channelCode}-${s.broadcastDate}-${s.episodeNumber}`;
            return (
              <details key={key} className="rounded-xl bg-zinc-50 p-3">
                <summary className="cursor-pointer text-xs font-medium text-zinc-500">
                  {s.programName ? `${s.programName} ` : ""}
                  {s.episodeNumber}회 — 광고 브레이크 시각 입력(선택)
                </summary>
                <textarea
                  value={cmBreaksText[key] ?? ""}
                  onChange={(e) => setCmBreaksText((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={"한 줄에 하나씩, \"HH:MM 라벨\" 형식 — 예:\n22:38 중CM1\n22:54 중CM2"}
                  rows={3}
                  className="mb-2 mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveCmBreaks(s)}
                    disabled={cmBreaksSaving === key}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {cmBreaksSaving === key ? "저장 중..." : "저장"}
                  </button>
                  {cmBreaksMessage[key] && <span className="text-xs text-zinc-500">{cmBreaksMessage[key]}</span>}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
