"use client";

// 라인업 캘린더(월간·주간) — 2026-11-26 전면 리디자인(docs/lineup/REDESIGN_2026-11.md §5, 지시문 §7).
// 월간: 흰 칸·얇은 선·일정한 높이. 날짜 숫자 → 종일 이벤트 띠(여러 날은 이어서) → 일정 3~4개 + '+N개'. 칸이 무한히 커지지 않는다.
//   자사 중요 일정(첫방·종영·단발) = 장르색 채움, 자사 일반 회차 = 작은 점 + 시각·회차, 경쟁사·OTT = 흰 바탕 + 장르색 강조선, 방영 가능 = 점선.
// 주간: 종일 영역 · 시각 미정 영역 · 시간축. 실제 종료 시각을 모르므로 길이(지속 시간)를 그리지 않고 시작 시각에 한 줄로 놓는다(임의 00:00 금지).
// 날짜를 누르면 오른쪽 그날 패널(넓은 화면 고정, 좁은 화면 겹침). 계산은 lib/lineup/calendar.ts(순수 함수), 여기는 그리기만 한다.
import { useMemo } from "react";
import { barWeekDays, dayAirings, type CalBar, type CalBarDay, type CalMark, type CalModel, type CalWeek, type DayRow } from "@/lib/lineup/calendar";
import { clockLabel } from "@/lib/lineup/dates";
import { EVENT_KIND_ICON, EVENT_KIND_LABEL, type LaneEvent } from "@/lib/lineup/events";
import { dateDot, GENRE_LABEL, runMatchesQuery, textWidth } from "@/lib/lineup/viewModel";
import { GENRE_FILL, GENRE_ON, tint, UI } from "@/lib/lineup/tokens";
import type { Genre, LineupPayload } from "@/lib/lineup/types";
import { cx, Icon } from "./ui";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const dowOf = (d: string) => DOW[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7];
const ITEM_H = 20;
const BAND_H = 20;

/** 한 날짜 칸의 일정 한 줄 */
type Item =
  | { type: "own"; key: string; bar: CalBar; day: CalBarDay; prio: number; minute: number | null }
  | { type: "gap"; key: string; bar: CalBar; prio: number; minute: number | null }
  | { type: "mark"; key: string; mark: CalMark; prio: number; minute: number | null };

function ownTag(bar: CalBar, day: CalBarDay): string {
  if (bar.single) return bar.meta === "월 1회" ? "월 1회" : "특집";
  if (day.kind === "first") return "첫방";
  if (day.last) return "종영";
  return "";
}

/** 그 주의 그 날짜 일정 — 우선순위: 자사 첫방·종영·단발 → 경쟁·OTT 첫방·공개·종영 → 자사 일반 회차 → 방영 가능 → 빈 자리. 같은 순위는 시각순. */
function itemsOf(week: CalWeek, col: number, works: { query: string; matches: (runId: string) => boolean }, keyOnly = false): Item[] {
  const date = week.days[col].date;
  const out: Item[] = [];
  for (const b of week.bars) {
    for (const d of barWeekDays(b, week.start)) {
      if (d.col !== col) continue;
      if (b.kind === "gap") {
        if (d.date === b.days[0].date || d.date === week.start) out.push({ type: "gap", key: `${b.key}:${date}`, bar: b, prio: 5, minute: b.minute });
        continue;
      }
      if (works.query && b.runId && !works.matches(b.runId)) continue;
      const key = !!ownTag(b, d);
      if (keyOnly && !key) continue; // 주요 일정: 자사는 첫방·종영·특집만
      out.push({ type: "own", key: `${b.key}:${date}`, bar: b, day: d, prio: key ? 0 : 2, minute: b.minute });
    }
  }
  for (const m of week.days[col].marks) {
    if (works.query && !works.matches(m.runId)) continue;
    out.push({ type: "mark", key: m.key, mark: m, prio: m.kind === "avail" ? 4 : 1, minute: m.minute ?? null });
  }
  return out.sort((a, b) => a.prio - b.prio || (a.minute ?? 99999) - (b.minute ?? 99999));
}

