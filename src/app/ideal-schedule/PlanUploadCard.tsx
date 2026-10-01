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
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-800">실제 편성표 올리기</h2>
      <button
        type="button"
        disabled={!!busy}
        onClick={() => input.current?.click()}
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
        className={`mt-2 flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-3 py-4 text-center transition disabled:opacity-60 ${
          drag ? "border-zinc-800 bg-zinc-50" : "border-zinc-300 hover:border-zinc-500 hover:bg-zinc-50"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <span className="text-sm font-medium text-zinc-700">{busy ? `올리는 중… ${busy}` : "주간 편성표 엑셀을 끌어다 놓거나 눌러서 고르세요"}</span>
        <span className="text-[11px] text-zinc-400">채널·주는 파일에서 자동 인식 · 여러 채널 한 번에 가능 · 같은 주를 다시 올리면 새 파일로 교체</span>
      </button>
      <input ref={input} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={(e) => void upload([...(e.target.files ?? [])])} />

      {results.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px]">
          {results.map((r, i) => (
            <li key={i} className={r.ok ? "text-emerald-700" : "text-rose-600"} title={r.file}>
              {r.ok ? "✓" : "✕"} {r.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 text-[11px] text-zinc-500">
        {planWeeks.length ? (
          <div className="flex flex-wrap items-center gap-1">
            <span>올린 편성표</span>
            {planWeeks.map((w) => (
              <span key={w} className={`rounded-full px-1.5 py-0.5 tabular-nums ${w === weekStart ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}>
                {md(w)}주
              </span>
            ))}
          </div>
        ) : (
          <span>이 채널은 아직 올린 편성표가 없습니다.</span>
        )}
        <p className="mt-1 text-zinc-400">
          {hasTarget
            ? "선택한 주 편성표가 있어 그 편성을 기존 틀로 쓰고 회차를 붙입니다."
            : "선택한 주 편성표가 없으면 이전 주 편성표의 회차 흐름을 이어 붙입니다."}{" "}
          기대 시청률은 최근 3달 실적으로만 계산합니다.
        </p>
      </div>
    </section>
  );
}
