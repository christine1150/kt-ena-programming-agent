"use client";

// 라인업 인쇄 화면 — 용지(A4·A3 가로) 폭에 맞춘 고정 폭으로 그려 화면 미리보기와 인쇄 결과가 같다.
// 자료를 받고 글꼴이 준비되면 인쇄 창을 한 번 자동으로 연다(auto=0이면 열지 않음).
import { useEffect, useMemo, useRef, useState } from "react";
import type { LineupPayload } from "@/lib/lineup/types";
import { buildCompareRows, buildOwnRows, conditionText, LAYOUT, queryRange, type LineupQuery } from "@/lib/lineup/viewModel";
import LineupGrid from "../LineupGrid";
import { Legend, ListView } from "../LineupView";

// 인쇄 가능한 폭(px, 96dpi) — 용지 가로 길이에서 여백 8mm×2를 뺀 값.
const PAGE = { A4: { css: "A4 landscape", width: Math.floor(((297 - 16) / 25.4) * 96) }, A3: { css: "A3 landscape", width: Math.floor(((420 - 16) / 25.4) * 96) } };

export default function PrintView({ query: q, autoPrint }: { query: LineupQuery; autoPrint: boolean }) {
  const { from, to } = queryRange(q.from, q.len);
  const [state, setState] = useState<{ data: LineupPayload | null; error: string | null; printedAt: string }>({ data: null, error: null, printedAt: "" });
  const printed = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/lineup?from=${from}&to=${to}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        const printedAt = new Date().toLocaleString("ko-KR");
        if (!r.ok || !j.ok) setState({ data: null, error: j.message ?? "라인업을 불러오지 못했습니다.", printedAt });
        else setState({ data: j as LineupPayload, error: null, printedAt });
      })
      .catch(() => alive && setState({ data: null, error: "라인업을 불러오지 못했습니다.", printedAt: "" }));
    return () => {
      alive = false;
    };
  }, [from, to]);

  const { data, error, printedAt } = state;
  const filters = useMemo(() => ({ channels: q.channels, genres: q.genres, dows: q.dows }), [q.channels, q.genres, q.dows]);
  const grid = useMemo(() => (data ? (q.view === "compare" ? buildCompareRows(data, filters) : buildOwnRows(data, filters)) : null), [data, q.view, filters]);
  const channelNames = data ? q.channels.map((c) => data.outlets.find((o) => o.code === c)?.name ?? c) : q.channels;
  const page = PAGE[q.paper];
  const sources = data
    ? [...new Map(data.sources.filter((s) => s.kind !== "manual").map((s) => [s.kind, s] as const)).values()]
    : [];

  useEffect(() => {
    if (!data || !autoPrint || printed.current) return;
    printed.current = true;
    // 막대 폭 계산(ResizeObserver)과 글꼴이 자리 잡은 뒤에 연다.
    const t = window.setTimeout(() => {
      void document.fonts.ready.then(() => window.print());
    }, 600);
    return () => window.clearTimeout(t);
  }, [data, autoPrint]);

  return (
    <div className="bg-zinc-100 py-4 print:bg-white print:py-0">
      <style>{`@page { size: ${page.css}; margin: 8mm; } @media print { html, body { background: #fff !important; } }`}</style>
      <div className="mx-auto mb-3 flex items-center gap-2 print:hidden" style={{ width: page.width }}>
        <button type="button" onClick={() => window.print()} className="rounded bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zinc-700">
          인쇄 · PDF로 저장
        </button>
        <button type="button" onClick={() => window.close()} className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-[13px]">
          닫기
        </button>
        <span className="text-[12px] text-zinc-600">
          {q.paper} 가로 미리보기 · PDF는 인쇄 창에서 대상을 ‘PDF로 저장’으로 고르세요. 인쇄 설정의 ‘배경 그래픽’을 켜면 색이 그대로 나옵니다.
        </span>
      </div>
      <div className="mx-auto bg-white p-0 shadow print:shadow-none" style={{ width: page.width }}>
        <header className="mb-2 border-b-2 border-zinc-900 pb-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-[16px] font-bold text-zinc-900">
              <span className="mr-2 rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] text-white align-middle">대외비</span>
              KT ENA 라인업 — {conditionText(q, channelNames)}
            </h1>
            <span className="shrink-0 text-[11px] text-zinc-700 tabular-nums">출력 {printedAt}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-700">
            기간 {from} ~ {to}
            {sources.length > 0 && ` · 자료 기준: ${sources.map((s) => `${s.title} ${s.asOf}`).join(", ")}`}
          </p>
        </header>
        {error && <p className="py-6 text-center text-[13px] text-red-800">{error}</p>}
        {!data && !error && <p className="py-10 text-center text-[13px] text-zinc-600">라인업을 불러오는 중…</p>}
        {data && grid && (
          <>
            {q.view !== "list" && (
              <div className="mb-1.5">
                <Legend full byOutlet={q.view === "compare"} />
              </div>
            )}
            {q.view === "list" ? (
              <ListView data={data} filters={filters} onSelect={() => {}} />
            ) : grid.rows.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-zinc-600">이 조건에 맞는 라인업이 없습니다.</p>
            ) : (
              <LineupGrid
                data={data}
                rows={grid.rows}
                runsBySlot={grid.runsBySlot}
                density={q.density}
                labelWidth={LAYOUT.label[q.view === "compare" ? "compare" : "own"][q.density]}
                selectedId={null}
                onSelect={() => {}}
                focusIds={null}
                printMode
                colorBy={q.view === "compare" ? "outlet" : "genre"}
              />
            )}
          </>
        )}
        <footer className="mt-2 border-t border-zinc-300 pt-1 text-[10px] text-zinc-600">
          대외비 — KT ENA 편성 AI 에이전트에서 출력. 외부 반출 금지. 주 단위·월 단위 날짜는 원자료의 정밀도대로이며 ≈는 추정입니다.
        </footer>
      </div>
    </div>
  );
}
