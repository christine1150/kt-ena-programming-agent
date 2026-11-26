"use client";

// 라인업 목록(2026-11-26 리디자인, 지시문 §9) — 전문 데이터 표: 정렬 · 검색 · 필터(공통) · 컬럼 표시/숨기기 · 너비 조절 · 고정 머리 · 출처(기준일).
// 자사·경쟁사·OTT 모두. 같은 상세 패널을 연다. 인쇄(printMode)는 고정 머리·조절 없이 모든 기본 컬럼.
import { useEffect, useMemo, useState } from "react";
import type { LineupPayload, RunDto } from "@/lib/lineup/types";
import { dateFull, episodeText, GENRE_LABEL, kindLabel, runGenre, runMatchesQuery, runTitle, slotLabel, STATUS_LABEL, type Filters } from "@/lib/lineup/viewModel";
import { GENRE_FILL } from "@/lib/lineup/tokens";
import { CheckList, cx, Icon, Menu } from "./ui";

type ColKey = "title" | "genre" | "outlet" | "slot" | "start" | "end" | "eps" | "cast" | "status" | "kind" | "source" | "updated";
const COLS: { key: ColKey; label: string; width: number; def: boolean; align?: "right" }[] = [
  { key: "title", label: "작품명", width: 240, def: true },
  { key: "genre", label: "장르", width: 76, def: true },
  { key: "outlet", label: "방송사·플랫폼", width: 116, def: true },
  { key: "slot", label: "편성", width: 104, def: true },
  { key: "start", label: "시작일", width: 104, def: true },
  { key: "end", label: "종료일", width: 104, def: true },
  { key: "eps", label: "편수", width: 64, def: true, align: "right" },
  { key: "cast", label: "출연진", width: 200, def: true },
  { key: "status", label: "상태", width: 64, def: true },
  { key: "kind", label: "형태", width: 96, def: false },
  { key: "source", label: "출처 · 기준일", width: 150, def: true },
  { key: "updated", label: "최종 수정", width: 100, def: false },
];
const STORE = "lineup.list.cols.v1";
function stored(): { cols?: ColKey[]; widths?: Record<string, number> } {
  if (typeof window === "undefined") return {};
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}") as { cols?: ColKey[]; widths?: Record<string, number> };
    return { cols: v.cols?.filter((k) => COLS.some((c) => c.key === k)).length ? v.cols.filter((k) => COLS.some((c) => c.key === k)) : undefined, widths: v.widths };
  } catch {
    return {};
  }
}