/** 자사 일정 한 줄 — 중요(첫방·종영·특집)는 장르색 채움, 일반 회차는 점 + 시각·회차. 예정은 옅은 바탕 + 점선. */
function OwnItem({ bar, day, selected, onSelect, multiOutlet, week = false }: { bar: CalBar; day: CalBarDay; selected: boolean; onSelect: (id: string) => void; multiOutlet: boolean; week?: boolean }) {
  const tag = ownTag(bar, day);
  const c = GENRE_FILL[bar.genre];
  const planned = bar.status !== "confirmed";
  const title = bar.shortTitle && textWidth(bar.title, 12.5) > 120 ? bar.shortTitle : bar.title;
  const label = `${multiOutlet ? `${bar.outletName} ` : ""}${bar.title} ${bar.time} ${day.episode} ${tag} ${planned ? "예정" : ""}`;
  if (tag === "종영") return <EndItem title={title} outlet={multiOutlet ? bar.outletName : ""} genre={bar.genre} onClick={() => bar.runId && onSelect(bar.runId)} selected={selected} tip={`${bar.title}\n${bar.meta}`} />;
  if (tag) {
    return (
      <button type="button" onClick={() => bar.runId && onSelect(bar.runId)} title={`${bar.title}\n${bar.meta}${bar.cast ? `\n${bar.cast}` : ""}`} aria-label={label}
        className={cx("flex w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[12px] font-semibold", selected && "outline outline-2 outline-offset-1 outline-[var(--lu-text)]")}
        style={{ height: ITEM_H, background: planned ? tint(c, 0.13) : c, color: planned ? UI.text : GENRE_ON[bar.genre], border: planned ? `1.5px dashed ${c}` : undefined }}>
        {multiOutlet && <span className="shrink-0 text-[10.5px] opacity-85">{bar.outletName}</span>}
        {tag === "첫방" && <Icon name="start" size={11} className="opacity-90" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-[10.5px] font-semibold opacity-90">{tag}</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => bar.runId && onSelect(bar.runId)} title={`${bar.title}\n${bar.meta}`} aria-label={label}
      className={cx("flex w-full min-w-0 items-center gap-1 rounded-[3px] px-1 text-left text-[12px]", week ? "border-l-[3px]" : "hover:bg-[var(--lu-hover)]", selected && "outline outline-2 outline-offset-1 outline-[var(--lu-text)]")}
      style={{ height: ITEM_H, ...(week ? { borderLeftColor: c, background: tint(c, 0.08) } : {}) }}>
      {!week && <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: c, outline: planned ? `1px dashed ${c}` : undefined, outlineOffset: 1 }} />}
      {bar.time && <span className="lu-num shrink-0 text-[11px] text-[var(--lu-text-2)]">{bar.time}</span>}
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--lu-text)]">{title}</span>
      {day.episode && <span title={day.episode} className="lu-num max-w-[48%] shrink truncate text-[11px] text-[var(--lu-text-2)]">{day.episode}</span>}
    </button>
  );
}

const MARK_TAG: Record<string, (m: CalMark) => string> = {
  first: () => "첫방",
  end: (m) => (m.approx ? "종영≈" : "종영"),
  open: (m) => (m.ott ? "공개" : "단발"),
  air: () => "방송",
  avail: () => "",
};

/** 경쟁사·OTT 일정 — 흰 바탕 + 장르색 강조선(Style 2). 방영 가능(홀드백)은 ENA 블루 점선. */
function MarkItem({ m, selected, onSelect }: { m: CalMark; selected: boolean; onSelect: (id: string) => void }) {
  const ring = selected && "outline outline-2 outline-offset-1 outline-[var(--lu-text)]";
  if (m.kind === "avail")
    return (
      <button type="button" onClick={() => onSelect(m.runId)} title={`${m.outletName} 방영 가능 ${m.note ?? ""} — ${m.title}`} aria-label={`${m.outletName} 방영 가능 ${m.note ?? ""} ${m.title}`}
        className={cx("flex w-full min-w-0 items-center gap-1 rounded-[3px] bg-white px-1.5 text-left text-[12px]", ring)} style={{ height: ITEM_H, border: `1px dashed ${UI.accent}` }}>
        <span aria-hidden className="shrink-0 text-[10px] text-[var(--lu-accent)]">◇</span>
        <span className="lu-num shrink-0 text-[11px] font-semibold text-[var(--lu-accent)]">{m.note}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--lu-text)]">{m.shortTitle && textWidth(m.title, 12) > 110 ? m.shortTitle : m.title}</span>
      </button>
    );
  const g = (m.genre ?? "other") as Genre;
  const c = GENRE_FILL[g];
  const planned = m.status && m.status !== "confirmed";
  const title = m.shortTitle && textWidth(m.title, 12) > 104 ? m.shortTitle : m.title;
  if (m.kind === "end") return <EndItem title={title} outlet={m.outletName} genre={g} onClick={() => onSelect(m.runId)} selected={selected} tip={`${m.outletName} ${m.title} ${MARK_TAG.end(m)}`} approx={m.approx} />;
  return (
    <button type="button" onClick={() => onSelect(m.runId)} title={`${m.outletName} ${m.title} ${MARK_TAG[m.kind](m)}${planned ? " (예정)" : ""}`} aria-label={`${m.outletName} ${m.title} ${MARK_TAG[m.kind](m)}${planned ? " 예정" : ""}`}
      className={cx("flex w-full min-w-0 items-center gap-1 rounded-[3px] bg-white pr-1.5 text-left text-[12px]", ring)}
      style={{ height: ITEM_H, border: `1px ${planned ? "dashed" : "solid"} ${UI.grid}`, borderLeft: `3px solid ${c}`, paddingLeft: 4 }}>
      {m.kind === "first" && <Icon name="start" size={11} className="text-[var(--lu-text-2)]" />}
      {m.kind === "open" && m.ott && <span className="shrink-0" style={{ color: g === "business" ? UI.cyanOutlineAssist : c }}><Icon name="diamond" size={9} /></span>}
      <span className="shrink-0 text-[10.5px] font-semibold text-[var(--lu-text-2)]">{m.outletName}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--lu-text)]">{title}</span>
      <span className="shrink-0 text-[10.5px] font-semibold text-[var(--lu-text-2)]">{MARK_TAG[m.kind](m)}</span>
    </button>
  );
}

