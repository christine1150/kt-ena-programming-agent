"use client";
// 주간 비교 화면에 녹여 넣은 실제 편성표 업로드 칸(사용자 지시 2026-10-02: "주간비교 시청률 사이트 안에서 실제 편성표 업로드할 수
// 있는 칸도 하나, 너무 복잡하지 않게 지금 틀에 자연스럽게"). 시청률 자판기의 업로드 칸과 같은 업로드 API(/api/schedule-grid/upload)를
// 쓰며, 채널·주는 파일에서 자동 인식한다. 여러 파일을 한 번에 올리거나 끌어다 놓아도 되고, 같은 주를 다시 올리면 그 주가 새 파일로 교체된다.
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

export type UploadedSchedule = { channelCode: string; weekStart: string };
type Result = { file: string; ok: boolean; text: string };

export function ScheduleUploadSlot({ onUploaded }: { onUploaded: (done: UploadedSchedule[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  async function upload(files: File[]) {
    if (input.current) input.current.value = "";
    const list = files.filter((f) => /\.xlsx?$/i.test(f.name));
    if (!list.length) return setResults([{ file: "", ok: false, text: "엑셀 파일(.xlsx)만 올릴 수 있습니다." }]);
    const out: Result[] = [];
    const done: UploadedSchedule[] = [];
    for (const f of list) {
      setBusy(f.name);
      const fd = new FormData();
      fd.append("file", f);
      const j = await fetch("/api/schedule-grid/upload", { method: "POST", body: fd })
        .then((r) => r.json())
        .catch(() => ({ ok: false, message: "올리지 못했습니다." }));
      if (j.ok) {
        done.push({ channelCode: j.channelCode, weekStart: j.weekStart });
        out.push({ file: f.name, ok: true, text: `${CHANNEL_LABEL[j.channelCode] ?? j.channelCode} ${md(j.weekStart)}주 · ${j.rowsSaved}칸 저장` });
      } else out.push({ file: f.name, ok: false, text: j.message ?? "올리지 못했습니다." });
      setResults([...out]);
    }
    setBusy(null);
    if (done.length) onUploaded(done);
  }

  return (
    <div
      className="flex flex-col items-end gap-0.5"
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
      <button
        type="button"
        disabled={!!busy}
        onClick={() => input.current?.click()}
        title="실제 편성표 엑셀을 올리면 그 주 편성표에 시작 시각·회차·태그가 반영됩니다. 채널·주는 파일에서 자동 인식하고, 같은 주를 다시 올리면 새 파일로 바뀝니다."
        className={`flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
          drag ? "border-zinc-800 bg-zinc-100 text-zinc-800" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500 hover:bg-zinc-50"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        {busy ? `올리는 중… ${busy}` : drag ? "여기에 놓으세요" : "실제 편성표 올리기"}
      </button>
      <input ref={input} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={(e) => void upload([...(e.target.files ?? [])])} />
      {results.length > 0 && (
        <ul className="space-y-px text-right text-[11px]">
          {results.map((r, i) => (
            <li key={i} className={r.ok ? "text-emerald-700" : "text-rose-600"} title={r.file}>
              {r.ok ? "✓" : "✕"} {r.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
