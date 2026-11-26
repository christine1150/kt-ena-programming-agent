"use client";

// 라인업 타임라인(KT ENA·경쟁 비교 공용) — 2026-11-26 전면 리디자인(docs/lineup/REDESIGN_2026-11.md §3·§4).
// 한 스크롤 상자 안의 <table> 하나: 머리(월·주·오늘·외부 이벤트 띠)는 위에, 첫 열(채널·요일·시각)은 왼쪽에 붙는다. 인쇄는 머리를 쪽마다 반복.
// 표현 규칙(사용자 확정 Style 2): 자사 = 장르색 채움(확정) / 옅은 바탕 + 점선(예정), 경쟁사·OTT = 흰 바탕 + 장르색 아웃라인 + 왼쪽 강조선.
// 장르·소유·상태를 색 하나로 겹쳐 말하지 않는다 — 상태는 실선/점선 + '예정' 글자, 소유는 채움/아웃라인 + 줄 머리 로고.
// 막대 좌표는 실제 날짜 그대로(길이를 늘리지 않는다). 첫방일만 있고 끝·편수가 없으면 막대 대신 시작 표식 + '기간 미정'.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GapDto, Genre, LineupPayload, OutletDto, RunDto, SlotDto, WorkDto } from "@/lib/lineup/types";
import {
  addDaysIso, assignLanes, dateDot, dayIndex, episodeText, GENRE_LABEL, LAYOUT, ottLabelPx, pct, periodDot, runExtent, runGenre, runMatchesQuery, runTitle, textWidth,
  type Density, type Row,
} from "@/lib/lineup/viewModel";
import { EVENT_KIND_ICON, EVENT_KIND_LABEL, laneEvents, placeLane, type LaneEvent } from "@/lib/lineup/events";
import { GENRE_FILL, GENRE_ON, tint, UI } from "@/lib/lineup/tokens";
import { cx, Icon, OutletLogo } from "./ui";

interface Props {
  data: LineupPayload;
  rows: Row[];
  runsBySlot: Map<string, RunDto[]>;
  density: Density;
  labelWidth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 경쟁 비교에서 막대를 고르면 맞대결이 아닌 막대를 흐리게 */
  focusIds: Set<string> | null;
  /** 인쇄·PDF(/lineup/print) — 높이 제한·스크롤 없이, 다 못 쓴 제목은 번호 + 표 아래 각주 */
  printMode?: boolean;
  view?: "own" | "compare";
  /** 보는 길이(개월) — 1년은 제목 중심, 3개월은 기간·편수·출연까지 */
  months?: number;
  /** 검색어 — 맞지 않는 막대를 흐리게(문맥은 남긴다) */
  query?: string;
  /** 외부 이벤트 띠 보이기 */
  showEvents?: boolean;
  onSelectEvent?: (ev: LaneEvent) => void;
  /** 화면 높이 제한(px 계산식) */
  maxHeight?: string;
}

const MONTH = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const FONT = 13; // 막대 제목 글자(지시문 §3: 13~14px/600)
const META = 11.5;

