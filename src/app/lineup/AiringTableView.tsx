"use client";

// 방영표 보기(2026-11-27 사용자 지시) — 편성센터 월간 '오리지널 타이틀 방영 일정' PDF 모양을 앱 안에서.
// 주마다 [시간 | 월~금] [시간 | 토·일], 그 주에 방송이 있는 시각만 줄. 첫방 = 파랑, 최종회 = 노랑, 결방 = 빨강(칸 바탕 + 글자로도 표시).
// 계산은 lib/lineup/airingTable.ts(순수 함수), 여기는 그리기만 한다. 화면·인쇄(A4 가로) 같은 컴포넌트.
import { useMemo } from "react";
import { airingTime, type AiringBlock, type AiringItem, type AiringModel } from "@/lib/lineup/airingTable";
import { runMatchesQuery } from "@/lib/lineup/viewModel";
import type { LineupPayload } from "@/lib/lineup/types";
import { cx } from "./ui";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
/** 칸 상태색 — 파랑(첫방)·노랑(최종회)·빨강(결방). 글자는 흰 바탕 대비 4.5:1 이상 */
export const AIRING_TONE = {
  first: { bg: "#e5edfd", line: "#b7cbf5", text: "#1d4fb8" },
  last: { bg: "#fcefc7", line: "#ecd48a", text: "#7a5200" },
  hiatus: { bg: "#fde3e1", line: "#f2b8b2", text: "#a3251a" },
} as const;

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function AiringLegend({ className }: { className?: string }) {
  const chip = (t: (typeof AIRING_TONE)[keyof typeof AIRING_TONE]) => (
    <span aria-hidden className="inline-block h-3 w-4 rounded-[2px] align-middle" style={{ background: t.bg, border: `1px solid ${t.line}` }} />
  );
  return (
    <ul aria-label="범례" className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--lu-text-2)]", className)}>
      <li className="flex items-center gap-1.5">{chip(AIRING_TONE.first)}론칭작(첫방)</li>
      <li className="flex items-center gap-1.5">{chip(AIRING_TONE.last)}종영작(최종회)</li>
      <li className="flex items-center gap-1.5">{chip(AIRING_TONE.hiatus)}결방</li>
    </ul>
  );
}