/** 종영 — 흰 바탕 + 장르색 가는 실선 테두리 + 종료 아이콘, 제목은 장르색 글자. 2차 개선(§7.1): 예정의 점선과 같은 모양을 쓰지 않는다(첫 지시의 점선에서 바꿈).
 *  밝은 시안(사업형)은 흰 바탕 대비가 낮아 테두리는 보조 회색, 제목은 어두운 글씨. */
function EndItem({ title, outlet, genre, onClick, selected, tip, approx = false }: { title: string; outlet: string; genre: Genre; onClick: () => void; selected: boolean; tip: string; approx?: boolean }) {
  const c = GENRE_FILL[genre];
  return (
    <button type="button" onClick={onClick} title={tip} aria-label={`${outlet} ${title} 종영`}
      className={cx("flex w-full min-w-0 items-center gap-1 rounded-[3px] bg-white px-1.5 text-left text-[12px]", selected && "outline outline-2 outline-offset-1 outline-[var(--lu-text)]")}
      style={{ height: ITEM_H, border: `1px solid ${genre === "business" ? UI.cyanOutlineAssist : c}` }}>
      <Icon name="end" size={11} className="text-[var(--lu-text-2)]" />
      {outlet && <span className="shrink-0 text-[10.5px] font-semibold text-[var(--lu-text-2)]">{outlet}</span>}
      <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: genre === "business" ? UI.text : c }}>{title}</span>
      <span className="shrink-0 text-[10.5px] font-semibold text-[var(--lu-text-2)]">{approx ? "종영≈" : "종영"}</span>
    </button>
  );
}

function GapItem({ bar, onClick }: { bar: CalBar; onClick: () => void }) {
  // 확인된 공백만 붉게(P0-01) — 추정 공백('≈')은 회색
  const sure = !bar.title.startsWith("≈");
  return (
    <button type="button" onClick={onClick} title={`${bar.outletName} ${bar.meta} — ${sure ? "앞 편성 종영·뒤 편성 첫방이 확인된 사이 기간" : "앞 편성 종영 또는 뒤 편성 첫방이 추정이라 공백도 추정"}`}
      className={cx("flex w-full min-w-0 items-center gap-1 rounded-[3px] px-1 text-left text-[11.5px] font-semibold", sure ? "text-[var(--lu-danger)]" : "text-[var(--lu-text-2)]")} style={{ height: ITEM_H }}>
      <span aria-hidden className={cx("h-0 w-3 shrink-0 border-t border-dotted", sure ? "border-[var(--lu-danger)]" : "border-[var(--lu-control)]")} />
      <span className="truncate">{bar.time} {bar.title}</span>
    </button>
  );
}

function Band({ b, onSelect }: { b: { ev: LaneEvent; col0: number; col1: number; row: number; contFromPrev: boolean; contToNext: boolean }; onSelect?: (ev: LaneEvent) => void }) {
  const ev = b.ev;
  const strong = ev.importance >= 3;
  const holiday = ev.kind === "holiday";
  return (
    <button
      type="button"
      onClick={() => onSelect?.(ev)}
      title={`${ev.title} · ${EVENT_KIND_LABEL[ev.kind] ?? "이벤트"} · ${ev.from === ev.to ? ev.from : `${ev.from}~${ev.to}`}${ev.names.length > 1 ? `\n${ev.names.join(", ")}` : ""}`}
      aria-label={`${ev.title} ${EVENT_KIND_LABEL[ev.kind] ?? "이벤트"} ${ev.from}${ev.from !== ev.to ? `부터 ${ev.to}` : ""}`}
      className="z-[2] mx-[3px] flex min-w-0 items-center gap-1 overflow-hidden px-1.5 text-left text-[11.5px] font-semibold whitespace-nowrap"
      style={{
        gridColumn: `${b.col0 + 1} / ${b.col1 + 2}`,
        gridRow: b.row + 2,
        height: BAND_H - 3,
        marginTop: 1,
        background: strong ? UI.text : holiday ? "#fff" : UI.hover,
        color: strong ? "#fff" : UI.text,
        border: `1px ${ev.status !== "confirmed" ? "dashed" : "solid"} ${strong ? UI.text : UI.line}`,
        borderRadius: `${b.contFromPrev ? 0 : 4}px ${b.contToNext ? 0 : 4}px ${b.contToNext ? 0 : 4}px ${b.contFromPrev ? 0 : 4}px`,
      }}
    >
      <Icon name={EVENT_KIND_ICON[ev.kind] ?? "dot"} size={11} className={strong ? "text-white" : "text-[var(--lu-text-2)]"} />
      <span className="truncate">{b.contFromPrev ? "… " : ""}{ev.title}{ev.time ? ` ${ev.time}` : ""}</span>
    </button>
  );
}

