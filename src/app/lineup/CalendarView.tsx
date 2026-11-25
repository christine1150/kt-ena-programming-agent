"use client";

// 라인업 '캘린더' 보기(2026-11-25, docs/lineup/CALENDAR_VIEW_DESIGN.md) — 한 주 = 한 줄(월요일 시작).
// 자사(기준 채널)는 방송되는 요일 칸에만(예: 토요일 작품은 토요일 칸, 월화 드라마는 월·화 칸) 제목·방송 시각·회차(추정)·출연자를 쓰고 첫방일은 가장 진한 칸 + '첫방' 배지, 타사·OTT는 날짜 칸 표식(▶ 첫방 채움 · ■ 종영 테두리 · ◆ 공개일).
// 계산은 lib/lineup/calendar.ts(순수 함수)가 하고 여기는 그리기만 한다. 인쇄(한 달 한 쪽)도 이 컴포넌트를 printMode로 쓴다.
import { useMemo } from "react";
import {
  barWeekDays, dayAirings, type CalBar, type CalMark, type CalModel, type CalWeek, type DayRow, type MarkKind,
} from "@/lib/lineup/calendar";
import { GENRE_HEX, textWidth } from "@/lib/lineup/viewModel";
import type { Genre, LineupPayload } from "@/lib/lineup/types";
import UndatedStrip from "./UndatedStrip";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const hexA = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
/** 방송사색 위 글자색 — 노란 계열(KBS2·JTBC)은 어둡게, 나머지는 흰색 */
const onColor = (hex: string | null) => {
  const h = (hex ?? "#666666").replace("#", "");
  const n = Number.parseInt(h.length === 6 ? h : "666666", 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? "#1c1d24" : "#ffffff";
};
const TITLE_FIT = 124; // 칸 한 줄에 들어가는 제목 폭(px, 15px 글자 기준 대략값)
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const dowOf = (d: string) => DOW[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7];

const MARK_TAIL: Record<MarkKind, (m: CalMark) => string> = {
  first: () => "첫방",
  end: (m) => (m.approx ? "종영(≈)" : "종영"),
  open: (m) => (m.ott ? "공개" : "단발"),
  air: () => "방송",
  avail: () => "",
};

function Mark({ m, onSelect, selected }: { m: CalMark; onSelect: (id: string) => void; selected: boolean }) {
  const col = m.color ?? "#666666";
  const label = `${m.outletName} ${m.title} ${MARK_TAIL[m.kind](m)}`;
  const title = m.shortTitle && textWidth(label, 13) > 150 ? m.shortTitle : m.title;
  const common = "flex w-full min-w-0 items-center gap-1 rounded-[6px] px-1.5 text-left text-[13px] leading-[20px] whitespace-nowrap";
  const sym = m.kind === "first" ? "▶" : m.kind === "end" ? "■" : "◆";
  const ring = selected ? "outline outline-2 outline-offset-1 outline-zinc-900" : "";
  if (m.kind === "avail")
    return (
      <button type="button" title={`${m.outletName} 방영 가능 ${m.note ?? ""} — ${m.title}`} onClick={() => onSelect(m.runId)} className={`${common} ${ring} bg-white font-semibold text-sky-900`} style={{ border: "1.5px dashed #0284c7", lineHeight: "17px" }}>
        <span aria-hidden className="shrink-0 text-[10.5px] text-sky-600">◇</span>
        <span className="truncate"><b className="font-extrabold">{m.note}</b> {title}</span>
      </button>
    );
  if (m.kind === "first")
    return (
      <button type="button" title={label} onClick={() => onSelect(m.runId)} className={`${common} ${ring} font-semibold`} style={{ background: col, color: onColor(col) }}>
        <span aria-hidden className="shrink-0 text-[10.5px]">{sym}</span>
        <span className="truncate"><b className="font-extrabold">{m.outletName}</b> {title} <b className="font-extrabold">첫방</b></span>
      </button>
    );
  if (m.kind === "end")
    return (
      <button type="button" title={label} onClick={() => onSelect(m.runId)} className={`${common} ${ring} bg-white font-semibold text-zinc-900`} style={{ border: `1.5px solid ${col}`, lineHeight: "17px" }}>
        <span aria-hidden className="shrink-0 text-[10.5px]" style={{ color: col }}>{sym}</span>
        <span className="truncate"><b className="font-extrabold">{m.outletName}</b> {title} {MARK_TAIL.end(m)}</span>
      </button>
    );
  return (
    <button type="button" title={label} onClick={() => onSelect(m.runId)} className={`${common} ${ring} bg-zinc-100 font-semibold text-zinc-900`} style={{ borderLeft: `4px solid ${col}` }}>
      <span aria-hidden className="shrink-0 text-[10.5px]" style={{ color: col }}>{sym}</span>
      <span className="truncate"><b className="font-extrabold">{m.outletName}</b> {title} {MARK_TAIL[m.kind](m)}</span>
    </button>
  );
}

/** 자사 작품 — 방송되는 요일 칸에만 그린다(쉬는 요일·결방은 비워 둠). 칸마다 제목 / 방송 시각·회차(추정) / 출연자. 첫방일은 가장 진한 칸 + 굵은 '첫방' 배지. */
function Bar({ b, week, selectedId, onSelect }: { b: CalBar; week: CalWeek; selectedId: string | null; onSelect: (id: string) => void }) {
  const col = GENRE_HEX[b.genre as Genre];
  const dash = b.status === "confirmed" ? "solid" : "dashed";
  const selected = selectedId !== null && selectedId === b.runId;
  return (
    <>
      {barWeekDays(b, week.start).map((d) => {
        const pos = { gridColumn: d.col + 1, gridRow: b.lane + 1 } as const;
        // 칸에 한 줄로 안 들어가는 제목은 줄임말로(줄임말이 등록돼 있을 때)
        const showFirst = d.kind === "first" && !b.single;
        const shown = b.shortTitle && textWidth(b.title, 15) > TITLE_FIT - (showFirst ? 46 : 0) ? b.shortTitle : b.title;
        if (b.kind === "gap")
          return (
            <div key={d.date} className="relative z-[1] m-[2px] flex items-center rounded-[8px] px-2 text-[14.5px] font-extrabold" style={{ ...pos, border: "1.5px dashed #c91f31", background: "#c91f310d", color: "#c91f31" }}>
              {b.title}
            </div>
          );
        return (
          <button
            key={d.date}
            type="button"
            onClick={() => b.runId && onSelect(b.runId)}
            title={`${b.title} ${b.meta}`}
            className="relative z-[1] m-[2px] overflow-hidden rounded-[8px] px-2 py-[3px] text-left"
            style={{
              ...pos,
              background: hexA(col, d.kind === "first" ? 0.5 : 0.27),
              border: `1.5px ${dash} ${col}`,
              borderLeft: `5px solid ${col}`,
              outline: selected ? "2px solid #18181b" : undefined,
              outlineOffset: selected ? 1 : undefined,
            }}
          >
            <span className="block text-[15px] leading-[20px] font-extrabold text-zinc-900" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {showFirst && (
                <span className="mr-[6px] inline-block rounded-[5px] px-[6px] align-[1px] text-[12.5px] leading-[19px] font-extrabold text-white" style={{ background: col }}>첫방</span>
              )}
              {shown}
            </span>
            <span className="block truncate text-[13.5px] leading-[19px] font-semibold text-zinc-800">
              {[b.time, b.single ? b.meta : d.episode].filter(Boolean).join(" · ")}
              {b.status !== "confirmed" && <span className="ml-1.5 rounded-[4px] border border-dashed border-zinc-500 bg-white px-[4px] text-[11px] font-semibold text-zinc-700">예정</span>}
              {d.last && <span className="ml-1.5 rounded-[5px] border-[1.5px] bg-white px-[6px] text-[12px] leading-[16px] font-extrabold" style={{ color: col, borderColor: col }}>종영</span>}
            </span>
            {b.cast && (d.opening || b.single) && <span className="block truncate text-[12.5px] leading-[18px] font-medium text-zinc-800">{b.cast}</span>}
          </button>
        );
      })}
    </>
  );
}

function Week({
  week, data, barH, selectedId, selectedDay, onSelectRun, onSelectDay, printMode,
}: {
  week: CalWeek; data: LineupPayload; barH: number; selectedId: string | null; selectedDay: string | null;
  onSelectRun: (id: string) => void; onSelectDay: (d: string) => void; printMode: boolean;
}) {
  const markRow = week.laneCount + 2;
  const maxMarks = printMode ? 3 : 2;
  return (
    <div className="border-t border-zinc-300 first:border-t-0">
      {week.strip.length > 0 && (
        <div className="flex flex-wrap gap-x-3 border-b border-dashed border-amber-400 bg-amber-50 px-2.5 py-1 text-[13.5px] font-semibold text-amber-900">
          <span>≈ 이 주 첫방(주 단위 자료·요일 미정):</span>
          {week.strip.map((s) => (
            <button key={s.runId} type="button" onClick={() => onSelectRun(s.runId)} className="underline-offset-2 hover:underline">
              <span aria-hidden className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: s.color ?? "#666" }} />
              {s.outletName} {s.title}
            </button>
          ))}
        </div>
      )}
      <div className="relative grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridTemplateRows: `32px repeat(${week.laneCount}, minmax(${barH}px, auto)) auto` }}>
        {week.days.map((d, c) => {
          return (
            <button
              key={d.date}
              type="button"
              aria-label={`${md(d.date)} ${dowOf(d.date)}요일 편성 보기`}
              aria-pressed={selectedDay === d.date}
              onClick={() => onSelectDay(d.date)}
              className={`z-0 border-r border-zinc-200 last:border-r-0 print:pointer-events-none ${d.inRange ? "hover:bg-zinc-50" : "bg-zinc-100"} ${selectedDay === d.date ? "bg-sky-50 ring-2 ring-sky-400 ring-inset" : ""}`}
              style={{ gridColumn: c + 1, gridRow: `1 / ${markRow + 1}` }}
            />
          );
        })}
        {week.days.map((d, c) => {
          const first = d.date.slice(8) === "01"; // 1일은 '1/1'처럼 달을 함께 적는다
          const red = !!d.holiday || c === 6;
          return (
            <div key={`n${d.date}`} className="pointer-events-none z-[1] px-2 pt-1.5 text-[14.5px] font-extrabold" style={{ gridColumn: c + 1, gridRow: 1, color: !d.inRange ? "#aeb1bd" : red ? "#c91f31" : c === 5 ? "#2459c2" : "#16171d" }}>
              <span className={d.date === data.today ? "rounded-full bg-zinc-900 px-1.5 py-0.5 text-white" : ""}>{first ? md(d.date) : Number(d.date.slice(8))}</span>
              {d.holiday && <em className="ml-1 text-[12px] font-bold not-italic">{d.holiday}</em>}
              {d.events.length > 0 && <em className="ml-1 text-[12px] font-bold text-violet-700 not-italic">{d.events[0]}{d.events.length > 1 ? ` 외 ${d.events.length - 1}` : ""}</em>}
            </div>
          );
        })}
        {week.bars.map((b) => (
          <Bar key={`${b.key}`} b={b} week={week} selectedId={selectedId} onSelect={onSelectRun} />
        ))}
        {week.days.map((d, c) => (
          <div key={`m${d.date}`} className="z-[1] flex min-h-9 flex-col gap-1 px-1.5 pt-1 pb-1.5" style={{ gridColumn: c + 1, gridRow: markRow }}>
            {d.marks.slice(0, maxMarks).map((m) => (
              <Mark key={m.key} m={m} onSelect={onSelectRun} selected={selectedId === m.runId} />
            ))}
            {d.marks.length > maxMarks && (
              <button type="button" onClick={() => onSelectDay(d.date)} className="pl-1.5 text-left text-[12.5px] font-bold text-zinc-600 print:hidden">
                +{d.marks.length - maxMarks}
              </button>
            )}
            {printMode && d.marks.length > maxMarks && <span className="pl-1.5 text-[11px] font-bold text-zinc-600">+{d.marks.length - maxMarks} (아래 각주)</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalLegend() {
  const sw = (alpha: number, dashed = false) => (
    <span aria-hidden className="mr-1 inline-block h-3 w-6 rounded-[3px] align-middle" style={{ background: hexA(GENRE_HEX.drama, alpha), border: `1.5px ${dashed ? "dashed" : "solid"} ${GENRE_HEX.drama}` }} />
  );
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold text-zinc-700" aria-label="범례">
      <li>{sw(0.5)}첫방일(가장 진함 + 배지)</li>
      <li>{sw(0.27)}방송일 — 방송 요일 칸에만 표시</li>
      <li>점선 테두리 = 예정</li>
      <li>
        <span aria-hidden className="mr-1 inline-block h-3 w-6 rounded-[3px] align-middle" style={{ border: "1.5px dashed #c91f31", background: "#c91f310d" }} />
        <span className="text-red-700">N주 비어있음</span>
      </li>
      <li className="flex items-center gap-1.5">
        타사·OTT:
        <span className="rounded-[5px] bg-sky-800 px-2 text-white">▶ 첫방 = 채움</span>
        <span className="rounded-[5px] border-[1.5px] border-sky-800 bg-white px-2">■ 종영 = 테두리</span>
        <span className="rounded-[5px] border-l-4 border-red-600 bg-zinc-100 px-2">◆ 공개일·단발</span>
      </li>
      <li>
        <span className="rounded-[5px] bg-white px-2 text-sky-900" style={{ border: "1.5px dashed #0284c7" }}>◇ 23:50~ = 선택한 채널 방영 가능(ENA 방송 종료 + 홀드백)</span>
      </li>
      <li>≈ 주 단위 날짜</li>
    </ul>
  );
}

/** 인쇄: 칸에 다 못 쓴 표식(3개 넘는 날)을 날짜별 각주로 */
export function CalFootnotes({ model }: { model: CalModel }) {
  const days = model.weeks.flatMap((w) => w.days).filter((d) => d.inRange && d.marks.length > 3);
  if (days.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-700">
      {days.map((d) => (
        <li key={d.date}>
          <b>{md(d.date)}({dowOf(d.date)})</b>: {d.marks.map((m) => `${m.kind === "first" ? "▶" : m.kind === "end" ? "■" : "◆"} ${m.outletName} ${m.title} ${MARK_TAIL[m.kind](m)}`).join(" / ")}
        </li>
      ))}
    </ul>
  );
}

export default function CalendarView({
  data, model, density, selectedRunId, onSelectRun, selectedDay, onSelectDay, ownCodes, genres, printMode = false, title,
}: {
  data: LineupPayload; model: CalModel; density: "comfy" | "compact"; selectedRunId: string | null; onSelectRun: (id: string | null) => void;
  selectedDay: string | null; onSelectDay: (d: string | null) => void; ownCodes: string[]; genres: Genre[]; printMode?: boolean; title?: string;
}) {
  const barH = density === "comfy" ? 78 : 64; // 칸마다 제목(2줄까지)·시각·출연자
  const day = selectedDay;
  const rows = useMemo(() => (day ? dayAirings(data, day, ownCodes, genres) : []), [data, day, ownCodes, genres]);
  const dayInfo = day ? model.weeks.flatMap((w) => w.days).find((d) => d.date === day) : undefined;
  return (
    <div className={printMode ? "" : "flex flex-col gap-3 lg:flex-row lg:items-start"}>
      <div className="min-w-0 flex-1">
        {title && <h2 className="mb-1 text-[15px] font-extrabold">{title}</h2>}
        <div className="grid grid-cols-7 rounded-t-[10px] border border-b-0 border-zinc-300 bg-zinc-100">
          {DOW.map((d, i) => (
            <div key={d} className="py-1.5 text-center text-[14.5px] font-extrabold" style={{ color: i === 6 ? "#c91f31" : i === 5 ? "#2459c2" : "#2d303c" }}>{d}</div>
          ))}
        </div>
        <div className="overflow-hidden rounded-b-[10px] border border-zinc-300 bg-white">
          {model.weeks.map((w) => (
            <Week key={w.start} week={w} data={data} barH={barH} selectedId={selectedRunId} selectedDay={day} onSelectRun={onSelectRun} onSelectDay={(d) => onSelectDay(d)} printMode={printMode} />
          ))}
        </div>
        {model.monthBoxes.length > 0 && (
          <div className="mt-3 rounded-[10px] border-[1.5px] border-dashed border-zinc-400 bg-zinc-50 px-3.5 py-2.5 text-[14px]">
            <h3 className="mb-1.5 text-[14.5px] font-extrabold">이 달 예정(날짜 미정) — 월 단위 자료</h3>
            {model.monthBoxes.map((b) => (
              <div key={b.ym} className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[13px] font-bold text-zinc-600">{Number(b.ym.slice(5))}월</span>
                {b.items.map((it) => (
                  <button key={`${it.runId}${b.ym}`} type="button" onClick={() => onSelectRun(it.runId)} className="rounded-full border border-zinc-300 bg-white px-3 py-[3px] text-[13.5px] font-semibold hover:border-zinc-500">
                    <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: it.color ?? "#666" }} />
                    {it.outletName} {it.title} · {it.text}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {model.undated.length > 0 && <UndatedStrip data={data} groups={model.undated} selectedId={selectedRunId} onSelect={onSelectRun} />}
      </div>
      {!printMode && day && (
        <aside aria-label="그날 편성" className="w-full shrink-0 rounded-xl border border-zinc-300 bg-white p-3.5 lg:sticky lg:top-3 lg:w-[340px] print:hidden">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-extrabold text-zinc-900">
              {Number(day.slice(5, 7))}월 {Number(day.slice(8))}일({dowOf(day)}) 그날 편성
            </h2>
            <button type="button" onClick={() => onSelectDay(null)} className="rounded px-2 py-0.5 text-[13px] text-zinc-600 hover:bg-zinc-100">닫기</button>
          </div>
          {(dayInfo?.holiday || (dayInfo?.events.length ?? 0) > 0) && (
            <p className="mb-1.5 text-[13px] font-semibold text-red-700">{[dayInfo?.holiday, ...(dayInfo?.events ?? [])].filter(Boolean).join(" · ")}</p>
          )}
          {(dayInfo?.marks ?? []).some((m) => m.kind === "avail") && (
            <div className="mb-2 rounded-lg border border-dashed border-sky-500 bg-sky-50 px-2.5 py-1.5 text-[13.5px] text-sky-950">
              <p className="mb-0.5 font-extrabold">{dayInfo?.marks.find((m) => m.kind === "avail")?.outletName} 방영 가능 시작</p>
              {(dayInfo?.marks ?? []).filter((m) => m.kind === "avail").map((m) => (
                <button key={m.key} type="button" onClick={() => onSelectRun(m.runId)} className="block text-left font-semibold hover:underline">
                  {m.note} · {m.title}
                </button>
              ))}
            </div>
          )}
          {rows.length === 0 ? (
            <p className="py-4 text-center text-[14px] text-zinc-600">이 날짜에 하루 단위로 확인된 편성이 없습니다.<br />(주·월 단위 자료는 달력 위·아래에 따로 있습니다)</p>
          ) : (
            <DayTable rows={rows} onSelect={onSelectRun} />
          )}
          <p className="mt-2 text-[12px] text-zinc-600">회차는 첫방일부터 자리 요일을 센 추정(결방 미반영)입니다.</p>
        </aside>
      )}
    </div>
  );
}

function DayTable({ rows, onSelect }: { rows: DayRow[]; onSelect: (id: string) => void }) {
  return (
    <table className="w-full text-[14px]">
      <thead>
        <tr className="border-b-[1.5px] border-zinc-300 text-left text-[12.5px] text-zinc-600">
          <th className="px-1 py-1 font-bold">시각</th>
          <th className="px-1 py-1 font-bold">방송사</th>
          <th className="px-1 py-1 font-bold">작품</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key + r.tag} className={`cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 ${r.own ? "bg-pink-50" : ""}`} onClick={() => onSelect(r.runId)}>
            <td className="px-1 py-1.5 font-semibold tabular-nums">{r.time || (r.ott ? "—" : "")}</td>
            <td className="px-1 py-1.5 font-semibold">{r.outletName}</td>
            <td className="px-1 py-1.5 font-semibold">
              {r.title}
              {r.episode && <span className="ml-1 text-[12.5px] font-medium text-zinc-600">{r.episode}</span>}
              {r.tag && <span className="ml-1 rounded border border-zinc-300 px-1 text-[12px] font-bold text-zinc-700">{r.tag}</span>}
              {r.own && <span className="ml-1 rounded border border-pink-300 px-1 text-[12px] font-bold text-pink-700">자사</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
