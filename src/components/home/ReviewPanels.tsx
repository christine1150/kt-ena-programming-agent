"use client";

// 1페이지 "주요 컨텐츠 리뷰" 프로그램 카드의 접힘 패널 — 사용자 지시(2026-10-07): "자세한 내용은 접힌 걸 열면 보이게, 한눈에는 너무 크지 않게".
// 디자인 전문가 설계안: 칩 3개를 한 줄에 두고 한 번에 하나만 펼친다(<details> 3개를 세로로 쌓으면 요약줄만 100px). 닫힌 패널은 렌더하지 않아
// 분당 그래프 같은 무거운 차트가 열기 전에는 그려지지 않는다. 칩은 모바일 44px 높이, aria-expanded/aria-controls 연결.
import { useId, useState, type ReactNode } from "react";

export interface ReviewPanelItem {
  key: string;
  label: string;
  /** 열어 볼 이유를 한눈에 알려 주는 짧은 문구(예: "최고 22:41 0.719%") */
  teaser?: string;
  body: ReactNode;
}

export default function ReviewPanels({ items, accent }: { items: ReviewPanelItem[]; accent: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const baseId = useId();
  const cur = items.find((i) => i.key === open) ?? null;
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <div role="group" aria-label="자세히 보기" className="flex flex-wrap gap-2">
        {items.map((it) => {
          const on = open === it.key;
          return (
            <button
              key={it.key}
              type="button"
              aria-expanded={on}
              aria-controls={`${baseId}-${it.key}`}
              onClick={() => setOpen(on ? null : it.key)}
              className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 sm:h-9 ${
                on ? "border-transparent text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-900"
              }`}
              style={on ? { backgroundColor: accent, outlineColor: accent } : { outlineColor: accent }}
            >
              <span className={`inline-block text-[10px] transition-transform motion-reduce:transition-none ${on ? "rotate-90" : ""}`} aria-hidden>
                ▸
              </span>
              {it.label}
              {it.teaser && <span className={`text-[12px] font-medium tabular-nums ${on ? "text-white/85" : "text-zinc-500"}`}>{it.teaser}</span>}
            </button>
          );
        })}
      </div>
      {cur && (
        <div id={`${baseId}-${cur.key}`} role="region" aria-label={cur.label} className="mt-3 rounded-xl bg-zinc-50/70 p-4 sm:p-5">
          {cur.body}
        </div>
      )}
    </div>
  );
}
