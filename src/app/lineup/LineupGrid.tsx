"use client";

// 라인업 격자 — 처음부터 <table> 하나로 그린다(docs/lineup/LINEUP_DESIGN.md §9): thead(월·주·공휴일/행사 띠)는 화면에서 위에 붙고
// 인쇄에서는 쪽마다 반복, 첫 열은 왼쪽에 붙는다. 막대는 각 줄 칸 안에서 기간 비율(%)로 놓아 화면 폭에 항상 맞는다.
// 바깥 상자는 .dense-grid(전역 '넓은 표 줄이기' 규칙을 피함). 막대 글자는 막대 폭(px)에 따라 2줄 → 1줄 → 줄임말 → 바깥 라벨 → 표식.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GapDto, LineupPayload, RunDto, SlotDto, WorkDto } from "@/lib/lineup/types";
import {
  addDaysIso, assignLanes, dayIndex, episodeText, GENRE_VAR, LAYOUT, OTT_CAST_MAX, ottLabelPx, pct, periodText, runGenre, runTitle, textWidth, type Density, type Row,
} from "@/lib/lineup/viewModel";

interface Props {
  data: LineupPayload;
  rows: Row[];
  runsBySlot: Map<string, RunDto[]>;
  density: Density;
  labelWidth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 경쟁 비교에서 막대를 고르면 맞대결이 아닌 막대의 채움·테두리만 흐리게(글자는 그대로). */
  focusIds: Set<string> | null;
  /** 인쇄·PDF용(/lineup/print) — 높이 제한·스크롤 없이 그리고, 제목이 다 안 들어간 막대는 번호를 달아 표 아래 각주로 풀네임을 쓴다. */
  printMode?: boolean;
  /** 막대 음영 기준 — genre: 장르색(KT ENA 보기), outlet: 방송사 로고색(경쟁 비교, 사용자 요청 2026-11-25). */
  colorBy?: "genre" | "outlet";
}

const MONTH_NAMES = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const FONT = 14; // 막대 제목 글자 크기(가독성 개선 2026-11-25: 12 → 14px)