export function CalLegend({ vertical = false }: { vertical?: boolean }) {
  const chip = (style: React.CSSProperties) => <span aria-hidden className="inline-block h-3 w-5 rounded-[2px] align-middle" style={style} />;
  return (
    <ul className={vertical ? "grid grid-cols-1 gap-y-1.5 text-[12px] text-[var(--lu-text-2)]" : "flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-[var(--lu-text-2)]"} aria-label="캘린더 범례">
      <li className="flex items-center gap-1.5">{chip({ background: GENRE_FILL.drama })}KT ENA 첫방·종영·특집</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-[var(--lu-text-2)]" />KT ENA 방송 회차</li>
      <li className="flex items-center gap-1.5">{chip({ background: "#fff", border: `1px solid ${UI.grid}`, borderLeft: `3px solid ${GENRE_FILL.variety}` })}경쟁사·OTT 첫방·공개·종영</li>
      <li className="flex items-center gap-1.5">{chip({ background: "#fff", border: `1px solid ${GENRE_FILL.drama}` })}<span style={{ color: GENRE_FILL.drama }} className="font-semibold">→| 종영</span>(실선 + 장르색 제목)</li>
      <li className="flex items-center gap-1.5">{chip({ background: "#fff", border: `1px dashed ${UI.text2}` })}예정</li>
      <li className="flex items-center gap-1.5">{chip({ background: "#fff", border: `1px dashed ${UI.accent}` })}방영 가능(홀드백)</li>
      <li className="flex items-center gap-1.5">{chip({ background: UI.hover, border: `1px solid ${UI.line}` })}공휴일·외부 이벤트</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t border-dotted border-[var(--lu-danger)]" />자료상 빈 자리</li>
    </ul>
  );
}