export default function AiringTableView({
  data, model, selectedRunId, onSelectRun, query = "", printMode = false,
}: {
  data: LineupPayload;
  model: AiringModel;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  query?: string;
  printMode?: boolean;
}) {
  const runs = useMemo(() => new Map(data.runs.map((r) => [r.id, r])), [data.runs]);
  const works = useMemo(() => new Map(data.works.map((w) => [w.id, w])), [data.works]);
  const matches = (id: string) => {
    if (!query.trim()) return true;
    const r = runs.get(id);
    return !!r && runMatchesQuery(r, r.workId ? works.get(r.workId) : undefined, query);
  };
  const empty = model.weeks.every((w) => w.weekday.times.length === 0 && w.weekend.times.length === 0);
  const y = model.month.slice(0, 4);
  const m = Number(model.month.slice(5, 7));

  return (
    <div className="lu-airing">
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 className="text-[16px] leading-tight font-bold text-[var(--lu-text)]">
          <span className="mr-1.5 text-[var(--lu-accent)]">{model.channelName}</span>
          {y}년 {m}월 오리지널 타이틀 방영 일정
        </h2>
        <AiringLegend />
      </div>
      {empty ? (
        <p className="rounded-[8px] border border-dashed border-[var(--lu-line)] bg-white px-6 py-12 text-center text-[13px] text-[var(--lu-text-2)]">
          이 달 {model.channelName} 방영 자료가 없습니다.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-[var(--lu-line)] bg-white">
          <div
            className={cx("grid", printMode ? "text-[11.5px]" : "text-[12.5px]")}
            style={{ gridTemplateColumns: `${printMode ? 46 : 52}px repeat(5, minmax(0, 1fr)) ${printMode ? 46 : 52}px repeat(2, minmax(0, 1fr))` }}
          >
            {/* 요일 머리 */}
            {["시간", ...DOW.slice(0, 5), "시간", ...DOW.slice(5)].map((d, i) => (
              <div
                key={`h${i}`}
                className={cx(
                  "border-b-2 border-[var(--lu-text)] bg-[#f4f5f8] py-1.5 text-center text-[12px] font-semibold",
                  i === 5 && "border-r-2 border-r-[var(--lu-line)]",
                  i === 0 || i === 6 ? "text-[var(--lu-text-2)]" : i === 7 ? "text-[var(--lu-saturday)]" : i === 8 ? "text-[var(--lu-danger)]" : "text-[var(--lu-text)]"
                )}
              >
                {d}
              </div>
            ))}
            {model.weeks.map((w) => (
              <WeekRows key={w.start} week={w} today={data.today} selectedRunId={selectedRunId} onSelectRun={onSelectRun} printMode={printMode} matches={matches} />
            ))}
          </div>
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-[var(--lu-text-2)]">
        회차는 첫방 기준 순번(등록된 결방 반영) · 결방은 하루 단위로 등록된 것만 표시
        {model.hiddenMorning > 0 && ` · 오전(12시 전) 사업형 편성 ${model.hiddenMorning}편 제외`}
      </p>
    </div>
  );
}

function WeekRows({
  week, today, selectedRunId, onSelectRun, printMode, matches,
}: {
  week: AiringModel["weeks"][number];
  today: string;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  printMode: boolean;
  matches: (id: string) => boolean;
}) {
  const dateHead = (b: AiringBlock, sat0: boolean) =>
    b.days.map((d, i) => {
      const dow = sat0 ? 5 + i : i;
      const color = !d.inMonth ? "var(--lu-text-2)" : d.holiday || dow === 6 ? "var(--lu-danger)" : dow === 5 ? "var(--lu-saturday)" : "var(--lu-text)";
      return (
        <div
          key={d.date}
          title={d.holiday ?? undefined}
          className={cx(
            "flex items-center justify-center gap-1 border-t-2 border-b border-l border-t-[var(--lu-line)] border-b-[var(--lu-grid)] border-l-[var(--lu-grid)] bg-[#f8f9fb] font-semibold",
            printMode ? "py-0.5 text-[11.5px]" : "py-1 text-[12.5px]",
            dow === 4 && "border-r-2 border-r-[var(--lu-line)]"
          )}
          style={{ color }}
        >
          <span className={cx("lu-num rounded-[4px] px-1", d.date === today && "bg-[var(--lu-text)] text-white")}>{md(d.date)}</span>
          {d.holiday && d.inMonth && <span className="truncate text-[11px] font-medium">{d.holiday}</span>}
        </div>
      );
    });
  const rows = Array.from({ length: week.rows }, (_, i) => i);
  const timeCell = (t: number | null | undefined, key: string) => (
    <div key={key} className="lu-num flex items-center justify-center border-b border-[var(--lu-grid)] bg-[#fafbfc] text-[12px] text-[var(--lu-text-2)]">
      {t === undefined ? "" : airingTime(t)}
    </div>
  );
  const cell = (b: AiringBlock, di: number, t: number | null | undefined, key: string, divider = false) => {
    const day = b.days[di];
    const list = t === undefined ? [] : day.cells.get(t) ?? [];
    return (
      <div key={key} className={cx("flex flex-col border-b border-l border-[var(--lu-grid)]", printMode ? "min-h-[22px]" : "min-h-[40px]", divider && "border-r-2 border-r-[var(--lu-line)]", !day.inMonth && "bg-[#fcfcfd]")}>
        {list.map((it) => (
          <Entry key={it.key} it={it} selected={selectedRunId === it.runId} onSelect={onSelectRun} printMode={printMode} dim={!matches(it.runId)} />
        ))}
      </div>
    );
  };
  return (
    <>
      {/* 날짜 줄 — 이 주 경계는 굵은 선 */}
      <div className="border-t-2 border-b border-t-[var(--lu-line)] border-b-[var(--lu-grid)] bg-[#f8f9fb]" />
      {dateHead(week.weekday, false)}
      <div className="border-t-2 border-b border-t-[var(--lu-line)] border-b-[var(--lu-grid)] bg-[#f8f9fb]" />
      {dateHead(week.weekend, true)}
      {rows.map((ri) => {
        const tw = ri < week.weekday.times.length ? week.weekday.times[ri] : undefined;
        const te = ri < week.weekend.times.length ? week.weekend.times[ri] : undefined;
        return [
          timeCell(tw, `${week.start}t${ri}`),
          ...[0, 1, 2, 3, 4].map((di) => cell(week.weekday, di, tw, `${week.start}d${di}r${ri}`, di === 4)),
          timeCell(te, `${week.start}T${ri}`),
          ...[0, 1].map((di) => cell(week.weekend, di, te, `${week.start}e${di}r${ri}`)),
        ];
      })}
    </>
  );
}

function Entry({ it, selected, onSelect, printMode, dim }: { it: AiringItem; selected: boolean; onSelect: (id: string) => void; printMode: boolean; dim: boolean }) {
  const tone = it.kind === "hiatus" ? AIRING_TONE.hiatus : it.last ? AIRING_TONE.last : it.first ? AIRING_TONE.first : null;
  const sub = it.kind === "hiatus" ? `결방${it.reason ? ` · ${it.reason}` : ""}` : it.last ? "최종회" : it.first ? "첫방" : it.status === "tentative" ? "미정" : it.single ? "특집" : "";
  const label = `${it.title} ${it.ep}`.trim();
  const body = (
    <>
      <span className={cx("line-clamp-2 font-medium", printMode ? "leading-[1.2]" : "leading-[1.3]", it.kind === "hiatus" && "line-through decoration-1")} style={{ color: tone?.text ?? "var(--lu-text)" }}>
        {it.title}
        {it.ep && <span className="lu-num ml-1 font-normal">{it.ep}</span>}
      </span>
      {sub && <span className="text-[11px] leading-tight font-semibold" style={{ color: tone?.text ?? "var(--lu-text-2)" }}>{sub}</span>}
    </>
  );
  const cls = cx(
    "flex flex-1 flex-col items-center justify-center px-1.5 text-center",
    printMode ? "py-0.5" : "py-1",
    dim && "opacity-35",
    !printMode && "hover:brightness-[0.97]",
    selected && "shadow-[inset_0_0_0_2px_var(--lu-accent)]"
  );
  const style = tone ? { background: tone.bg } : undefined;
  if (printMode) return <div className={cls} style={style}>{body}</div>;
  return (
    <button type="button" title={[label, sub].filter(Boolean).join(" · ")} aria-pressed={selected} onClick={() => onSelect(it.runId)} className={cls} style={style}>
      {body}
    </button>
  );
}