export default function LineupGrid({ data, rows, runsBySlot, density, labelWidth, selectedId, onSelect, focusIds, printMode = false, colorBy = "genre" }: Props) {
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

  // 인쇄 각주 — 막대 안에 제목 풀네임이 다 들어가지 않는 연속 편성·칸에 줄 순서대로 번호를 단다(인쇄물에는 툴팁이 없다).
  const footnotes = useMemo(() => {
    const m = new Map<string, number>();
    if (!printMode) return m;
    for (const row of rows) {
      if (!row.slot) continue;
      for (const r of runsBySlot.get(row.slot.id) ?? []) {
        if (!r.draw || r.draw.shape === "diamond" || r.draw.shape === "dots") continue;
        const w = r.workId ? works.get(r.workId) : undefined;
        const left = pct(data.from, totalDays, r.draw.from);
        const right = pct(data.from, totalDays, addDaysIso(r.draw.to, 1));
        const px = Math.max(24, ((right - left) / 100) * tlWidth);
        if (textWidth(runTitle(r, w), FONT) > px - 14) m.set(r.id, m.size + 1);
      }
    }
    return m;
  }, [printMode, rows, runsBySlot, works, data.from, totalDays, tlWidth]);

  // 머리: 달, 주(월요일), 공휴일·행사
  const months = useMemo(() => {
    const out: { label: string; from: string; to: string }[] = [];
    let d = data.from.slice(0, 7) + "-01";
    while (d <= data.to) {
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7));
      const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      out.push({ label: `${m === 1 || out.length === 0 ? `${y}년 ` : ""}${MONTH_NAMES[m - 1]}`, from: d < data.from ? data.from : d, to: addDaysIso(next, -1) > data.to ? data.to : addDaysIso(next, -1) });
      d = next;
    }
    return out;
  }, [data.from, data.to]);
  const mondays = useMemo(() => {
    const out: string[] = [];
    let d = data.from;
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDaysIso(d, 1);
    for (; d <= data.to; d = addDaysIso(d, 7)) out.push(d);
    return out;
  }, [data.from, data.to]);
  const weekStep = 7 * dayPx < 22 ? 2 : 1;
  const todayIn = data.today >= data.from && data.today <= data.to;

  return (
    <div
      className={`dense-grid relative bg-white ${printMode ? "overflow-visible" : "overflow-auto rounded-lg border border-zinc-200 print:overflow-visible print:rounded-none print:border-0"}`}
      style={printMode ? undefined : { maxHeight: "calc(100vh - 210px)" }}
    >
      <div className="relative" style={printMode ? undefined : { minWidth: labelWidth + minTimeline }}>
        {/* 격자 바탕 — 달 경계·주 경계·지난 기간. 표 아래에 깔려 막대를 가리지 않는다(첫 열 오른쪽부터). */}
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 ${printMode ? "[print-color-adjust:exact]" : "print:hidden"}`} style={{ left: labelWidth, right: 0 }}>
          {todayIn && <div className="absolute inset-y-0 bg-zinc-100/70" style={{ left: 0, width: `${P(data.today)}%` }} />}
          {mondays.map((d) => (
            <div key={d} className="absolute inset-y-0 border-l border-zinc-100" style={{ left: `${P(d)}%` }} />
          ))}
          {months.slice(1).map((m) => (
            <div key={m.from} className="absolute inset-y-0 border-l border-zinc-300" style={{ left: `${P(m.from)}%` }} />
          ))}
        </div>
        <table className="relative z-[1] w-full table-fixed border-separate border-spacing-0 text-[14px]">
          <colgroup>
            <col style={{ width: labelWidth }} />
            <col />
          </colgroup>
          <thead className="sticky top-0 z-30 bg-white print:static">
            <tr>
              <th rowSpan={3} className="sticky left-0 z-40 border-b border-r border-zinc-200 bg-white px-3 text-left align-bottom text-[14px] font-semibold text-zinc-600 print:static">
                <span className="block pb-1.5">{rows.some((r) => r.chip) ? "방송사 · 자리" : "채널 · 자리"}</span>
              </th>
              <th ref={headRef} className="relative h-7 overflow-x-clip border-b border-zinc-200 p-0">
                {months.map((m) => (
                  <span
                    key={m.from}
                    className="absolute top-0 flex h-7 items-center overflow-hidden border-l border-zinc-300 pl-1.5 text-[14px] font-semibold text-zinc-800 whitespace-nowrap"
                    style={{ left: `${P(m.from)}%`, width: `${P(addDaysIso(m.to, 1)) - P(m.from)}%` }}
                  >
                    {m.label}
                  </span>
                ))}
              </th>
            </tr>
            <tr>
              <th className="relative h-5 overflow-x-clip border-b border-zinc-200 p-0 font-normal">
                {mondays.map((d, i) =>
                  i % weekStep === 0 ? (
                    <span key={d} className="absolute top-0 h-5 pl-1 text-[12.5px] leading-5 text-zinc-600 tabular-nums" style={{ left: `${P(d)}%` }}>
                      {Number(d.slice(8, 10))}
                    </span>
                  ) : null
                )}
                {todayIn && (
                  <span className="absolute top-0.5 z-10 -translate-x-1/2 rounded bg-zinc-900 px-1 text-[11px] font-semibold leading-4 text-white" style={{ left: `${P(data.today)}%` }}>
                    오늘
                  </span>
                )}
              </th>
            </tr>
            <tr>
              <th className="relative h-5 overflow-x-clip border-b border-zinc-300 p-0 font-normal">
                {data.holidays.map((h, i) => {
                  const prev = data.holidays[i - 1];
                  const room = prev ? (dayIndex(prev.date, h.date)) * dayPx : 999;
                  const next = data.holidays[i + 1];
                  const roomNext = next ? dayIndex(h.date, next.date) * dayPx : 999;
                  const showName = roomNext > textWidth(h.name, 11) + 10 && (room > 4 || !prev);
                  return (
                    <span key={h.date} title={`${h.date} ${h.name}`} className="absolute top-0 flex h-5 items-center gap-0.5 whitespace-nowrap text-[12.5px] text-zinc-700" style={{ left: `${P(h.date)}%` }}>
                      <span aria-hidden className="inline-block size-1.5 rounded-full bg-zinc-700" />
                      {showName ? h.name : <span className="sr-only">{h.name}</span>}
                    </span>
                  );
                })}
                {data.events.map((e) => (
                  <span
                    key={e.id}
                    title={`${e.name} ${e.startDate}~${e.endDate}`}
                    className="absolute top-0.5 h-4 overflow-hidden rounded-sm bg-zinc-800 px-1 text-[11px] leading-4 text-white whitespace-nowrap"
                    style={{ left: `${P(e.startDate)}%`, width: `max(14px, ${P(addDaysIso(e.endDate, 1)) - P(e.startDate)}%)` }}
                  >
                    {e.name}
                  </span>
                ))}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "group")
                return (
                  <tr key={row.key}>
                    <th colSpan={2} className="border-b border-zinc-300 bg-zinc-100 p-0 text-left">
                      <span className="sticky left-0 inline-block px-3 py-1 text-[14px] font-bold text-zinc-800">{row.label}</span>
                    </th>
                  </tr>
                );
              if (row.kind === "subgroup")
                return (
                  <tr key={row.key}>
                    <th colSpan={2} className="border-b border-zinc-200 bg-zinc-50 p-0 text-left">
                      <span className="sticky left-0 flex items-center gap-2 px-3 py-1 text-[15px] font-bold text-zinc-900">
                        <span aria-hidden className="inline-block h-3.5 w-1 rounded-sm ring-1 ring-black/10" style={{ background: row.color ?? "var(--border-control)" }} />
                        <OutletMark logo={row.outlet?.logo ?? null} name={row.label} height={18} rival={row.outlet?.side === "rival"} />
                      </span>
                    </th>
                  </tr>
                );
              const runs = row.slot ? runsBySlot.get(row.slot.id) ?? [] : [];
              // OTT 줄(2026-11-25): 공개일 마름모도 옆 제목·출연자 글자 폭만큼 자리를 차지하므로 막대와 같이 줄에 쌓는다.
              const isOtt = !!row.outlet?.ott;
              const lanes = assignLanes(runs, isOtt ? { labelDays: (r) => Math.ceil(ottLabelPx(r, r.workId ? works.get(r.workId) : undefined) / Math.max(dayPx, 0.5)) } : undefined);
              const height = lanes.main.length * L.row + (lanes.events.length > 0 ? L.event + 2 : 0);
              return (
                <tr key={row.key} className={row.emphasis ? "bg-sky-50/40" : undefined}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-20 border-b border-r border-zinc-200 px-0 text-left align-middle font-normal print:static ${row.emphasis ? "bg-sky-50" : "bg-white"}`}
                    style={{ height }}
                  >
                    <div className="flex h-full items-center gap-1.5 pr-2">
                      <span aria-hidden className="h-full w-1 shrink-0" style={{ background: row.color ?? "transparent" }} />
                      {row.chip !== undefined && (
                        <span className="inline-flex w-10 shrink-0 justify-center rounded bg-zinc-100 py-0.5 text-[12.5px] font-semibold text-zinc-700">{row.chip}</span>
                      )}
                      <span className="min-w-0 flex-1">
                        {/* 경쟁 비교(요일 칩이 있는 줄)는 방송사 로고로 구분한다(그림이 없으면 이름 글자). */}
                        <span className={`block truncate ${row.emphasis ? "font-bold text-zinc-900" : "font-medium text-zinc-800"}`}>
                          {row.chip !== undefined ? <OutletMark logo={row.outlet?.logo ?? null} name={row.label} height={density === "compact" ? 16 : 18} rival={row.outlet?.side === "rival"} /> : row.label}
                        </span>
                        {row.sublabel && density === "comfy" && <span className="block truncate text-[12.5px] text-zinc-600">{row.sublabel}</span>}
                      </span>
                      {row.sublabel && density === "compact" && <span className="shrink-0 text-[12.5px] text-zinc-600 tabular-nums">{row.sublabel}</span>}
                    </div>
                  </th>
                  <td className="relative overflow-x-clip border-b border-zinc-200 p-0 align-top" style={{ height }}>
                    {lanes.events.length > 0 && (
                      <div className="relative" style={{ height: L.event + 2 }}>
                        {lanes.events.map((r) => (
                          <Diamonds key={r.id} run={r} work={r.workId ? works.get(r.workId) : undefined} slot={row.slot} P={P} dayPx={dayPx} size={L.event - 4} selected={selectedId === r.id} dim={!!focusIds && !focusIds.has(r.id)} onSelect={onSelect} compact />
                        ))}
                      </div>
                    )}
                    {lanes.main.map((lane, li) => (
                      <div key={li} className="relative" style={{ height: L.row }}>
                        {row.slot &&
                          li === 0 &&
                          (gapsBySlot.get(row.slot.id) ?? []).map((g) => (
                            <Gap key={g.from} gap={g} P={P} dayPx={dayPx} alert={row.outlet?.side === "own" && row.slot?.defaultGenre === "drama"} />
                          ))}
                        {lane.map((r, i) => {
                          const nextStart = lane[i + 1]?.draw?.from ?? null;
                          const work = r.workId ? works.get(r.workId) : undefined;
                          if (r.draw?.shape === "diamond" || r.draw?.shape === "dots")
                            return (
                              <Diamonds
                                key={r.id}
                                run={r}
                                work={work}
                                slot={row.slot}
                                P={P}
                                dayPx={dayPx}
                                size={12}
                                selected={selectedId === r.id}
                                dim={!!focusIds && !focusIds.has(r.id)}
                                onSelect={onSelect}
                                tone={colorBy === "outlet" ? row.outlet?.color ?? null : null}
                                rich={isOtt}
                              />
                            );
                          return (
                            <Bar
                              key={r.id}
                              run={r}
                              work={work}
                              slot={row.slot}
                              data={data}
                              P={P}
                              dayPx={dayPx}
                              barH={L.bar}
                              rowH={L.row}
                              density={density}
                              nextStart={nextStart}
                              selected={selectedId === r.id}
                              dim={!!focusIds && !focusIds.has(r.id)}
                              onSelect={onSelect}
                              footnote={footnotes.get(r.id)}
                              tone={colorBy === "outlet" ? row.outlet?.color ?? null : null}
                              ott={isOtt}
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
        {/* 오늘선 — 막대 위에 2px로 지나간다(누르기는 막지 않음). */}
        {todayIn && (
          <div aria-hidden className={`pointer-events-none absolute inset-y-0 z-[2] ${printMode ? "print:[print-color-adjust:exact]" : "print:hidden"}`} style={{ left: labelWidth, right: 0 }}>
            <div className="absolute inset-y-0 w-0.5 bg-zinc-900" style={{ left: `${P(data.today)}%` }} />
          </div>
        )}
      </div>
      {printMode && footnotes.size > 0 && (
        <section className="mt-2 break-inside-avoid-page text-[12.5px] leading-snug text-zinc-800">
          <h3 className="mb-0.5 font-bold">막대에 다 쓰지 못한 제목</h3>
          <ol className="columns-3 gap-6">
            {[...footnotes.entries()].map(([id, n]) => {
              const r = data.runs.find((x) => x.id === id);
              if (!r) return null;
              const w = r.workId ? works.get(r.workId) : undefined;
              return (
                <li key={id} className="break-inside-avoid">
                  <b className="tabular-nums">[{n}]</b> {runTitle(r, w)} <span className="text-zinc-600">· {periodText(r)} {episodeText(r, w)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

function fillStyle(genre: string, run: RunDto, dim: boolean, tone: string | null) {
  const c = tone ?? GENRE_VAR[genre as keyof typeof GENRE_VAR];
  const est = run.draw?.estimatedFrom;
  const base = `color-mix(in srgb, ${c} ${dim ? 5 : 16}%, white)`;
  return {
    background:
      est && run.draw
        ? `linear-gradient(to right, ${base} 0%, ${base} var(--est-at), color-mix(in srgb, ${c} 3%, white) 100%)`
        : base,
    borderColor: dim ? `color-mix(in srgb, ${c} 30%, white)` : c,
  };
}

function Bar(props: {
  run: RunDto; work: WorkDto | undefined; slot: SlotDto | undefined; data: LineupPayload; P: (d: string) => number; dayPx: number;
  barH: number; rowH: number; density: Density; nextStart: string | null; selected: boolean; dim: boolean; onSelect: (id: string | null) => void; footnote?: number; tone?: string | null;
  ott?: boolean;
}) {
  const { run, work, slot, data, P, dayPx, barH, rowH, density, nextStart, selected, dim, onSelect, footnote, tone = null, ott = false } = props;
  const d = run.draw!;
  const startsBefore = d.from < data.from;
  const left = P(d.from);
  const right = P(addDaysIso(d.to, 1));
  const widthPct = Math.max(0, right - left);
  const px = (widthPct / 100) * (dayPx * (dayIndex(data.from, data.to) + 1));
  const genre = runGenre(run, work, slot);
  const title = runTitle(run, work);
  const short = work?.shortTitle ?? null;
  // 출연자(드라마 주연·예능 출연자/MC) — 넓으면 여러 명, 막대 폭만큼만 보인다.
  const cast2 = (work?.cast ?? []).slice(0, ott ? OTT_CAST_MAX : 6).join(", ");
  const meta = [periodText(run), episodeText(run, work)].filter(Boolean).join(", ");
  const sub = [meta, cast2].filter(Boolean).join(" · ");
  const isBracket = d.shape === "bracket";
  const isBox = d.shape === "box";
  const dashed = run.status !== "confirmed" || run.runKind === "tbd";
  const aria = `${title} ${periodText(run)} ${episodeText(run, work)} ${run.status === "confirmed" ? "확정" : "예정"}`;

  // 글자 고르기: 2줄(넉넉·168px+) → 제목 1줄(88px+) → 줄임말/제목 잘라 쓰기(40px+) → 바깥 라벨(다음 막대 전 빈자리) → 표식만
  const inner = px - 12;
  let mode: "two" | "one" | "short" | "outside" | "mark";
  if (px >= 56) mode = "two"; // 밀도와 관계없이 2줄: 제목 + 기간·회차 / 출연자
  else if (px >= 88 || textWidth(title, FONT) <= inner) mode = "one";
  else if (px >= 40) mode = "short";
  else mode = "outside";
  // 아주 좁은 막대는 다음 막대 전까지 빈자리가 넉넉하면 제목을 막대 오른쪽 바깥에 쓴다(없으면 표식만, 제목은 툴팁·상세 패널).
  let outsideW = 0;
  if (mode === "outside") {
    const W = dayPx * (dayIndex(data.from, data.to) + 1);
    const room = ((nextStart ? P(nextStart) - right : 100 - right) / 100) * W;
    const need = textWidth(title, FONT) + 10;
    if (room >= need) outsideW = need;
    else mode = "mark";
  }
  const shownTitle = mode === "short" ? (short && textWidth(short, FONT) <= inner ? short : title) : title;
  const estAt = d.estimatedFrom ? `${Math.max(0, Math.min(100, ((P(d.estimatedFrom) - left) / Math.max(widthPct, 0.0001)) * 100))}%` : "100%";

  if (isBracket) {
    // 월 단위 정밀도 — 막대 대신 범위 괄호(├─┤) + '월 단위' + 원문 기간.
    const c = tone ?? GENRE_VAR[genre];
    return (
      <button
        type="button"
        onClick={() => onSelect(selected ? null : run.id)}
        aria-label={`${aria} (월 단위 일정)`}
        aria-pressed={selected}
        className={`absolute top-0 flex flex-col justify-end text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 ${ott ? "overflow-visible" : ""} ${selected ? "ring-2 ring-zinc-900" : ""}`}
        style={{ left: `${left}%`, width: `${widthPct}%`, minWidth: 24, height: rowH, opacity: 1 }}
        title={`${title} · ${periodText(run)}(월 단위) ${episodeText(run, work)}`}
      >
        {/* OTT 줄은 글자 자리를 줄 쌓기에서 따로 잡아 두었으므로 괄호보다 글자가 길어도 잘라내지 않고 오른쪽으로 보인다. */}
        <span className={`${ott ? "whitespace-nowrap" : "truncate"} px-1 text-[14px] leading-5 font-semibold text-zinc-900`}>
          {ott ? title : shownTitle} <span className="font-normal text-zinc-600">· {periodText(run)}{/[년반기]/.test(periodText(run)) ? "" : " 월 단위"}</span>
        </span>
        {/* 둘째 줄: 회차·출연자 — 넉넉한 줄 높이에서만(촘촘은 높이가 모자라 첫 줄에 회차만). */}
        {density === "comfy" && (episodeText(run, work) || cast2) && (
          <span className={`${ott ? "whitespace-nowrap" : "truncate"} px-1 text-[12.5px] leading-[17px] font-normal text-zinc-700`}>{[episodeText(run, work), cast2].filter(Boolean).join(" · ")}</span>
        )}
        <span aria-hidden className="relative mx-0.5 mb-1.5 block h-2" style={{ borderLeft: `2px solid ${c}`, borderRight: `2px solid ${c}`, opacity: dim ? 0.3 : 1 }}>
          <span className="absolute inset-x-0 top-1/2 block h-0.5 -translate-y-1/2" style={{ background: c }} />
        </span>
      </button>
    );
  }

  const boxStyle: React.CSSProperties = isBox
    ? run.runKind === "filler"
      ? { background: "var(--surface-muted)", borderColor: "var(--border-control)" }
      : run.runKind === "hiatus"
        ? { background: "repeating-linear-gradient(135deg, #fff 0 4px, #e4e4e7 4px 6px)", borderColor: "var(--border-control)" }
        : { background: "#fff", borderColor: "var(--border-control)" }
    : fillStyle(genre, run, dim, tone);
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(selected ? null : run.id)}
        aria-label={aria}
        aria-pressed={selected}
        title={`${title}\n${sub}${run.needsReview ? "\n확인 필요" : ""}`}
        className={`absolute flex overflow-hidden rounded-[4px] text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 print:[print-color-adjust:exact] ${selected ? "ring-2 ring-zinc-900 ring-offset-1" : ""}`}
        style={{
          left: `${left}%`,
          width: `${widthPct}%`,
          minWidth: 24,
          top: (rowH - barH) / 2,
          height: barH,
          borderWidth: dashed ? 1.5 : 1,
          borderStyle: dashed ? "dashed" : "solid",
          ...boxStyle,
          ["--est-at" as string]: estAt,
        }}
      >
        {!isBox && <span aria-hidden className="w-1 shrink-0" style={{ background: dim ? "transparent" : tone ?? GENRE_VAR[genre] }} />}
        <span className={`flex min-w-0 flex-1 flex-col justify-center px-1.5 ${startsBefore ? "pl-1" : ""}`}>
          {(footnote !== undefined || (mode !== "outside" && mode !== "mark")) && (
            <span className="flex min-w-0 items-baseline gap-1 leading-5">
              {startsBefore && <span aria-hidden className="shrink-0 text-[11px] text-zinc-600">◀</span>}
              {/* 1줄: 제목(굵게)이 먼저 자리를 차지하고 기간·회차(가늘게)는 남는 폭만큼. 2줄: 출연자(드라마 주연·예능 출연자/MC).
                  사용자 요청(2026-11-25): 방영 기간·회차·출연자는 중요하니 드라마·예능 모두 함께 — 편성센터 라인업 모양. */}
              <span className={`max-w-full shrink-0 truncate font-semibold ${isBox ? "font-medium text-zinc-700" : "text-zinc-900"}`}>{footnote ? `[${footnote}] ` : ""}{shownTitle}</span>
              {mode === "two" && meta && <span className="min-w-0 truncate text-[12.5px] font-normal text-zinc-700">{meta}</span>}
              {run.needsReview && <span className="shrink-0 rounded bg-zinc-900 px-1 text-[11px] leading-4 text-white">확인</span>}
              {run.startPrecision === "week" && mode !== "two" && <span className="sr-only">주 단위 일정</span>}
            </span>
          )}
          {mode === "two" && cast2 && <span className="truncate text-[12.5px] leading-[17px] font-normal text-zinc-700">{cast2}</span>}
        </span>
        {d.estimatedFrom && <span aria-hidden className="absolute top-0 right-0 bottom-0 border-r-2 border-dotted border-zinc-500" />}
      </button>
      {outsideW > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute z-[1] truncate rounded-sm bg-white/90 px-1 text-[14px] font-semibold text-zinc-900"
          style={{ left: `calc(${right}% + 3px)`, top: (rowH - 18) / 2, lineHeight: "18px", maxWidth: outsideW }}
        >
          {title}
        </span>
      )}
    </>
  );
}

function Diamonds(props: {
  run: RunDto; work: WorkDto | undefined; slot: SlotDto | undefined; P: (d: string) => number; dayPx: number; size: number; selected: boolean; dim: boolean;
  onSelect: (id: string | null) => void; compact?: boolean; tone?: string | null; rich?: boolean;
}) {
  const { run, work, slot, P, dayPx, size, selected, dim, onSelect, compact, tone = null, rich = false } = props;
  const d = run.draw!;
  const genre = runGenre(run, work, slot);
  const c = tone ?? GENRE_VAR[genre];
  const title = runTitle(run, work);
  // rich(OTT 공개일): 제목(굵게)+공개일·회차(가늘게) / 출연자 2줄 — 방영 기간·회차·출연자는 늘 함께(사용자 요청 2026-11-25)
  const meta = rich ? [periodText(run), episodeText(run, work)].filter(Boolean).join(", ") : "";
  const cast = rich ? (work?.cast ?? []).slice(0, OTT_CAST_MAX).join(", ") : "";
  // 기간 밖 방송일(월 1회의 지난 달 등)은 그리지 않는다. 글자는 보이는 첫 방송일에 붙인다.
  const all = d.dates ?? [d.from];
  const inRange = all.filter((x) => P(x) > 0 && P(x) < 100);
  const dates = inRange.length > 0 ? inRange : [all[0]];
  const isDots = d.shape === "dots";
  // 이틀 이상 행사는 마름모 사이가 14px 미만이면 하나만 그리고 ×N으로 쓴다.
  const spreadPx = dates.length > 1 ? dayIndex(dates[0], dates[1]) * dayPx : 0;
  const marks = isDots || spreadPx >= 14 ? dates : [dates[0]];
  const shape = (x: string, i: number) => (
    <span
      key={x}
      aria-hidden
      className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${P(x)}%`, width: size, height: size, background: dim ? "white" : c, border: `1.5px solid ${c}`, transform: `translate(-50%, -50%)${isDots ? "" : " rotate(45deg)"}`, borderRadius: isDots ? 9999 : 1, zIndex: i === 0 ? 2 : 1 }}
    />
  );
  return (
    <>
      {isDots && dates.length > 1 && (
        <span aria-hidden className="pointer-events-none absolute top-1/2 border-t border-dashed" style={{ left: `${P(dates[0])}%`, width: `${P(dates[dates.length - 1]) - P(dates[0])}%`, borderColor: c }} />
      )}
      {marks.map(shape)}
      <button
        type="button"
        onClick={() => onSelect(selected ? null : run.id)}
        aria-label={`${title} ${isDots ? "월 1회" : "단발"} ${all.join(", ")}`}
        aria-pressed={selected}
        title={`${title}\n${all.map((x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`).join(", ")}`}
        className={`absolute top-1/2 z-[3] flex -translate-y-1/2 items-center rounded-sm pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 ${selected ? "ring-2 ring-zinc-900" : ""}`}
        style={{ left: `calc(${P(dates[0])}% - ${size / 2 + 2}px)`, paddingLeft: size + 6, minHeight: Math.max(size + 4, 18) }}
      >
        {rich ? (
          <span className="flex min-w-0 flex-col rounded-sm bg-white/85 px-0.5" style={{ maxWidth: 340 }}>
            <span className="truncate whitespace-nowrap text-[14px] leading-5 font-semibold text-zinc-900">
              {title}
              {meta && <span className="ml-1 text-[12.5px] font-normal text-zinc-700">{meta}</span>}
            </span>
            {cast && <span className="truncate whitespace-nowrap text-[12.5px] leading-[17px] font-normal text-zinc-700">{cast}</span>}
          </span>
        ) : (
          <span className={`truncate whitespace-nowrap rounded-sm bg-white/85 font-semibold text-zinc-900 ${compact ? "text-[12.5px]" : "text-[14px]"}`}>
            {title}
            {marks.length < dates.length && <span className="ml-0.5 font-normal text-zinc-600">×{dates.length}</span>}
          </span>
        )}
      </button>
    </>
  );
}

/** 계산된 빈 주 — 'N주 비어있음'. 자사 드라마 자리가 비면 붉은 글자·밑줄로 눈에 띄게(사용자 요청 2026-11-25). */
function Gap({ gap, P, dayPx, alert }: { gap: GapDto; P: (d: string) => number; dayPx: number; alert: boolean }) {
  const left = P(gap.from);
  const right = P(addDaysIso(gap.to, 1));
  const px = (dayIndex(gap.from, gap.to) + 1) * dayPx;
  const text = `${gap.weeks}주 비어있음`;
  return (
    <span
      aria-label={text}
      title={`${gap.from} ~ ${gap.to} ${text}`}
      className={`absolute bottom-1 flex justify-center border-b border-dotted ${alert ? "border-red-600" : "border-zinc-500"}`}
      style={{ left: `${left}%`, width: `${right - left}%` }}
    >
      {px > 56 && <span className={`text-[12.5px] leading-4 ${alert ? "font-semibold text-red-700" : "text-zinc-600"}`}>{text}</span>}
    </span>
  );
}

/** 방송사 로고(높이 고정, 원본 비율). 그림을 못 읽으면 이름 글자로 바꾼다.
 *  사용자 요청(2026-11-25): 타사 로고는 자사(ENA) 로고보다 조금 작게 — 높이·최대 폭을 약 20% 줄인다. */
function OutletMark({ logo, name, height, rival = false }: { logo: string | null; name: string; height: number; rival?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!logo || broken) return <>{name}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 작은 정적 로고(public)라 next/image 최적화가 필요 없다
    <img
      src={logo}
      alt={name}
      title={name}
      onError={() => setBroken(true)}
      className="inline-block w-auto object-contain align-middle print:[print-color-adjust:exact]"
      style={{ height: rival ? Math.round(height * 0.8) : height, maxWidth: rival ? 58 : 72 }}
    />
  );
}