/** 인쇄: 칸에 다 못 쓴 일정을 날짜별 각주로 */
export function CalFootnotes({ model }: { model: CalModel }) {
  const lines: string[] = [];
  for (const w of model.weeks)
    w.days.forEach((d, col) => {
      if (!d.inRange) return;
      const items = itemsOf(w, col, { query: "", matches: () => true });
      if (items.length <= PRINT_MAX) return;
      const rest = items.slice(PRINT_MAX).map((it) => (it.type === "mark" ? `${it.mark.outletName} ${it.mark.title} ${MARK_TAG[it.mark.kind](it.mark)}` : it.type === "own" ? `${it.bar.title}${it.day.episode ? ` ${it.day.episode}` : ""}` : `${it.bar.title}`));
      lines.push(`${dateDot(d.date)}(${dowOf(d.date)}): ${rest.join(" / ")}`);
    });
  if (lines.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[10.5px] text-[var(--lu-text-2)]">
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}
const PRINT_MAX = 4;

export default function CalendarView({
  data, model, density, selectedRunId, onSelectRun, selectedDay, onSelectDay, ownCodes, genres, printMode = false, title, mode = "month", query = "", onSelectEvent, keyOnly = false,
}: {
  data: LineupPayload; model: CalModel; density: "comfy" | "compact"; selectedRunId: string | null; onSelectRun: (id: string | null) => void;
  selectedDay: string | null; onSelectDay: (d: string | null) => void; ownCodes: string[]; genres: Genre[]; printMode?: boolean; title?: string;
  mode?: "month" | "week"; query?: string; onSelectEvent?: (ev: LaneEvent) => void; keyOnly?: boolean;
}) {
  const works = useMemo(() => new Map(data.works.map((w) => [w.id, w])), [data.works]);
  const runs = useMemo(() => new Map(data.runs.map((r) => [r.id, r])), [data.runs]);
  const matcher = useMemo(() => ({ query: query.trim(), matches: (id: string) => { const r = runs.get(id); return !!r && runMatchesQuery(r, r.workId ? works.get(r.workId) : undefined, query); } }), [query, runs, works]);
  const maxItems = printMode ? PRINT_MAX : density === "comfy" ? 3 : 2;
  const multiOutlet = ownCodes.length > 1;
  const day = selectedDay;
  const onSelect = (id: string) => onSelectRun(id);

  return (
    <div className={printMode ? "" : "flex items-start gap-4"}>
      <div className="min-w-0 flex-1">
        {title && <h2 className="mb-1 text-[15px] font-semibold">{title}</h2>}
        {mode === "week" && !printMode ? (
          <WeekGrid data={data} week={model.weeks[0]} density={density} selectedRunId={selectedRunId} onSelect={onSelect} selectedDay={day} onSelectDay={onSelectDay} matcher={matcher} multiOutlet={multiOutlet} onSelectEvent={onSelectEvent} keyOnly={keyOnly} />
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-[var(--lu-line)] bg-white">
            <div className="grid grid-cols-7 border-b border-[var(--lu-line)]">
              {DOW.map((d, i) => (
                <div key={d} className={cx("py-2 text-center text-[12px] font-medium", i === 6 ? "text-[var(--lu-danger)]" : "text-[var(--lu-text-2)]")}>{d}</div>
              ))}
            </div>
            {model.weeks.map((w) => (
              <MonthWeek key={w.start} week={w} data={data} maxItems={maxItems} selectedRunId={selectedRunId} selectedDay={day} onSelect={onSelect} onSelectDay={onSelectDay} printMode={printMode} matcher={matcher} multiOutlet={multiOutlet} onSelectEvent={onSelectEvent} keyOnly={keyOnly} />
            ))}
          </div>
        )}
        {model.monthBoxes.length > 0 && (
          <section aria-label="이 달 예정 · 날짜 미정" className="mt-3 rounded-[8px] border border-[var(--lu-line)] bg-white px-3 py-2.5">
            <h3 className="mb-1.5 text-[13px] font-semibold text-[var(--lu-text)]">이 달 예정 · 날짜 미정 <span className="font-normal text-[var(--lu-text-2)]">월 단위 발표 — 날짜 칸에 넣지 않음</span></h3>
            {model.monthBoxes.map((b) => (
              <div key={b.ym} className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="lu-num mr-1 w-8 text-[12px] font-semibold text-[var(--lu-text-2)]">{Number(b.ym.slice(5))}월</span>
                {b.items.map((it) => (
                  <button key={`${it.runId}${b.ym}`} type="button" onClick={() => onSelectRun(it.runId)} className="flex h-6 items-center gap-1 rounded-[4px] border border-[var(--lu-line)] bg-white px-2 text-[12px] hover:bg-[var(--lu-hover)]">
                    <span className="text-[11px] text-[var(--lu-text-2)]">{it.outletName}</span>
                    <span className="font-semibold text-[var(--lu-text)]">{it.title}</span>
                    <span className="text-[11px] text-[var(--lu-text-2)]">{it.text}</span>
                  </button>
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
      {!printMode && day && (
        <DayPanel data={data} model={model} day={day} ownCodes={ownCodes} genres={genres} onClose={() => onSelectDay(null)} onSelectRun={onSelect} onSelectEvent={onSelectEvent} />
      )}
    </div>
  );
}

function MonthWeek({
  week, data, maxItems, selectedRunId, selectedDay, onSelect, onSelectDay, printMode, matcher, multiOutlet, onSelectEvent, keyOnly,
}: {
  week: CalWeek; data: LineupPayload; maxItems: number; selectedRunId: string | null; selectedDay: string | null; onSelect: (id: string) => void; onSelectDay: (d: string | null) => void;
  printMode: boolean; matcher: { query: string; matches: (id: string) => boolean }; multiOutlet: boolean; onSelectEvent?: (ev: LaneEvent) => void; keyOnly: boolean;
}) {
  const bandRows = Math.max(week.bandRows, 0);
  const itemsArea = maxItems * (ITEM_H + 2) + 16;
  return (
    <div className="border-b border-[var(--lu-grid)] last:border-b-0">
      <div className="relative grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridTemplateRows: `28px ${bandRows > 0 ? `repeat(${bandRows}, ${BAND_H}px) ` : ""}${itemsArea}px` }}>
        {/* 칸 바탕(누르면 그날 패널) */}
        {week.days.map((d, c) => (
          <button
            key={d.date}
            type="button"
            aria-label={`${Number(d.date.slice(5, 7))}월 ${Number(d.date.slice(8))}일 ${dowOf(d.date)}요일 일정 보기`}
            aria-pressed={selectedDay === d.date}
            onClick={() => onSelectDay(selectedDay === d.date ? null : d.date)}
            className={cx("z-0 border-r border-[var(--lu-grid)] last:border-r-0 print:pointer-events-none", d.inRange ? "bg-white hover:bg-[#fafbfc]" : "bg-[#fafbfc]", selectedDay === d.date && "shadow-[inset_0_0_0_2px_var(--lu-accent)]")}
            style={{ gridColumn: c + 1, gridRow: `1 / ${bandRows + 3}` }}
          />
        ))}
        {/* 날짜 숫자 · 공휴일 이름 */}
        {week.days.map((d, c) => {
          const red = !!d.holiday || c === 6;
          const isToday = d.date === data.today;
          return (
            <div key={`n${d.date}`} className="pointer-events-none z-[1] flex items-center gap-1.5 px-2 pt-1" style={{ gridColumn: c + 1, gridRow: 1 }}>
              <span
                className={cx("lu-num inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 text-[12.5px] font-semibold", isToday && "bg-[var(--lu-text)] text-white")}
                style={isToday ? undefined : { color: !d.inRange ? "#9aa0a9" : red ? UI.danger : UI.text }}
              >
                {d.date.slice(8) === "01" ? `${Number(d.date.slice(5, 7))}.1` : Number(d.date.slice(8))}
              </span>
              {d.holiday && d.inRange && <span className="truncate text-[11px] font-medium text-[var(--lu-danger)]">{d.holiday}</span>}
            </div>
          );
        })}
        {/* 종일 이벤트 띠 */}
        {week.bands.map((b) => <Band key={b.key} b={b} onSelect={onSelectEvent} />)}
        {/* 일정 */}
        {week.days.map((d, c) => {
          const items = itemsOf(week, c, matcher, keyOnly);
          const more = items.length - maxItems + (week.bandOverflow[d.date] ?? 0);
          return (
            <div key={`i${d.date}`} className={cx("z-[1] flex min-w-0 flex-col gap-[2px] px-1 pt-1", !d.inRange && "opacity-55")} style={{ gridColumn: c + 1, gridRow: bandRows + 2 }}>
              {items.slice(0, maxItems).map((it) =>
                it.type === "own" ? (
                  <OwnItem key={it.key} bar={it.bar} day={it.day} selected={selectedRunId === it.bar.runId} onSelect={onSelect} multiOutlet={multiOutlet} />
                ) : it.type === "mark" ? (
                  <MarkItem key={it.key} m={it.mark} selected={selectedRunId === it.mark.runId} onSelect={onSelect} />
                ) : (
                  <GapItem key={it.key} bar={it.bar} onClick={() => onSelectDay(d.date)} />
                )
              )}
              {more > 0 && !printMode && (
                <button type="button" onClick={() => onSelectDay(d.date)} className="lu-num self-start rounded-[3px] px-1 text-[11.5px] font-semibold text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)] hover:text-[var(--lu-text)]">
                  +{more}개 일정
                </button>
              )}
              {more > 0 && printMode && <span className="px-1 text-[10px] text-[var(--lu-text-2)]">+{more} (각주)</span>}
            </div>
          );
        })}
      </div>
      {week.strip.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-dotted border-[var(--lu-line)] bg-[#fafbfc] px-2.5 py-1 text-[11.5px] text-[var(--lu-text-2)]">
          <span className="font-semibold">≈ 이 주 첫방 · 요일 미정(주 단위 자료)</span>
          {week.strip.map((s) => (
            <button key={s.runId} type="button" onClick={() => onSelect(s.runId)} className="hover:text-[var(--lu-text)] hover:underline">
              {s.outletName} <b className="font-semibold text-[var(--lu-text)]">{s.title}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 주간 보기 — 종일 · 시각 미정 · 시간축. 길이를 모르는 방송은 시작 시각에 한 줄로만 놓는다. */
function WeekGrid({
  data, week, density, selectedRunId, onSelect, selectedDay, onSelectDay, matcher, multiOutlet, onSelectEvent, keyOnly,
}: {
  data: LineupPayload; week: CalWeek; density: "comfy" | "compact"; selectedRunId: string | null; onSelect: (id: string) => void; selectedDay: string | null; onSelectDay: (d: string | null) => void;
  matcher: { query: string; matches: (id: string) => boolean }; multiOutlet: boolean; onSelectEvent?: (ev: LaneEvent) => void; keyOnly: boolean;
}) {
  const perDay = week.days.map((_, c) => itemsOf(week, c, matcher, keyOnly));
  const timed = perDay.map((items) => items.filter((it) => it.minute !== null && it.type !== "gap").sort((a, b) => (a.minute as number) - (b.minute as number)));
  const untimed = perDay.map((items) => items.filter((it) => it.minute === null && it.type !== "gap"));
  const hourH = density === "comfy" ? 52 : 40;
  const GAP_H = 18;
  // 시간축은 일정이 있는 시각대만 — 빈 시간 묶음은 '⋯' 한 줄로 접는다(낮 시간 공백이 저녁 편성을 화면 밖으로 밀지 않게)
  const hourSet = [...new Set(timed.flat().map((it) => Math.floor((it.minute as number) / 60)))].sort((a, b) => a - b);
  const axis: { h: number | null; top: number }[] = [];
  const hourTop = new Map<number, number>();
  let y = 0;
  hourSet.forEach((h, i) => {
    if (i > 0 && h !== hourSet[i - 1] + 1) {
      axis.push({ h: null, top: y });
      y += GAP_H;
    }
    hourTop.set(h, y);
    axis.push({ h, top: y });
    y += hourH;
  });
  const totalH = y;
  const topOf = (minute: number) => (hourTop.get(Math.floor(minute / 60)) ?? 0) + ((minute % 60) / 60) * hourH;
  const hasUntimed = untimed.some((x) => x.length > 0);
  const bandRows = Math.max(week.bandRows, 1);
  const cols = "56px repeat(7, minmax(0, 1fr))";
  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--lu-line)] bg-white">
      {/* 요일·날짜 머리 */}
      <div className="grid border-b border-[var(--lu-line)]" style={{ gridTemplateColumns: cols }}>
        <div />
        {week.days.map((d, c) => (
          <button key={d.date} type="button" onClick={() => onSelectDay(selectedDay === d.date ? null : d.date)} aria-pressed={selectedDay === d.date}
            className={cx("flex items-baseline justify-center gap-1.5 border-l border-[var(--lu-grid)] py-2 hover:bg-[var(--lu-hover)]", selectedDay === d.date && "shadow-[inset_0_-2px_0_var(--lu-accent)]")}>
            <span className={cx("text-[12px]", c === 6 || d.holiday ? "text-[var(--lu-danger)]" : "text-[var(--lu-text-2)]")}>{DOW[c]}</span>
            <span className={cx("lu-num rounded-[4px] px-1 text-[15px] font-semibold", d.date === data.today ? "bg-[var(--lu-text)] text-white" : c === 6 || d.holiday ? "text-[var(--lu-danger)]" : "text-[var(--lu-text)]")}>{Number(d.date.slice(8))}</span>
          </button>
        ))}
      </div>
      {/* 종일 */}
      <div className="grid border-b border-[var(--lu-line)]" style={{ gridTemplateColumns: cols }}>
        <div className="flex items-start justify-end px-2 pt-1.5 text-[11px] text-[var(--lu-text-2)]">종일</div>
        <div className="col-span-7 grid border-l border-[var(--lu-grid)] py-1" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridTemplateRows: `0px repeat(${bandRows}, ${BAND_H}px)` }}>
          {week.bands.map((b) => <Band key={b.key} b={b} onSelect={onSelectEvent} />)}
          {week.bands.length === 0 && <span className="col-span-7 row-start-2 px-2 text-[11.5px] leading-5 text-[var(--lu-text-2)]">종일 이벤트 없음</span>}
        </div>
      </div>
      {/* 시각 미정 */}
      {hasUntimed && (
        <div className="grid border-b border-[var(--lu-line)]" style={{ gridTemplateColumns: cols }}>
          <div className="flex items-start justify-end px-2 pt-1.5 text-right text-[11px] leading-tight text-[var(--lu-text-2)]">시각<br />미정</div>
          {untimed.map((items, c) => (
            <div key={c} className="flex min-w-0 flex-col gap-[2px] border-l border-[var(--lu-grid)] p-1">
              {items.map((it) => (it.type === "own" ? <OwnItem key={it.key} bar={it.bar} day={it.day} selected={selectedRunId === it.bar.runId} onSelect={onSelect} multiOutlet={multiOutlet} week /> : it.type === "mark" ? <MarkItem key={it.key} m={it.mark} selected={selectedRunId === it.mark.runId} onSelect={onSelect} /> : null))}
            </div>
          ))}
        </div>
      )}
      {/* 시간축 */}
      {totalH === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-[var(--lu-text-2)]">이 주에 방송 시각이 확인된 일정이 없습니다.</p>}
      <div className="lu-scroll max-h-[calc(100vh-330px)] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="relative" style={{ height: totalH }}>
            {axis.map((a) =>
              a.h === null ? (
                <span key={`g${a.top}`} className="absolute right-2 text-[11px] leading-[18px] text-[var(--lu-text-2)]" style={{ top: a.top }}>⋯</span>
              ) : (
                <span key={a.h} className="lu-num absolute right-2 text-[11px] leading-4 text-[var(--lu-text-2)]" style={{ top: a.top + 2 }}>{String(a.h % 24).padStart(2, "0")}:00</span>
              )
            )}
          </div>
          {timed.map((items, c) => {
            // 같은 시각대 겹침 — 22px 안에 시작하는 일정끼리 나란히
            const placed: { it: Item; top: number; col: number; cols: number }[] = [];
            let cluster: { it: Item; top: number; col: number; cols: number }[] = [];
            const flush = () => {
              const n = cluster.length;
              cluster.forEach((p, i) => { p.col = i; p.cols = n; });
              placed.push(...cluster);
              cluster = [];
            };
            for (const it of items) {
              const top = topOf(it.minute as number);
              if (cluster.length && top - cluster[0].top >= ITEM_H + 2) flush();
              cluster.push({ it, top, col: 0, cols: 1 });
            }
            flush();
            return (
              <div key={c} className="relative border-l border-[var(--lu-grid)]" style={{ height: totalH }}>
                {axis.map((a) => (
                  <div key={`${a.h}:${a.top}`} aria-hidden className={cx("absolute inset-x-0 border-t", a.h === null ? "border-dashed border-[var(--lu-line)] bg-[#fafbfc]" : "border-[var(--lu-grid)]")} style={{ top: a.top, height: a.h === null ? GAP_H : undefined }} />
                ))}
                {placed.map(({ it, top, col, cols: n }) => (
                  <div key={it.key} className="absolute px-[2px]" style={{ top: top + 1, left: `${(col / n) * 100}%`, width: `${100 / n}%` }}>
                    {it.type === "own" ? <OwnItem bar={it.bar} day={it.day} selected={selectedRunId === it.bar.runId} onSelect={onSelect} multiOutlet={multiOutlet} week /> : it.type === "mark" ? <MarkItem m={it.mark} selected={selectedRunId === it.mark.runId} onSelect={onSelect} /> : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {week.strip.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 border-t border-dotted border-[var(--lu-line)] bg-[#fafbfc] px-2.5 py-1 text-[11.5px] text-[var(--lu-text-2)]">
          <span className="font-semibold">≈ 이 주 첫방 · 요일 미정</span>
          {week.strip.map((s) => (
            <button key={s.runId} type="button" onClick={() => onSelect(s.runId)} className="hover:underline">{s.outletName} <b className="font-semibold text-[var(--lu-text)]">{s.title}</b></button>
          ))}
        </div>
      )}
      <p className="border-t border-[var(--lu-grid)] px-3 py-1.5 text-[11.5px] text-[var(--lu-text-2)]">시작 시각에만 놓습니다 — 종료 시각이 확인되지 않은 방송은 길이를 그리지 않습니다.</p>
    </div>
  );
}

/** 그날 패널 — 외부 이벤트 · 자사 · 경쟁 방송사 · OTT · 방영 가능. 그룹 안 시각순, 시각 미정은 뒤에 '시각 미정'. */
function DayPanel({
  data, model, day, ownCodes, genres, onClose, onSelectRun, onSelectEvent,
}: { data: LineupPayload; model: CalModel; day: string; ownCodes: string[]; genres: Genre[]; onClose: () => void; onSelectRun: (id: string) => void; onSelectEvent?: (ev: LaneEvent) => void }) {
  const rows = useMemo(() => dayAirings(data, day, ownCodes, genres), [data, day, ownCodes, genres]);
  const info = model.weeks.flatMap((w) => w.days).find((d) => d.date === day);
  const avail = (info?.marks ?? []).filter((m) => m.kind === "avail");
  const events = info?.laneEvents ?? [];
  const own = rows.filter((r) => r.own);
  const rival = rows.filter((r) => !r.own && !r.ott);
  const ott = rows.filter((r) => r.ott);
  const keyCount = rows.filter((r) => r.tag === "첫방" || r.tag === "종영" || r.tag === "공개" || r.tag === "단발").length + events.length;
  const d = new Date(`${day}T00:00:00Z`);
  return (
    <aside
      aria-label="그날 일정"
      className="lu-scroll fixed top-[52px] right-0 bottom-0 z-50 w-[340px] overflow-y-auto border-l border-[var(--lu-line)] bg-white p-4 shadow-[-8px_0_24px_rgba(23,24,28,0.06)] min-[1024px]:sticky min-[1024px]:top-3 min-[1024px]:z-0 min-[1024px]:max-h-[calc(100vh-120px)] min-[1024px]:shrink-0 min-[1024px]:rounded-[8px] min-[1024px]:border min-[1024px]:shadow-none print:hidden"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[18px] font-bold text-[var(--lu-text)]">{d.getUTCMonth() + 1}월 {d.getUTCDate()}일 {dowOf(day)}요일</h2>
          <p className="lu-num mt-0.5 text-[12px] text-[var(--lu-text-2)]">주요 일정 {keyCount}건 · 전체 {rows.length + events.length + avail.length}건</p>
        </div>
        <button type="button" onClick={onClose} aria-label="그날 일정 닫기" className="flex size-7 items-center justify-center rounded-[6px] text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)]"><Icon name="x" /></button>
      </div>
      {events.length > 0 && (
        <PanelGroup title="외부 이벤트 · 공휴일">
          {events.map((ev) => (
            <PanelRow key={ev.key} time={ev.time ?? "종일"} title={ev.title} meta={`${EVENT_KIND_LABEL[ev.kind] ?? "이벤트"}${ev.from !== ev.to ? ` · ${dateDot(ev.from)}–${dateDot(ev.to)}` : ""}${ev.status !== "confirmed" ? " · 예정" : ""}`} icon={EVENT_KIND_ICON[ev.kind]} onClick={() => onSelectEvent?.(ev)} />
          ))}
        </PanelGroup>
      )}
      <DayGroup title="KT ENA 편성" rows={own} onSelect={onSelectRun} empty="이날 하루 단위로 확인된 KT ENA 편성 없음" />
      <DayGroup title="경쟁 방송사" rows={rival} onSelect={onSelectRun} />
      <DayGroup title="OTT 공개" rows={ott} onSelect={onSelectRun} />
      {avail.length > 0 && (
        <PanelGroup title={`방영 가능 시작 · ${avail[0].outletName}`}>
          {avail.map((m) => <PanelRow key={m.key} time={m.note?.replace("~", "") ?? "—"} title={m.title} meta="ENA 방송 종료 + 홀드백" onClick={() => onSelectRun(m.runId)} />)}
        </PanelGroup>
      )}
      <p className="mt-3 border-t border-[var(--lu-grid)] pt-2 text-[11.5px] leading-relaxed text-[var(--lu-text-2)]">
        회차는 첫방일부터 편성 요일을 센 추정입니다(결방 미반영). 주·월 단위 자료는 달력의 주 띠·‘이 달 예정’에 따로 있습니다.
      </p>
    </aside>
  );
}

function PanelGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 text-[12px] font-semibold text-[var(--lu-text-2)]">{title}</h3>
      <ul className="divide-y divide-[var(--lu-grid)]">{children}</ul>
    </section>
  );
}

function PanelRow({ time, title, meta, onClick, icon, genre, own }: { time: string; title: string; meta: string; onClick?: () => void; icon?: string; genre?: Genre; own?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-[4px] px-1 py-2 text-left hover:bg-[var(--lu-hover)]">
        <span className="lu-num w-[52px] shrink-0 pt-px text-[12.5px] text-[var(--lu-text-2)]">{time}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {genre && <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[2px]" style={own ? { background: GENRE_FILL[genre] } : { background: "#fff", border: `1.5px solid ${GENRE_FILL[genre]}` }} />}
            {icon && <Icon name={icon as never} size={12} className="text-[var(--lu-text-2)]" />}
            <span className="truncate text-[13.5px] font-semibold text-[var(--lu-text)]">{title}</span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-[var(--lu-text-2)]">{meta}</span>
        </span>
      </button>
    </li>
  );
}

function DayGroup({ title, rows, onSelect, empty }: { title: string; rows: DayRow[]; onSelect: (id: string) => void; empty?: string }) {
  if (rows.length === 0 && !empty) return null;
  const timed = rows.filter((r) => r.minute !== null);
  const untimed = rows.filter((r) => r.minute === null);
  return (
    <PanelGroup title={`${title}${rows.length ? ` ${rows.length}` : ""}`}>
      {rows.length === 0 && <li className="py-2 text-[12px] text-[var(--lu-text-2)]">{empty}</li>}
      {[...timed, ...untimed].map((r) => (
        <PanelRow
          key={r.key + r.tag}
          time={r.minute !== null ? clockLabel(r.minute) : r.ott ? "공개" : "시각 미정"}
          title={r.title}
          meta={[r.outletName, r.episode, r.tag, GENRE_LABEL[r.genre]].filter(Boolean).join(" · ")}
          genre={r.genre}
          own={r.own}
          onClick={() => onSelect(r.runId)}
        />
      ))}
    </PanelGroup>
  );
}