export default function ListTable({
  data, filters, query = "", selectedId, onSelect, printMode = false, maxHeight = "calc(100vh - 250px)",
}: { data: LineupPayload; filters: Filters; query?: string; selectedId?: string | null; onSelect: (id: string) => void; printMode?: boolean; maxHeight?: string }) {
  const works = useMemo(() => new Map(data.works.map((w) => [w.id, w])), [data.works]);
  const slots = useMemo(() => new Map(data.slots.map((s) => [s.id, s])), [data.slots]);
  const outlets = useMemo(() => new Map(data.outlets.map((o) => [o.id, o])), [data.outlets]);
  const sources = useMemo(() => new Map(data.sources.map((s) => [s.id, s])), [data.sources]);
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 }>({ key: "start", dir: 1 });
  // 컬럼 표시·너비는 이 브라우저에 기억한다(보기 설정 저장). 목록은 자료를 받은 뒤 브라우저에서만 그려지므로 처음 값으로 바로 읽는다.
  const [cols, setCols] = useState<ColKey[]>(() => stored().cols ?? COLS.filter((c) => c.def).map((c) => c.key));
  const [widths, setWidths] = useState<Record<string, number>>(() => ({ ...Object.fromEntries(COLS.map((c) => [c.key, c.width])), ...(stored().widths ?? {}) }));
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ cols, widths }));
    } catch {}
  }, [cols, widths]);

  const rows = useMemo(() => {
    const out: { r: RunDto; title: string; genre: ReturnType<typeof runGenre>; outlet: string; own: boolean; ott: boolean; slot: string; cast: string; source: string; sourceAsOf: string }[] = [];
    for (const r of data.runs) {
      const s = slots.get(r.slotId);
      const o = s ? outlets.get(s.outletId) : undefined;
      if (!s || !o) continue;
      if (o.side === "own" && filters.channels.length > 0 && !filters.channels.includes(o.code)) continue;
      if (o.side !== "own" && filters.outlets && filters.outlets.length > 0 && !filters.outlets.includes(o.code)) continue;
      if (filters.dows.length > 0 && (o.ott || !s.days.some((d) => filters.dows.includes(d)))) continue; // OTT는 요일이 없어 요일을 고르면 뺀다
      const w = r.workId ? works.get(r.workId) : undefined;
      const g = runGenre(r, w, s);
      if (filters.genres.length > 0 && !filters.genres.includes(g)) continue;
      if (filters.statuses && filters.statuses.length > 0 && r.workId && !filters.statuses.includes(r.status)) continue;
      if (query.trim() && !runMatchesQuery(r, w, query)) continue;
      const src = r.sourceId ? sources.get(r.sourceId) : undefined;
      out.push({ r, title: runTitle(r, w), genre: g, outlet: o.name, own: o.side === "own", ott: !!o.ott, slot: slotLabel(s, o), cast: (w?.cast ?? []).join(", "), source: src?.title ?? "", sourceAsOf: src?.asOf ?? "" });
    }
    const val = (x: (typeof out)[number]): string | number => {
      switch (sort.key) {
        case "title": return x.title;
        case "genre": return GENRE_LABEL[x.genre];
        case "outlet": return `${x.own ? 0 : x.ott ? 2 : 1}${x.outlet}`;
        case "slot": return x.slot;
        case "start": return x.r.startDate ?? "9999";
        case "end": return x.r.endDate ?? x.r.draw?.to ?? "9999";
        case "eps": return x.r.episodes ?? works.get(x.r.workId ?? "")?.totalEpisodes ?? 0;
        case "cast": return x.cast;
        case "status": return x.r.status;
        case "kind": return x.r.runKind;
        case "source": return x.sourceAsOf;
        case "updated": return x.r.updatedAt;
      }
    };
    return out.sort((a, b) => {
      const p = val(a);
      const q = val(b);
      const c = typeof p === "number" && typeof q === "number" ? p - q : String(p).localeCompare(String(q), "ko");
      return c * sort.dir || (a.r.startDate ?? "9999").localeCompare(b.r.startDate ?? "9999");
    });
  }, [data.runs, slots, outlets, works, sources, filters, query, sort]);

  const shown = COLS.filter((c) => (printMode ? c.def : cols.includes(c.key)));
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widths[key];
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: Math.max(56, Math.min(520, w0 + ev.clientX - x0)) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div>
      {!printMode && (
        <div className="mb-2 flex items-center gap-2 text-[12.5px] text-[var(--lu-text-2)]">
          <span className="lu-num">{rows.length}건</span>
          <span>· 머리를 누르면 정렬, 머리 오른쪽 끝을 끌면 너비 조절</span>
          <span className="ml-auto" />
          <Menu label="컬럼" align="right" width={200}>
            <CheckList options={COLS.filter((c) => c.key !== "title").map((c) => ({ key: c.key, label: c.label }))} value={cols.filter((k) => k !== "title")} onChange={(v) => setCols(["title", ...(v as ColKey[])])} allLabel="기본 컬럼으로" />
          </Menu>
        </div>
      )}
      <div className={cx("bg-white", !printMode && "lu-scroll overflow-auto rounded-[8px] border border-[var(--lu-line)]")} style={printMode ? undefined : { maxHeight }}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ minWidth: shown.reduce((n, c) => n + widths[c.key], 0) }}>
          <colgroup>
            {shown.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}
          </colgroup>
          <thead className={cx(!printMode && "sticky top-0 z-10")}>
            <tr>
              {shown.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="relative border-b border-[var(--lu-line)] bg-[var(--lu-page)] p-0 text-left">
                  <button
                    type="button"
                    onClick={() => !printMode && setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((s.dir * -1) as 1 | -1) : 1 }))}
                    className={cx("flex h-9 w-full items-center gap-1 px-3 text-[12px] font-semibold text-[var(--lu-text-2)] hover:text-[var(--lu-text)]", c.align === "right" && "justify-end")}
                  >
                    {c.label}
                    {sort.key === c.key && !printMode && <Icon name="chevron" size={11} className={sort.dir === -1 ? "rotate-180" : ""} />}
                  </button>
                  {!printMode && <span role="separator" aria-hidden onMouseDown={(e) => startResize(c.key, e)} className="absolute top-1.5 right-0 bottom-1.5 w-1.5 cursor-col-resize border-r border-[var(--lu-line)] hover:border-[var(--lu-accent)]" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const w = x.r.workId ? works.get(x.r.workId) : undefined;
              const sel = selectedId === x.r.id;
              return (
                <tr key={x.r.id} onClick={() => onSelect(x.r.id)} className={cx("cursor-pointer", sel ? "bg-[var(--lu-accent-weak)]" : "hover:bg-[var(--lu-hover)]")}>
                  {shown.map((c) => (
                    <td key={c.key} className={cx("truncate border-b border-[var(--lu-grid)] px-3 py-2", c.align === "right" && "text-right")}>
                      {cell(c.key, x, w)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={shown.length} className="px-3 py-10 text-center text-[13px] text-[var(--lu-text-2)]">조건에 맞는 라인업이 없습니다. 기간을 옮기거나 필터를 풀어 보세요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  function cell(key: ColKey, x: (typeof rows)[number], w: ReturnType<typeof works.get>) {
    const r = x.r;
    switch (key) {
      case "title":
        return (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[2px]" style={x.own ? { background: GENRE_FILL[x.genre] } : { background: "#fff", border: `1.5px solid ${GENRE_FILL[x.genre]}` }} />
            <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(r.id); }} className="truncate text-left font-semibold text-[var(--lu-text)] hover:underline">{x.title || "—"}</button>
            {r.needsReview && <span className="shrink-0 rounded-[3px] bg-[var(--lu-text)] px-1 text-[10.5px] text-white">확인</span>}
          </span>
        );
      case "genre":
        return <span className="text-[var(--lu-text-2)]">{GENRE_LABEL[x.genre]}</span>;
      case "outlet":
        return (
          <span className={x.own ? "font-semibold text-[var(--lu-text)]" : "text-[var(--lu-text-2)]"}>
            {x.outlet}
          </span>
        );
      case "slot":
        return <span className="lu-num text-[var(--lu-text-2)]">{x.slot || "—"}</span>;
      case "start":
        return <span className="lu-num">{r.startDate ? `${r.startPrecision === "week" ? "≈" : ""}${r.startPrecision === "month" ? r.startText ?? dateFull(r.startDate).slice(0, 7) : dateFull(r.startDate)}` : "미정"}</span>;
      case "end":
        return <span className="lu-num text-[var(--lu-text-2)]">{r.endDate ? `${r.endPrecision !== "day" ? "≈" : ""}${dateFull(r.endDate)}` : r.endPrecision === "open" ? "종료 미정" : "—"}</span>;
      case "eps":
        return <span className="lu-num">{episodeText(r, w) || "—"}</span>;
      case "cast":
        return <span className="text-[var(--lu-text-2)]">{x.cast || "—"}</span>;
      case "status":
        return <span className={r.status === "confirmed" ? "text-[var(--lu-text)]" : "text-[var(--lu-text-2)]"}>{STATUS_LABEL[r.status]}</span>;
      case "kind":
        return <span className="text-[var(--lu-text-2)]">{kindLabel(r, x.ott)}</span>;
      case "source":
        return <span className="text-[var(--lu-text-2)]" title={x.source}>{x.sourceAsOf ? <span className="lu-num">{dateFull(x.sourceAsOf)}</span> : "—"}{x.source && <span className="ml-1 text-[11.5px]">{x.source}</span>}</span>;
      case "updated":
        return <span className="lu-num text-[var(--lu-text-2)]">{dateFull(r.updatedAt.slice(0, 10))}</span>;
    }
  }
}
