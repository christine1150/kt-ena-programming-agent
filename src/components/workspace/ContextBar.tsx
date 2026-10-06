"use client";

// 공통 ContextBar(단계 07) — 채널/타깃/분석기간/비교기간/최신데이터/잠정·확정 상태를 한 줄로 보여 주고,
// 값이 아직 이전 선택의 것(stale)이거나 실패했으면 배너로 알린다. 표시 내용은 contextBar.ts(순수 모델)가 정한다.
import type { ReactNode } from "react";
import type { ContextBarModel, ContextChip } from "@/lib/workspace/contextBar";

const CHIP_TONE: Record<ContextChip["tone"], string> = {
  normal: "bg-white text-zinc-800 ring-zinc-200",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  muted: "bg-zinc-50 text-zinc-500 ring-zinc-200",
};
const BANNER_TONE = {
  info: "bg-sky-50 text-sky-800 ring-sky-100",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  error: "bg-red-50 text-red-800 ring-red-200",
} as const;

export default function ContextBar({ model, right, className = "" }: { model: ContextBarModel; right?: ReactNode; className?: string }) {
  return (
    <div className={className} data-context-bar>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" role="group" aria-label="분석 문맥">
        {model.chips.map((c) => (
          <span key={c.id} title={c.title} className={`inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 text-[12px] ring-1 ${CHIP_TONE[c.tone]}`} data-chip={c.id}>
            <span className="text-[10.5px] font-medium text-zinc-400">{c.label}</span>
            <span className="font-semibold tabular-nums">{c.value}</span>
          </span>
        ))}
        {right && <span className="ml-auto flex items-center gap-2">{right}</span>}
      </div>
      {model.banner && (
        <p role="status" aria-live="polite" className={`mt-2 rounded-lg px-3 py-2 text-[13px] ring-1 ${BANNER_TONE[model.banner.tone]}`}>
          {model.banner.text}
        </p>
      )}
    </div>
  );
}
