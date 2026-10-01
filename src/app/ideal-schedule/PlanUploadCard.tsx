"use client";
// 실제 편성표 업로드 칸(사용자 지시 2026-10-01: "이 페이지에서 실제 편성표를 업로드할 수 있도록 편성표 업로드 칸을 하나
// 만들어줘"). 편성표 검토 화면과 같은 업로드 API를 쓰며, 채널·주는 파일에서 자동 인식한다. 여러 채널 파일을 한 번에
// 끌어다 놓아도 되고, 같은 주를 다시 올리면(수정안) 그 주 편성표가 새 파일로 바뀐다.
import { useRef, useState } from "react";

const CHANNEL_LABEL: Record<string, string> = {
  ENA: "ENA",
  ENA_DRAMA: "ENA DRAMA",
  ENA_PLAY: "ENA PLAY",
  ENA_STORY: "ENA STORY",
  OLIFE: "OLIFE",
  ONCE: "ONCE",
  SKYUHD: "skyUHD",
};
const md = (d: string) => d.slice(5).replace("-", "/");

type Result = { file: string; ok: boolean; text: string };

export function PlanUploadCard({
  channelCode,
  planWeeks,
  weekStart,
  onUploaded,
}: {
  channelCode: string;
  planWeeks: string[];
  weekStart: string;
  onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  async function upload(files: File[]) {
    if (input.current) input.current.value = "";
    const list = files.filter((f) => /\.xlsx?$/i.test(f.name));
    if (!list.length) return setResults([{ file: "", ok: false, text: "엑셀 파일(.xlsx)만 올릴 수 있습니다." }]);
    const out: Result[] = [];
    let mine = false;
    for (const f of list) {
      setBusy(f.name);
      const fd = new FormData();
      fd.append("file", f);
      const j = await fetch("/api/schedule-grid/upload", { method: "POST", body: fd })
        .then((r) => r.json())
        .catch(() => ({ ok: false, message: "올리지 못했습니다." }));
      if (j.ok) {
        const other = j.channelCode !== channelCode;
        mine ||= !other;
        out.push({ file: f.name, ok: true, text: `${CHANNEL_LABEL[j.channelCode] ?? j.channelCode} ${md(j.weekStart)}주 · ${j.rowsSaved}칸 저장${other ? " (그 채널 화면에서 쓰입니다)" : ""}` });
      } else out.push({ file: f.name, ok: false, text: j.message ?? "올리지 못했습니다." });
      setResults([...out]);
    }
    setBusy(null);
    if (mine) onUploaded();
  }

  const hasTarget = planWeeks.includes(weekStart);
  const help = `채널·주는 파일에서 자동 인식 · 여러 채널 한 번에 가능 · 같은 주를 다시 올리면 새 파일로 교체. ${
    hasTarget ? "선택한 주 편성표가 있어 그 편성을 기존 틀로 쓰고 회차를 붙입니다." : "선택한 주 편성표가 없으면 이전 주 편성표의 회차 흐름을 이어 붙입니다."
  } 기대 시청률은 최근 3달 실적으로만 계산합니다.`;
  // 작게(사용자 지시 2026-10-01: 칸이 커서 뽑기 조건을 보기 어렵다) — 한 줄 + 올린 주 칩, 설명은 마우스를 올리면
  return (
    <section
      className={`rounded-2xl border bg-white px-4 py-2.5 transition ${drag ? "border-zinc-800 bg-zinc-50" : "border-zinc-200"}`}
      title={help}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-800">실제 편성표</h2>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => input.current?.click()}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-400 px-2.5 py-0.5 text-xs font-medium text-zinc-700 hover:border-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
          {busy ? "올리는 중…" : "엑셀 올리기"}
        </button>
      </div>
      <input ref={input} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={(e) => void upload([...(e.target.files ?? [])])} />
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
        {planWeeks.length ? (
          planWeeks.map((w) => (
            <span key={w} className={`rounded-full px-1.5 py-px tabular-nums ${w === weekStart ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}>
              {md(w)}주
            </span>
          ))
        ) : (
          <span>올린 편성표 없음 · 파일을 이 칸에 끌어다 놓아도 됩니다</span>
        )}
      </div>
      {results.length > 0 && (
        <ul className="mt-1 space-y-px text-[11px]">
          {results.map((r, i) => (
            <li key={i} className={`truncate ${r.ok ? "text-emerald-700" : "text-rose-600"}`} title={r.file}>
              {r.ok ? "✓" : "✕"} {r.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