export default function LineupGrid({
  data, rows, runsBySlot, density, labelWidth, selectedId, onSelect, focusIds, printMode = false, view = "own", months = 8, query = "", showEvents = true, onSelectEvent, maxHeight = "calc(100vh - 250px)",
}: Props) {
  const totalDays = dayIndex(data.from, data.to) + 1;
  const weeks = Math.ceil(totalDays / 7);
  const minTimeline = weeks * LAYOUT.minWeekPx;
  const headRef = useRef<HTMLTableCellElement>(null);
  const [tlWidth, setTlWidth] = useState(1000);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTlWidth(el.clientWidth));
    ro.observe(el);
    setTlWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const dayPx = tlWidth / totalDays;
  const works = useMemo(() => new Map(data.works.map((w) => [w.id, w])), [data.works]);
  const gapsBySlot = useMemo(() => {
    const m = new Map<string, GapDto[]>();
    for (const g of data.gaps) m.set(g.slotId, [...(m.get(g.slotId) ?? []), g]);
    return m;
  }, [data.gaps]);
  const P = (d: string) => pct(data.from, totalDays, d);
  const L = LAYOUT[density];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (k: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  // 인쇄 각주 — 막대 안에 제목이 다 들어가지 않는 구간에 줄 순서대로 번호(인쇄물에는 툴팁이 없다)
  const footnotes = useMemo(() => {
    const m = new Map<string, number>();
    if (!printMode) return m;
    for (const row of rows) {
      if (!row.slot) continue;
      for (const r of runsBySlot.get(row.slot.id) ?? []) {
        if (!r.draw || r.draw.shape === "diamond" || r.draw.shape === "dots") continue;
        const w = r.workId ? works.get(r.workId) : undefined;
        const px = ((pct(data.from, totalDays, addDaysIso(r.draw.to, 1)) - pct(data.from, totalDays, r.draw.from)) / 100) * tlWidth;
        if (runExtent(r) !== "start" && textWidth(runTitle(r, w), FONT) > px - 14) m.set(r.id, m.size + 1);
      }
    }
    return m;
  }, [printMode, rows, runsBySlot, works, data.from, totalDays, tlWidth]);

  // 머리: 달(해가 바뀌는 1월·첫 달에 'YY), 주(월요일)
  const monthCols = useMemo(() => {
    const out: { label: string; year: string | null; from: string; to: string }[] = [];
    let d = data.from.slice(0, 7) + "-01";
    while (d <= data.to) {
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7));
      const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      out.push({ label: MONTH[m - 1], year: m === 1 || out.length === 0 ? `’${String(y).slice(2)}` : null, from: d < data.from ? data.from : d, to: addDaysIso(next, -1) > data.to ? data.to : addDaysIso(next, -1) });
      d = next;
    }
    return out;
  }, [data.from, data.to]);
  // 화면에 쓰는 달 이름 — 기간이 달 중간에서 시작해 첫 달 칸이 좁으면(예: 11/23~) 그 달 이름은 빼고, 연도 표시는 다음 달로 넘긴다
  const monthLabels = useMemo(() => {
    let pendingYear: string | null = null;
    const out: { label: string; year: string | null; from: string }[] = [];
    for (const m of monthCols) {
      const w = ((pct(data.from, totalDays, addDaysIso(m.to, 1)) - pct(data.from, totalDays, m.from)) / 100) * tlWidth;
      const year: string | null = m.year ?? pendingYear;
      const need = textWidth(m.label, 13) + (year ? textWidth(year, 11) + 4 : 0) + 12;
      if (w < need) {
        pendingYear = year;
        continue;
      }
      pendingYear = null;
      out.push({ label: m.label, year, from: m.from });
    }
    return out;
  }, [monthCols, data.from, totalDays, tlWidth]);
  const mondays = useMemo(() => {
    const out: string[] = [];
    let d = data.from;
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDaysIso(d, 1);
    for (; d <= data.to; d = addDaysIso(d, 7)) out.push(d);
    return out;
  }, [data.from, data.to]);
  const weekPx = 7 * dayPx;
  const weekStep = weekPx < 24 ? 2 : 1;
  const todayIn = data.today >= data.from && data.today <= data.to;

  // 외부 이벤트 띠 — 글자 폭까지 겹치지 않게 최대 2줄, 넘치는 것은 작은 점으로(누르면 상세)
  const lane = useMemo(() => {
    if (!showEvents) return { placed: [], overflow: [], rows: 0 };
    const items = laneEvents(data).map((ev) => {
      const leftPx = (P(ev.from) / 100) * tlWidth;
      const spanPx = ((P(addDaysIso(ev.to, 1)) - P(ev.from)) / 100) * tlWidth;
      return { ev, leftPx, spanPx, widthPx: Math.max(spanPx, textWidth(ev.title, 12) + 26) };
    });
    const r = placeLane(items, 1, 4);
    return { ...r, rows: 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEvents, data, tlWidth, totalDays]);

  // 선택한 작품의 시작·끝 안내선
  const sel = selectedId ? data.runs.find((r) => r.id === selectedId) : null;
  const selGuide = sel?.draw && sel.startDate && sel.startPrecision !== "month" ? { from: sel.startDate, to: sel.endDate ?? null } : null;

  // 화면 줄(접힌 묶음 건너뛰기, 자사 보기는 채널 안 장르 머리를 끼운다)
  const visible = useMemo(() => {
    const out: (Row & { genreHead?: Genre; parentKey?: string })[] = [];
    let parent: string | null = null;
    let lastGenre: Genre | null = null;
    for (const row of rows) {
      if (view === "own" && row.kind === "group") continue; // A·B 묶음은 채널 줄의 작은 글자로
      if ((view === "own" && row.kind === "subgroup") || (view === "compare" && row.kind === "group")) {
        parent = row.key;
        lastGenre = null;
        out.push(row);
        continue;
      }
      if (parent && collapsed.has(parent)) continue;
      if (view === "own" && row.kind === "slot" && row.genre && row.genre !== lastGenre) {
        out.push({ key: `gh:${row.key}`, kind: "group", label: GENRE_LABEL[row.genre], genreHead: row.genre, parentKey: parent ?? undefined });
        lastGenre = row.genre;
      }
      out.push(row);
    }
    return out;
  }, [rows, view, collapsed]);

  const timelineHeader = view === "compare" ? "방송사 · 편성 슬롯" : "채널 · 편성 슬롯";

  return (
    <div
      className={cx("lu-scroll relative bg-white", printMode ? "overflow-visible" : "overflow-auto rounded-[8px] border border-[var(--lu-line)] print:overflow-visible print:rounded-none print:border-0")}
      style={printMode ? undefined : { maxHeight }}
    >
      <div className="relative" style={printMode ? undefined : { minWidth: labelWidth + minTimeline }}>
        {/* 격자 바탕 — 달 경계(주요 구분선) · 주 경계(보조 그리드, 충분히 넓을 때만). 표 아래에 깔린다. */}
        <div aria-hidden className={cx("pointer-events-none absolute inset-y-0", !printMode && "print:hidden")} style={{ left: labelWidth, right: 0 }}>
          {weekPx >= 9 && mondays.map((d) => <div key={d} className="absolute inset-y-0 border-l border-[var(--lu-grid)]" style={{ left: `${P(d)}%` }} />)}
          {monthCols.slice(1).map((m) => <div key={m.from} className="absolute inset-y-0 border-l border-[var(--lu-line)]" style={{ left: `${P(m.from)}%` }} />)}
        </div>
        <table className="relative z-[1] w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">{view === "compare" ? "경쟁 비교 타임라인" : "KT ENA 타임라인"} {data.from} ~ {data.to}</caption>
          <colgroup>
            <col style={{ width: labelWidth }} />
            <col />
          </colgroup>
          <thead className={cx("z-30 bg-white", !printMode && "sticky top-0 print:static")}>
            {/* 머리 한 줄(사용자 요청 2026-11-26): 달 이름(굵게) + 주 시작일(월요일, 작게)을 같은 줄에 — 달 이름과 겹치는 주 숫자는 뺀다 */}
            <tr>
              <th scope="col" className={cx("z-40 border-r border-b border-[var(--lu-line)] bg-white px-3 text-left align-middle", !printMode && "sticky left-0 print:static")}>
                <span className="block truncate text-[12px] font-medium text-[var(--lu-text-2)]">{timelineHeader}</span>
              </th>
              <th ref={headRef} className="relative h-7 overflow-x-clip border-b border-[var(--lu-line)] p-0 font-normal">
                {monthLabels.map((m) => (
                  <span key={m.from} className="absolute top-0 flex h-7 items-center gap-1 pl-1.5 whitespace-nowrap" style={{ left: `${P(m.from)}%` }}>
                    <span className="text-[13px] font-semibold text-[var(--lu-text)]">{m.label}</span>
                    {m.year && <span className="lu-num text-[11px] font-medium text-[var(--lu-text-2)]">{m.year}</span>}
                  </span>
                ))}
                {mondays.map((d, i) => {
                  if (i % weekStep !== 0) return null;
                  const x = (P(d) / 100) * tlWidth;
                  // 달 이름 자리와 겹치면 뺀다(달 시작 직후 · 다음 달 시작 직전)
                  const clash = monthLabels.some((m) => {
                    const xm = (P(m.from) / 100) * tlWidth;
                    const w = textWidth(m.label, 13) + (m.year ? textWidth(m.year, 11) + 4 : 0) + 14;
                    return (x >= xm && x - xm < w + 6) || (xm > x && xm - x < 12);
                  });
                  return clash ? null : (
                    <span key={d} className="lu-num absolute top-0 h-7 -translate-x-1/2 text-[11px] leading-7 text-[var(--lu-text-2)]" style={{ left: `${P(d)}%` }}>
                      {Number(d.slice(8, 10))}
                    </span>
                  );
                })}
                {todayIn && (
                  <span className="lu-num absolute top-[3px] z-10 -translate-x-1/2 rounded-[4px] bg-[var(--lu-accent)] px-1.5 text-[11px] leading-[18px] font-semibold text-white" style={{ left: `${P(data.today)}%` }}>
                    {dateDot(data.today)}
                  </span>
                )}
                {selGuide && (
                  <>
                    <GuidePill left={P(selGuide.from)} text={dateDot(selGuide.from)} />
                    {selGuide.to && <GuidePill left={P(addDaysIso(selGuide.to, 1))} text={dateDot(selGuide.to)} />}
                  </>
                )}
              </th>
            </tr>
            {showEvents && (
              <tr>
                <th scope="row" title="공휴일 · 외부 일정" className={cx("z-40 border-r border-b border-[var(--lu-line)] bg-white px-3 text-left align-middle font-normal", !printMode && "sticky left-0 print:static")}>
                  <span className="block truncate text-[12px] font-semibold text-[var(--lu-text)]">주요 이벤트</span>
                </th>
                {/* 이벤트 띠 한 줄(사용자 요청 2026-11-26) — 겹치는 이벤트는 아래 작은 점(누르면 상세) */}
                <th className="relative h-7 overflow-x-clip border-b border-[var(--lu-line)] p-0 font-normal">
                  {lane.placed.map((p) => (
                    <EventChip key={p.ev.key} ev={p.ev} left={(p.leftPx / tlWidth) * 100} spanPct={(p.spanPx / tlWidth) * 100} top={3} onClick={onSelectEvent} />
                  ))}
                  {lane.overflow.map((o) => (
                    <button
                      key={o.ev.key}
                      type="button"
                      title={`${o.ev.title} (${EVENT_KIND_LABEL[o.ev.kind] ?? "이벤트"}) ${o.ev.from}${o.ev.to !== o.ev.from ? `~${o.ev.to}` : ""}`}
                      aria-label={`${o.ev.title} ${o.ev.from}`}
                      onClick={() => onSelectEvent?.(o.ev)}
                      className="absolute bottom-px size-1.5 -translate-x-1/2 rounded-full bg-[var(--lu-text-2)]"
                      style={{ left: `${(o.leftPx / tlWidth) * 100}%` }}
                    />
                  ))}
                  {lane.placed.length === 0 && lane.overflow.length === 0 && <span className="absolute top-1.5 left-2 text-[11.5px] text-[var(--lu-text-2)]">이 기간 등록된 공휴일·이벤트 없음</span>}
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {visible.map((row) => {
              // ── 묶음 머리: 자사 채널(접기) · 비교 묶음(접기) · 장르 머리 ──
              if (row.kind === "subgroup" || (row.kind === "group" && !("genreHead" in row && row.genreHead))) {
                const isChannel = row.kind === "subgroup";
                const open = !collapsed.has(row.key);
                return (
                  <tr key={row.key}>
                    <th colSpan={2} scope="rowgroup" className="border-t border-b border-[var(--lu-line)] bg-[var(--lu-page)] p-0 text-left font-normal">
                      <div className={cx("flex items-center gap-2 px-2", !printMode && "sticky left-0")} style={{ maxWidth: "100vw", height: isChannel ? 34 : 30 }}>
                        <button
                          type="button"
                          onClick={() => toggleCollapse(row.key)}
                          aria-expanded={open}
                          aria-label={`${row.label} ${open ? "접기" : "펼치기"}`}
                          className="flex size-6 items-center justify-center rounded-[4px] text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)] print:hidden"
                        >
                          <Icon name={open ? "chevron" : "chevron-right"} size={12} />
                        </button>
                        {isChannel ? (
                          <>
                            <OutletLogo logo={row.outlet?.logo ?? null} name={row.label} height={15} maxWidth={84} />
                            <span className="sr-only">{row.label}</span>
                            {row.groupLabel && <span className="text-[11.5px] text-[var(--lu-text-2)]">{row.groupLabel}</span>}
                          </>
                        ) : (
                          <span className="text-[13px] font-semibold text-[var(--lu-text)]">{row.label}</span>
                        )}
                        {row.count !== undefined && <span className="lu-num text-[11.5px] text-[var(--lu-text-2)]">{row.empty ? "이 기간 자료 없음" : `작품 ${row.count}`}</span>}
                      </div>
                    </th>
                  </tr>
                );
              }
              if (row.kind === "group" && "genreHead" in row && row.genreHead) {
                return (
                  <tr key={row.key}>
                    <th colSpan={2} scope="rowgroup" className="h-6 border-b border-[var(--lu-grid)] bg-white p-0 text-left font-normal">
                      <span className={cx("flex items-center gap-1.5 pl-9 text-[11.5px] font-semibold text-[var(--lu-text-2)]", !printMode && "sticky left-0")}>
                        <span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: GENRE_FILL[row.genreHead] }} />
                        {row.label}
                      </span>
                    </th>
                  </tr>
                );
              }
              // ── 자리 줄 ──
              const runs = row.slot ? runsBySlot.get(row.slot.id) ?? [] : [];
              const isOtt = !!row.outlet?.ott;
              const own = row.outlet?.side === "own";
              const lanes = assignLanes(runs, isOtt ? { labelDays: (r) => Math.ceil(ottLabelPx(r, r.workId ? works.get(r.workId) : undefined) / Math.max(dayPx, 0.5)) } : undefined);
              const height = lanes.main.length * L.row + (lanes.events.length > 0 ? L.event + 4 : 0);
              const lastEnd = own && row.slot?.defaultGenre === "drama" ? runs.reduce<string | null>((m, r) => (r.draw && r.draw.shape !== "diamond" && (!m || r.draw.to > m) ? r.draw.to : m), null) : null;
              return (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className={cx("z-20 border-r border-b border-[var(--lu-grid)] px-0 text-left align-middle font-normal", !printMode && "sticky left-0 print:static", view === "compare" && own ? "bg-[#f8f8fe]" : "bg-white")}
                    style={{ height }}
                  >
                    <SlotLabel row={row} view={view} density={density} />
                  </th>
                  <td className="relative overflow-x-clip border-b border-[var(--lu-grid)] p-0 align-top" style={{ height }}>
                    {row.empty && <span className="absolute top-1/2 left-3 -translate-y-1/2 text-[12px] text-[var(--lu-text-2)]">{row.kind === "slot" ? "이 묶음에 KT ENA 편성 자료 없음" : ""}</span>}
                    {lanes.events.length > 0 && (
                      <div className="relative" style={{ height: L.event + 4 }}>
                        {lanes.events.map((r) => (
                          <Mark key={r.id} run={r} work={r.workId ? works.get(r.workId) : undefined} slot={row.slot} outlet={row.outlet} P={P} dayPx={dayPx} size={L.event - 6} selected={selectedId === r.id} dim={isDim(r)} onSelect={onSelect} small />
                        ))}
                      </div>
                    )}
                    {lanes.main.map((laneRuns, li) => (
                      <div key={li} className="relative" style={{ height: L.row }}>
                        {row.slot && li === 0 && (gapsBySlot.get(row.slot.id) ?? []).map((g) => <Gap key={g.from} gap={g} P={P} dayPx={dayPx} alert={own} />)}
                        {li === 0 && lastEnd && dayIndex(lastEnd, data.to) >= 28 && <NoData from={addDaysIso(lastEnd, 1)} P={P} />}
                        {laneRuns.map((r, i) => {
                          const nextStart = laneRuns[i + 1]?.draw?.from ?? null;
                          const work = r.workId ? works.get(r.workId) : undefined;
                          if (r.draw?.shape === "diamond" || r.draw?.shape === "dots")
                            return <Mark key={r.id} run={r} work={work} slot={row.slot} outlet={row.outlet} P={P} dayPx={dayPx} size={11} selected={selectedId === r.id} dim={isDim(r)} onSelect={onSelect} rich={isOtt && density === "comfy"} />;
                          return (
                            <RunBar
                              key={r.id}
                              run={r}
                              work={work}
                              slot={row.slot}
                              outlet={row.outlet}
                              data={data}
                              P={P}
                              totalPx={tlWidth}
                              barH={L.bar}
                              rowH={L.row}
                              density={density}
                              months={months}
                              nextStart={nextStart}
                              selected={selectedId === r.id}
                              dim={isDim(r)}
                              onSelect={onSelect}
                              footnote={footnotes.get(r.id)}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* 오늘선 — 막대 위로 1px ENA 블루(누르기는 막지 않음) */}
        {todayIn && (
          <div aria-hidden className={cx("pointer-events-none absolute inset-y-0 z-[2]", !printMode && "print:hidden")} style={{ left: labelWidth, right: 0 }}>
            <div className="absolute inset-y-0 w-px bg-[var(--lu-accent)]" style={{ left: `${P(data.today)}%` }} />
          </div>
        )}
        {/* 선택한 작품의 시작·끝 안내선 */}
        {selGuide && !printMode && (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[2] print:hidden" style={{ left: labelWidth, right: 0 }}>
            <div className="absolute inset-y-0 border-l border-dashed border-[var(--lu-text)]" style={{ left: `${P(selGuide.from)}%` }} />
            {selGuide.to && <div className="absolute inset-y-0 border-l border-dashed border-[var(--lu-text)]" style={{ left: `${P(addDaysIso(selGuide.to, 1))}%` }} />}
          </div>
        )}
      </div>
      {printMode && footnotes.size > 0 && (
        <section className="mt-2 break-inside-avoid-page text-[11.5px] leading-snug text-[var(--lu-text)]">
          <h3 className="mb-0.5 font-semibold">막대에 다 쓰지 못한 제목</h3>
          <ol className="columns-3 gap-6">
            {[...footnotes.entries()].map(([id, n]) => {
              const r = data.runs.find((x) => x.id === id);
              if (!r) return null;
              const w = r.workId ? works.get(r.workId) : undefined;
              return (
                <li key={id} className="break-inside-avoid">
                  <b className="lu-num">[{n}]</b> {runTitle(r, w)} <span className="text-[var(--lu-text-2)]">· {periodDot(r)} {episodeText(r, w)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );

  function isDim(r: RunDto) {
    if (focusIds && !focusIds.has(r.id)) return true;
    if (query.trim() && !runMatchesQuery(r, r.workId ? works.get(r.workId) : undefined, query)) return true;
    return false;
  }
}

function GuidePill({ left, text }: { left: number; text: string }) {
  return (
    <span className="lu-num absolute top-[3px] z-20 -translate-x-1/2 rounded-[4px] bg-[var(--lu-text)] px-1.5 text-[11px] leading-[18px] font-semibold text-white" style={{ left: `${left}%` }}>
      {text}
    </span>
  );
}

/** 줄 머리 — 자사 보기: 요일·시각 / 경쟁 비교: [자사 표식] 로고 · 요일 · 시각(경쟁사 로고는 무채색) */
function SlotLabel({ row, view, density }: { row: Row; view: "own" | "compare"; density: Density }) {
  const own = row.outlet?.side === "own";
  const time = row.sublabel && row.sublabel !== "-" ? row.sublabel : "";
  if (view === "own") {
    const days = row.slot ? row.label.replace(/\s*\d{1,2}:\d{2}.*$/, "") : row.label;
    const t = row.slot ? (row.label.match(/\d{1,2}:\d{2}/)?.[0] ?? "") : "";
    return (
      <div className="flex h-full items-center gap-2 pr-2 pl-9">
        <span className="truncate text-[13px] font-semibold text-[var(--lu-text)]">{days}</span>
        {t && <span className="lu-num text-[13px] text-[var(--lu-text-2)]">{t}</span>}
        {row.slot?.timeNote && !/\d{1,2}:\d{2}/.test(row.slot.timeNote) && !row.label.includes(row.slot.timeNote) && <span className="text-[11.5px] text-[var(--lu-text-2)]">{row.slot.timeNote}</span>}
      </div>
    );
  }
  const isOtt = !!row.outlet?.ott;
  return (
    <div className="flex h-full items-center gap-2 pr-2">
      <span aria-hidden className="h-full w-[3px] shrink-0" style={{ background: own ? row.outlet?.color ?? UI.accent : "transparent" }} />
      <span className="flex w-[64px] shrink-0 items-center">
        <OutletLogo logo={row.outlet?.logo ?? null} name={row.label} height={density === "compact" ? 13 : 15} mono={!own} maxWidth={60} className="text-[13px]" />
      </span>
      {isOtt ? (
        <span className="text-[12px] text-[var(--lu-text-2)]">공개 일정</span>
      ) : (
        <>
          {row.chip && <span className={cx("shrink-0 text-[12.5px] font-semibold", own ? "text-[var(--lu-text)]" : "text-[var(--lu-text-2)]")}>{row.chip}</span>}
          {time && <span className="lu-num shrink-0 text-[12.5px] text-[var(--lu-text-2)]">{time}</span>}
          {row.slot?.timeNote && !/\d{1,2}:\d{2}/.test(row.slot.timeNote) && !(row.slot.name ?? "").includes(row.slot.timeNote) && <span className="shrink-0 text-[11.5px] text-[var(--lu-text-2)]">{row.slot.timeNote}</span>}
        </>
      )}
      <span className="sr-only">{own ? "KT ENA" : "경쟁사"} {row.label}</span>
    </div>
  );
}

/** 막대 색·테두리 — 소유(채움/아웃라인) × 상태(실선/점선). 사업형 시안 아웃라인은 흰 바탕 대비가 낮아 중립 테두리 + 시안 강조선. */
function barLook(genre: Genre, own: boolean, status: RunDto["status"]) {
  const c = GENRE_FILL[genre];
  const planned = status !== "confirmed";
  if (own && !planned) return { bg: c, fg: GENRE_ON[genre], border: `1px solid ${c}`, strip: null as string | null, onFill: true };
  if (own) return { bg: tint(c, 0.13), fg: UI.text, border: `1.5px dashed ${c}`, strip: null, onFill: false };
  const edge = genre === "business" ? UI.cyanOutlineAssist : c;
  return { bg: "#ffffff", fg: UI.text, border: `${planned ? "1.5px dashed" : "1px solid"} ${edge}`, strip: c, onFill: false };
}

function RunBar(props: {
  run: RunDto; work: WorkDto | undefined; slot: SlotDto | undefined; outlet: OutletDto | undefined; data: LineupPayload; P: (d: string) => number; totalPx: number;
  barH: number; rowH: number; density: Density; months: number; nextStart: string | null; selected: boolean; dim: boolean; onSelect: (id: string | null) => void; footnote?: number;
}) {
  const { run, work, slot, outlet, data, P, totalPx, barH, rowH, density, months, nextStart, selected, dim, onSelect, footnote } = props;
  const d = run.draw!;
  const own = outlet?.side === "own";
  const genre = runGenre(run, work, slot);
  const title = runTitle(run, work);
  const left = P(d.from);
  const right = P(addDaysIso(d.to, 1));
  const widthPct = Math.max(0, right - left);
  const px = (widthPct / 100) * totalPx;
  const extent = runExtent(run);
  const period = periodDot(run);
  const eps = episodeText(run, work);
  const castN = months <= 3 ? 5 : 3;
  const cast = (work?.cast ?? []).slice(0, castN).join(", ");
  const statusWord = run.status === "confirmed" ? "확정" : run.status === "planned" ? "예정" : "가안";
  const aria = `${title}, ${outlet?.name ?? ""} ${own ? "KT ENA" : "경쟁사"}, ${GENRE_LABEL[genre]}, ${period}${eps ? `, ${eps}` : ""}, ${statusWord}`;
  const tip = [title, `${outlet?.name ?? ""} · ${GENRE_LABEL[genre]} · ${statusWord}`, [period, eps].filter(Boolean).join(" · "), cast, run.needsReview ? "확인 필요" : ""].filter(Boolean).join("\n");
  const click = () => onSelect(selected ? null : run.id);
  const ring = selected ? "ring-2 ring-[var(--lu-text)] ring-offset-1" : "";
  const startsBefore = d.from < data.from;

  // ── 월 단위 정밀도: 범위 괄호 + 원문 기간 ──
  if (d.shape === "bracket") {
    const c = GENRE_FILL[genre];
    return (
      <button type="button" onClick={click} aria-label={`${aria} (월 단위 일정)`} aria-pressed={selected} title={`${tip}\n월 단위 발표 — 정확한 날짜 미정`}
        className={cx("absolute top-0 flex flex-col justify-end overflow-visible text-left", ring, dim && "opacity-35")}
        style={{ left: `${left}%`, width: `${widthPct}%`, minWidth: 16, height: rowH }}>
        <span className="truncate px-1 text-[12.5px] leading-4 font-semibold text-[var(--lu-text)]">
          {title} <span className="font-normal text-[var(--lu-text-2)]">· {period}{/[년반기분]/.test(period) ? "" : " · 월 단위"}</span>
        </span>
        <span aria-hidden className="relative mx-0.5 mt-1 mb-2 block h-2" style={{ borderLeft: `2px solid ${c}`, borderRight: `2px solid ${c}` }}>
          <span className="absolute inset-x-0 top-1/2 block h-[1.5px] -translate-y-1/2" style={{ background: c }} />
        </span>
      </button>
    );
  }

  // ── 휴방·결방·수급물·후속 미정(작품 없는 칸) ──
  if (d.shape === "box") {
    const label = run.runKind === "hiatus" ? title || "휴방" : run.runKind === "filler" ? run.label ?? "수급물" : `후속 미정${run.episodes ? ` · ${run.episodes}회` : ""}`;
    const look =
      run.runKind === "hiatus" ? { className: "lu-hatch", style: { border: `1px solid ${UI.line}` } } : run.runKind === "filler" ? { className: "bg-[var(--lu-page)]", style: { border: `1px solid ${UI.line}` } } : { className: "bg-white", style: { border: `1.5px dashed ${UI.control}` } };
    return (
      <button type="button" onClick={click} aria-label={`${label} ${period}`} aria-pressed={selected} title={`${label}\n${period}`}
        className={cx("absolute flex items-center overflow-hidden rounded-[4px] px-2 text-left", look.className, ring, dim && "opacity-35")}
        style={{ left: `${left}%`, width: `${widthPct}%`, top: (rowH - barH) / 2, height: barH, ...look.style }}>
        {px > 36 && <span className="truncate text-[12px] font-semibold text-[var(--lu-text-2)]">{label}</span>}
      </button>
    );
  }

  // ── 첫방일만(끝·편수 없음): 시작 표식 + '기간 미정' — 임의 길이 막대를 그리지 않는다 ──
  if (extent === "start") {
    const c = GENRE_FILL[genre];
    const room = (((nextStart ? P(nextStart) : 100) - left) / 100) * totalPx - 8;
    return (
      <button type="button" onClick={click} aria-label={`${aria}, 종료일·편수 미정`} aria-pressed={selected} title={`${tip}\n종료일·편수 미정 — 시작일만 확인`}
        className={cx("absolute flex items-center gap-1.5 rounded-[3px] text-left", ring, dim && "opacity-35")}
        style={{ left: `${left}%`, top: (rowH - barH) / 2, height: barH, maxWidth: Math.max(28, Math.min(room, 320)) }}>
        <span aria-hidden className="h-full w-[3px] shrink-0 rounded-[1px]" style={{ background: c }} />
        <span aria-hidden className="size-0 shrink-0 border-y-[5px] border-l-[7px] border-y-transparent" style={{ borderLeftColor: c }} />
        {room > 40 && (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[12.5px] font-semibold text-[var(--lu-text)]">{title}</span>
            {density === "comfy" && <span className="lu-num truncate text-[11px] text-[var(--lu-text-2)]">{dateDot(run.startDate)}~ · 기간 미정{!own && run.status !== "confirmed" ? " · 예정" : ""}</span>}
          </span>
        )}
      </button>
    );
  }

  // ── 연속 편성 막대 ──
  const look = barLook(genre, own, run.status);
  const stripW = look.strip ? 3 : 0;
  const inner = px - 14 - stripW;
  // 글자 고르기 — 제목 먼저, 공간이 줄면 출연 → 편수 → 기간 순으로 뺀다(1년 보기는 제목·기간만)
  const parts = months >= 12 ? [period] : [period, eps, cast].filter(Boolean);
  let meta = parts.join(" · ");
  while (parts.length > 0 && textWidth(meta, META) > inner) {
    parts.pop();
    meta = parts.join(" · ");
  }
  const titleW = textWidth(title, FONT);
  const short = work?.shortTitle ?? null;
  const fitsTitle = titleW <= inner;
  const shownTitle = fitsTitle || !short || textWidth(short, FONT) > inner ? title : short;
  const markOnly = px < 60 && !fitsTitle && !(short && textWidth(short, FONT) <= inner);
  // 좁은 막대: 다음 막대 전 빈자리에 제목을 바깥에(없으면 표식만 — 제목은 툴팁·상세)
  let outsideW = 0;
  if (markOnly) {
    const room = ((nextStart ? P(nextStart) - right : 100 - right) / 100) * totalPx;
    const need = textWidth(title, FONT) + 10;
    if (room >= need) outsideW = need;
  }
  const twoLines = density === "comfy" && !markOnly && meta.length > 0;
  const showTag = run.status !== "confirmed" && !markOnly && inner - Math.min(titleW, inner) > 34;
  const estAt = d.estimatedFrom ? Math.max(0, Math.min(100, ((P(d.estimatedFrom) - left) / Math.max(widthPct, 0.0001)) * 100)) : null;
  // 상시(끝 열림): 오늘까지 채우고 뒤는 점선 꼬리
  const openAt = extent === "open" ? Math.max(0, Math.min(100, ((P(data.today < d.from ? d.from : data.today) - left) / Math.max(widthPct, 0.0001)) * 100)) : null;
  const fg = look.fg;
  const metaColor = look.onFill ? (genre === "business" ? "rgba(23,24,28,0.78)" : "rgba(255,255,255,0.86)") : UI.text2;

  return (
    <>
      <button
        type="button"
        onClick={click}
        aria-label={aria}
        aria-pressed={selected}
        title={footnote ? `[${footnote}] ${tip}` : tip}
        className={cx("absolute flex overflow-hidden rounded-[4px] text-left transition-opacity", ring, dim && "opacity-30")}
        style={{
          left: `${left}%`,
          width: `${widthPct}%`,
          minWidth: 4,
          top: (rowH - barH) / 2,
          height: barH,
          background: openAt !== null ? (own ? tint(GENRE_FILL[genre], 0.13) : "#fff") : look.bg,
          border: openAt !== null ? `1.5px dashed ${look.strip ?? GENRE_FILL[genre]}` : look.border,
          color: fg,
        }}
      >
        {/* 상시: 오늘까지 채움 */}
        {openAt !== null && own && <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: `${openAt}%`, background: GENRE_FILL[genre] }} />}
        {look.strip && <span aria-hidden className="relative z-[1] w-[3px] shrink-0" style={{ background: look.strip }} />}
        <span className={cx("relative z-[1] flex min-w-0 flex-1 flex-col justify-center", startsBefore ? "pl-1 pr-1.5" : "px-1.5")}>
          {(!markOnly || footnote !== undefined) && (
            <span className="flex min-w-0 items-center gap-1" style={{ lineHeight: "16px" }}>
              {startsBefore && <span aria-hidden className="shrink-0 text-[11px] opacity-80">‹</span>}
              <span className="truncate font-semibold" style={{ fontSize: density === "compact" ? 12.5 : FONT, color: openAt !== null && own && openAt > 30 ? GENRE_ON[genre] : undefined }}>
                {footnote ? `[${footnote}] ` : ""}{shownTitle}
              </span>
              {!twoLines && meta && textWidth(shownTitle, FONT) + textWidth(meta, META) + 10 <= inner && (
                <span className="lu-num truncate" style={{ fontSize: META, color: metaColor }}>{meta}</span>
              )}
              {showTag && <span className={cx("ml-auto shrink-0 rounded-[3px] border border-dashed px-1 text-[10.5px] leading-[14px] font-semibold", look.onFill ? "border-white/80" : "border-[var(--lu-text-2)] text-[var(--lu-text-2)]")}>{run.status === "planned" ? "예정" : "가안"}</span>}
              {run.needsReview && inner > 90 && <span className="shrink-0 rounded-[3px] bg-[var(--lu-text)] px-1 text-[10.5px] leading-[14px] text-white">확인</span>}
            </span>
          )}
          {twoLines && (
            <span className="lu-num truncate" style={{ fontSize: META, lineHeight: "14px", color: openAt !== null && own && openAt > 30 ? "rgba(255,255,255,0.86)" : metaColor }}>
              {meta}
            </span>
          )}
        </span>
        {/* 회차로 추정한 끝: 마지막 구간을 흐리게 + 점선 끝 */}
        {estAt !== null && (
          <span aria-hidden className="absolute inset-y-0 right-0 z-[2] border-r-2 border-dotted" style={{ left: `${estAt}%`, background: "linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,0.55))", borderColor: look.onFill ? "#fff" : UI.text2 }} />
        )}
      </button>
      {outsideW > 0 && (
        <span aria-hidden className="pointer-events-none absolute z-[2] truncate rounded-[3px] bg-white px-1 text-[12.5px] font-semibold text-[var(--lu-text)]" style={{ left: `calc(${right}% + 2px)`, top: (rowH - 18) / 2, lineHeight: "18px", maxWidth: outsideW }}>
          {title}
        </span>
      )}
    </>
  );
}

/** 단발·행사·OTT 공개일(마름모), 월 1회(점) — 자사는 채운 표식, 경쟁사·OTT는 흰 바탕 장르색 테두리. */
function Mark(props: {
  run: RunDto; work: WorkDto | undefined; slot: SlotDto | undefined; outlet: OutletDto | undefined; P: (d: string) => number; dayPx: number; size: number; selected: boolean; dim: boolean;
  onSelect: (id: string | null) => void; small?: boolean; rich?: boolean;
}) {
  const { run, work, slot, outlet, P, dayPx, size, selected, dim, onSelect, small, rich = false } = props;
  const d = run.draw!;
  const own = outlet?.side === "own";
  const genre = runGenre(run, work, slot);
  const c = GENRE_FILL[genre];
  const title = runTitle(run, work);
  const isDots = d.shape === "dots";
  const all = d.dates ?? [d.from];
  const inRange = all.filter((x) => P(x) > 0 && P(x) < 100);
  const dates = inRange.length > 0 ? inRange : [all[0]];
  const spreadPx = dates.length > 1 ? dayIndex(dates[0], dates[1]) * dayPx : 0;
  const marks = isDots || spreadPx >= 14 ? dates : [dates[0]];
  const kindWord = outlet?.ott ? "공개" : isDots ? "월 1회" : run.runKind === "multi_day" ? "행사" : "단발";
  const dateText = dates.length > 1 ? `${dateDot(dates[0])}–${dateDot(dates[dates.length - 1])}` : dateDot(dates[0]);
  const eps = episodeText(run, work);
  const cast = (work?.cast ?? []).slice(0, 3).join(", ");
  const fill = own ? c : "#fff";
  const edge = !own && genre === "business" ? UI.cyanOutlineAssist : c;
  return (
    <>
      {isDots && dates.length > 1 && <span aria-hidden className="pointer-events-none absolute top-1/2 border-t border-dashed" style={{ left: `${P(dates[0])}%`, width: `${P(dates[dates.length - 1]) - P(dates[0])}%`, borderColor: c }} />}
      {marks.map((x, i) => (
        <span
          key={x}
          aria-hidden
          className={cx("pointer-events-none absolute top-1/2", dim && "opacity-30")}
          style={{ left: `${P(x)}%`, width: size, height: size, background: fill, border: `1.5px solid ${edge}`, transform: `translate(-50%, -50%)${isDots ? "" : " rotate(45deg)"}`, borderRadius: isDots ? 9999 : 1, zIndex: i === 0 ? 2 : 1 }}
        />
      ))}
      <button
        type="button"
        onClick={() => onSelect(selected ? null : run.id)}
        aria-label={`${title} ${outlet?.name ?? ""} ${kindWord} ${all.join(", ")}`}
        aria-pressed={selected}
        title={`${title}\n${outlet?.name ?? ""} · ${kindWord} · ${all.map(dateDot).join(", ")}${eps ? `\n${eps}` : ""}${cast ? `\n${cast}` : ""}`}
        className={cx("absolute top-1/2 z-[3] flex -translate-y-1/2 items-center rounded-[3px] pr-1 text-left", selected && "ring-2 ring-[var(--lu-text)]", dim && "opacity-30")}
        style={{ left: `calc(${P(dates[0])}% - ${size / 2 + 2}px)`, paddingLeft: size + 6, minHeight: Math.max(size + 4, 18) }}
      >
        <span className="flex min-w-0 flex-col rounded-[3px] bg-white/90 px-0.5" style={{ maxWidth: rich ? 320 : 260 }}>
          <span className={cx("truncate whitespace-nowrap font-semibold text-[var(--lu-text)]", small ? "text-[11.5px]" : "text-[12.5px]")}>
            {title}
            <span className="lu-num ml-1 font-normal text-[var(--lu-text-2)]">{dateText}{marks.length < dates.length ? ` ×${dates.length}` : ""}{rich && eps ? ` · ${eps}` : ""}</span>
          </span>
          {rich && cast && <span className="truncate whitespace-nowrap text-[11px] leading-[14px] text-[var(--lu-text-2)]">{cast}</span>}
        </span>
      </button>
    </>
  );
}

/** 계산된 빈 주 — 앞뒤 편성 사이 자료상 빈 기간(확정 공백 여부는 확인 필요). 자사 자리는 빨간 글자. */
function Gap({ gap, P, dayPx, alert }: { gap: GapDto; P: (d: string) => number; dayPx: number; alert: boolean }) {
  const left = P(gap.from);
  const right = P(addDaysIso(gap.to, 1));
  const px = (dayIndex(gap.from, gap.to) + 1) * dayPx;
  const text = `${gap.weeks}주 비어있음`;
  return (
    <span
      role="note"
      aria-label={`${text} (${gap.from}~${gap.to}, 자료상 빈 기간)`}
      title={`${dateDot(gap.from)}–${dateDot(gap.to)} ${text}\n앞뒤 편성 사이 자료상 빈 기간 — 확정 공백인지 확인 필요`}
      className="absolute inset-y-0 flex items-center justify-center"
      style={{ left: `${left}%`, width: `${right - left}%` }}
    >
      <span aria-hidden className={cx("absolute inset-x-1 top-1/2 border-t border-dotted", alert ? "border-[var(--lu-danger)]" : "border-[var(--lu-control)]")} />
      {px > 64 && <span className={cx("relative bg-white px-1 text-[11.5px] font-semibold", alert ? "text-[var(--lu-danger)]" : "text-[var(--lu-text-2)]")}>{text}</span>}
    </span>
  );
}

/** 자사 드라마 자리의 마지막 편성 뒤 — 자료가 없을 뿐 확정 공백이 아니다(지시문 §5). */
function NoData({ from, P }: { from: string; P: (d: string) => number }) {
  return (
    <span className="pointer-events-none absolute inset-y-0 flex items-center" style={{ left: `calc(${P(from)}% + 6px)` }} title="이후 편성 자료 없음(확정 공백 아님)">
      <span className="text-[11px] text-[var(--lu-text-2)]">이후 자료 없음</span>
    </span>
  );
}

/** 외부 이벤트 띠의 칩 — 공휴일: 흰 바탕 + 달력 아이콘, 등록 이벤트: 회색 바탕 + 유형 아이콘, 중요도 높음: 검정. 예정은 점선. */
function EventChip({ ev, left, spanPct, top, onClick }: { ev: LaneEvent; left: number; spanPct: number; top: number; onClick?: (ev: LaneEvent) => void }) {
  const strong = ev.importance >= 3;
  const holiday = ev.kind === "holiday";
  const style: React.CSSProperties = {
    left: `${left}%`,
    top,
    minWidth: `${Math.max(spanPct, 0)}%`,
    background: strong ? UI.text : holiday ? "#fff" : UI.hover,
    color: strong ? "#fff" : UI.text,
    border: `1px ${ev.status !== "confirmed" ? "dashed" : "solid"} ${strong ? UI.text : UI.line}`,
  };
  const label = `${ev.title} · ${EVENT_KIND_LABEL[ev.kind] ?? "이벤트"} · ${ev.from === ev.to ? ev.from : `${ev.from}~${ev.to}`}${ev.time ? ` ${ev.time}` : ""}`;
  return (
    <button type="button" onClick={() => onClick?.(ev)} title={ev.names.length > 1 ? `${label}\n${ev.names.join(", ")}` : label} aria-label={label}
      className="absolute flex h-[19px] items-center gap-1 overflow-hidden rounded-[4px] px-1.5 text-[11.5px] font-semibold whitespace-nowrap" style={style}>
      <Icon name={EVENT_KIND_ICON[ev.kind] ?? "dot"} size={12} className={strong ? "text-white" : "text-[var(--lu-text-2)]"} />
      {ev.title}
    </button>
  );
}


