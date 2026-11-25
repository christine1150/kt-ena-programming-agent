"use client";

// 라인업 저장·인쇄 설정 창(2026-11-25 사용자 요청) — 기간·채널·장르·요일·보기·용지를 골라
// ① 인쇄·PDF(/lineup/print — 용지에 맞춘 인쇄 화면, 인쇄 창에서 'PDF로 저장') ② 엑셀로 저장(/api/lineup/export — 편성센터 양식 격자 + 목록 시트).
// 지금 화면의 조건으로 미리 채워 둔다. 대외비 자료이므로 파일을 외부로 보내지 않도록 안내한다.
import { useEffect, useRef, useState } from "react";
import type { Genre } from "@/lib/lineup/types";
import { dowLabel, GENRE_LABEL, LENGTHS, lineupSearch, queryRange, type LineupQuery, type ViewMode } from "@/lib/lineup/viewModel";

const GENRES: Genre[] = ["drama", "variety", "business", "other"];
const DOWS = [1, 2, 3, 4, 5, 6, 7];

export default function SaveDialog({
  initial, defaultFrom, ownChannels, onClose,
}: { initial: LineupQuery; defaultFrom: string; ownChannels: { code: string; name: string }[]; onClose: () => void }) {
  const [q, setQ] = useState<LineupQuery>(initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<LineupQuery>) => setQ((s) => ({ ...s, ...patch }));
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const range = queryRange(q.from, q.len);
  // 인쇄·엑셀 주소 — 시작 월은 늘 싣는다(받는 쪽의 "지난달" 기본값이 날짜에 따라 달라지지 않게). 나머지 기본값은 받는 쪽과 같다.
  const search = new URLSearchParams(lineupSearch(q, "")).toString();

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"}`;
  const isCompare = q.view === "compare";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 p-4 pt-16 print:hidden" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lineup-save-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] rounded-xl bg-white p-5 text-[13px] text-zinc-800 shadow-2xl outline-none"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="lineup-save-title" className="text-[16px] font-bold text-zinc-900">
            라인업 저장·인쇄
          </h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-zinc-600 hover:bg-zinc-100">
            닫기
          </button>
        </div>

        <div className="space-y-3.5">
          <Field label="보기">
            {(
              [
                ["own", "KT ENA"],
                ["compare", "경쟁 비교"],
                ["list", "목록"],
              ] as [ViewMode, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={q.view === v}
                onClick={() =>
                  set({
                    view: v,
                    density: v === "compare" ? "compact" : q.density,
                    channels: v === "compare" ? q.channels.slice(0, 1) : q.channels,
                    genres: q.genres,
                  })
                }
                className={chip(q.view === v)}
              >
                {label}
              </button>
            ))}
          </Field>

          <Field label="기간">
            <input
              type="month"
              value={q.from}
              onChange={(e) => e.target.value && set({ from: e.target.value })}
              className="rounded border border-zinc-300 px-2 py-0.5 text-[13px]"
              aria-label="시작 월"
            />
            <span className="text-zinc-600">부터</span>
            {LENGTHS.map((n) => (
              <button key={n} type="button" aria-pressed={q.len === n} onClick={() => set({ len: n })} className={chip(q.len === n)}>
                {n === 12 ? "1년" : `${n}개월`}
              </button>
            ))}
            <span className="w-full text-[12px] text-zinc-600 tabular-nums">
              {range.from} ~ {range.to}
              {q.from !== defaultFrom && (
                <button type="button" onClick={() => set({ from: defaultFrom })} className="ml-2 underline underline-offset-2">
                  지난달부터로
                </button>
              )}
            </span>
          </Field>

          <Field label={isCompare ? "기준 채널" : "채널"}>
            {!isCompare && (
              <button type="button" aria-pressed={q.channels.length === 0} onClick={() => set({ channels: [] })} className={chip(q.channels.length === 0)}>
                라인업 있는 채널 전부
              </button>
            )}
            {ownChannels.map((c) => {
              const on = isCompare ? (q.channels.length ? q.channels : ["ENA"]).includes(c.code) : q.channels.includes(c.code);
              return (
                <button key={c.code} type="button" aria-pressed={on} onClick={() => set({ channels: isCompare ? [c.code] : toggle(q.channels, c.code) })} className={chip(on)}>
                  {c.name}
                </button>
              );
            })}
          </Field>

          <Field label="장르">
            <button type="button" aria-pressed={q.genres.length === 0} onClick={() => set({ genres: [] })} className={chip(q.genres.length === 0)}>
              전체
            </button>
            {GENRES.map((g) => (
              <button key={g} type="button" aria-pressed={q.genres.includes(g)} onClick={() => set({ genres: toggle(q.genres, g) })} className={chip(q.genres.includes(g))}>
                {GENRE_LABEL[g]}
              </button>
            ))}
          </Field>

          <Field label="요일">
            {DOWS.map((d) => (
              <button key={d} type="button" aria-pressed={q.dows.includes(d)} onClick={() => set({ dows: toggle(q.dows, d) })} className={`${chip(q.dows.includes(d))} px-2`}>
                {dowLabel([d])}
              </button>
            ))}
            {q.dows.length === 0 && <span className="text-[12px] text-zinc-600">전부</span>}
          </Field>

          {q.view !== "list" && (
            <Field label="인쇄">
              {(["A4", "A3"] as const).map((p) => (
                <button key={p} type="button" aria-pressed={q.paper === p} onClick={() => set({ paper: p })} className={chip(q.paper === p)}>
                  {p} 가로
                </button>
              ))}
              {(["comfy", "compact"] as const).map((d) => (
                <button key={d} type="button" aria-pressed={q.density === d} onClick={() => set({ density: d })} className={chip(q.density === d)}>
                  {d === "comfy" ? "넉넉" : "촘촘"}
                </button>
              ))}
              {q.len >= 12 && q.paper === "A4" && <span className="w-full text-[12px] text-zinc-600">1년은 A3가 읽기 쉽습니다(A4는 한 주가 좁아 제목이 각주로 많이 갑니다).</span>}
            </Field>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4">
          <a
            href={`/lineup/print?${search}`}
            target="_blank"
            rel="noopener"
            className="rounded bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zinc-700"
          >
            인쇄 · PDF로 저장
          </a>
          <a href={`/api/lineup/export?${search}`} className="rounded border border-zinc-300 px-3 py-1.5 text-[13px] font-medium hover:bg-zinc-50" download>
            엑셀로 저장
          </a>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-600">
          PDF는 새 창의 인쇄 화면에서 대상(프린터)을 ‘PDF로 저장’으로 고르면 됩니다. 엑셀은 편성센터 라인업과 같은 모양(주 칸 × 자리, 막대 = 병합 칸)과 목록 시트로 내려받습니다.
          <b className="font-semibold text-zinc-700"> 대외비 자료입니다 — 파일을 외부로 보내지 마세요.</b>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-start gap-2">
      <span className="pt-1 text-[12px] font-semibold text-zinc-600">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}
