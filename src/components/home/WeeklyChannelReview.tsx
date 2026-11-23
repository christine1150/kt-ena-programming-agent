"use client";

// 주간 채널 성과 리뷰(2026-11-23 개편, 사용자 지시서 "주간 채널 성과 리뷰 페이지 전면 개선").
// 1 한눈에 보기 → 2 채널별 성적표 → 3 선택 채널의 변화와 이유 → 4 최근 추이. 수치는 page1 route가 내려준 닐슨 주간 값과
// 기존 분석(자리 이어받기·순위 하락 배경)을 그대로 쓰고, 문장·선별은 src/lib/weeklyReview/narrative.ts의 고정 규칙이 만든다.
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import type { RankSlide } from "@/lib/rankSlide";
import { NARRATIVE_DOWN_COLOR, NARRATIVE_UP_COLOR } from "@/lib/highlightNarrative";
import {
  buildHeadline,
  buildInsightCards,
  checkPoints,
  coreChangeLabel,
  fmtPct,
  fmtRating,
  nameOf,
  performanceSentences,
  rankChangeText,
  shiftItems,
  shiftSummary,
  sortChannels,
  groupShifts,
  slotWhen,
  trendSentences,
  type InsightCard,
  type ShiftGroup,
  type ShiftItem,
  type WeeklyChannelInput,
  type WeeklyInput,
} from "@/lib/weeklyReview/narrative";

const READABLE_TEXT_COLOR: Record<string, string> = { OLIFE: "#22c55e" };
// 성적표 한 줄: 채널 | 순위 | 지난주 대비 | 시청률 | 시청률 변화 | 핵심 변화 | 펼침 표시
const ROW_GRID = "grid-cols-[1.1fr_0.7fr_1fr_0.7fr_0.8fr_1.8fr_24px] gap-x-3";
const UP = NARRATIVE_UP_COLOR;
const DOWN = NARRATIVE_DOWN_COLOR;
const SECTION = "rounded-xl bg-white px-4 py-5 ring-1 ring-zinc-200/80 sm:px-8 sm:py-7";
const H2 = "font-heading text-[17px] font-bold tracking-tight text-zinc-900";
const EYEBROW = "text-[11px] font-semibold tracking-wide text-zinc-400";

function dotDate(d: string, withYear = false): string {
  const [y, m, day] = d.split("-");
  return withYear ? `${y}.${m}.${day}` : `${parseInt(m, 10)}.${parseInt(day, 10)}`;
}
function addDaysIso(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function signColor(v: number | null): string | undefined {
  if (v === null) return undefined;
  const r = Math.round(v * 10) / 10;
  return r > 0 ? UP : r < 0 ? DOWN : undefined;
}
function rankDeltaNode(rc: number | null) {
  if (rc === null) return <span className="text-zinc-400">전주 없음</span>;
  if (rc === 0) return <span className="text-zinc-600">유지</span>;
  return (
    <span style={{ color: rc > 0 ? UP : DOWN }}>
      {rc > 0 ? "▲" : "▼"} {rankChangeText(rc)}
    </span>
  );
}

export interface WeeklyChannelReviewProps {
  review: WeeklyInput & { availableWeeks?: { weekStart: string; weekEnd: string }[] };
  slides: RankSlide[];
  colorByCode: Map<string, string | null>;
  /** 상세 근거 — 기존 주간 표의 셀(자리 이어받기·기여 분해)을 그대로 그린다. */
  renderEvidence: (c: WeeklyChannelInput) => ReactNode;
  /** 여러 채널 비교(기존 그룹별 순위 그래프). */
  compareView: ReactNode;
  onSelectWeek: (weekEnd: string) => void;
}

export default function WeeklyChannelReview({ review, slides, colorByCode, renderEvidence, compareView, onSelectWeek }: WeeklyChannelReviewProps) {
  const headline = useMemo(() => buildHeadline(review), [review]);
  const cards = useMemo(() => buildInsightCards(review, slides), [review, slides]);
  // 사용자 지시(2026-11-23 2차): 정렬 버튼 없이 기존 채널 순서 고정, 채널을 누르면 그 행 바로 아래에 펼친다(아래로 멀리 내려가지 않게).
  const [open, setOpen] = useState<string | null>(null);
  const ordered = useMemo(() => sortChannels(review.channels, "default", slides, review.weekStart), [review, slides]);
  // OLIFE 브랜드색(연두)은 흰 바탕 글자로 읽기 어려워 홈 일간 세부 내역과 같은 보정색을 쓴다.
  const color = (code: string) => READABLE_TEXT_COLOR[code] ?? colorByCode.get(code) ?? "#3f3f46";

  const toggle = (code: string) => setOpen((cur) => (cur === code ? null : code));
  // 위 카드에서 누르면 성적표의 그 채널 행을 펼치고 그 행으로 이동한다.
  const openFromCard = (code: string) => {
    setOpen(code);
    if (typeof window !== "undefined")
      window.requestAnimationFrame(() => document.getElementById(`weekly-row-${code}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* SECTION 1 · 이번 주 한눈에 보기 */}
      <section className={SECTION} aria-labelledby="weekly-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="weekly-title" className="font-heading text-[22px] font-bold tracking-tight text-zinc-900">
              주간 채널 성과 리뷰
            </h2>
            <p className="mt-0.5 text-[13px] tabular-nums text-zinc-500">
              {dotDate(review.weekStart, true)} ~ {dotDate(review.weekEnd)}
            </p>
          </div>
          {review.availableWeeks && review.availableWeeks.length > 1 && (
            <label className="flex items-center gap-2 text-[12px] text-zinc-500">
              다른 주 보기
              <select
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] text-zinc-800"
                value={review.weekEnd}
                onChange={(e) => onSelectWeek(e.target.value)}
              >
                {review.availableWeeks.map((w) => (
                  <option key={w.weekStart} value={w.weekEnd}>
                    {dotDate(w.weekStart, true)} ~ {dotDate(w.weekEnd)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* 사용자 지시(2026-11-23 3차): 전체 채널 추이를 맨 위로 — 기존 그룹별 순위 그래프 그대로 */}
        <p className={`${EYEBROW} mt-4 mb-1.5`}>전체 채널 최근 {review.channels[0]?.weeks.length ?? 0}주 순위 추이</p>
        {compareView}
        <p className="mt-1.5 text-[11px] text-zinc-400">그룹마다 순위 범위(세로축)가 달라 두 그래프의 기울기를 서로 비교하면 변화가 과장돼 보일 수 있습니다.</p>
      </section>

      {/* 이번 주 한눈에 보기 — 대표 문장 + 핵심 카드(낮은 높이) */}
      <section className={SECTION} aria-label="이번 주 한눈에 보기">
        <p className="text-[17px] font-semibold leading-snug text-zinc-900 sm:text-[18px]">{headline.sentence}</p>
        <p className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-zinc-500 ${headline.noData === headline.total ? "hidden" : ""}`}>
          <span>
            순위 상승 <b className="tabular-nums" style={{ color: UP }}>{headline.up}</b>
          </span>
          <span>
            유지 <b className="tabular-nums text-zinc-700">{headline.flat}</b>
          </span>
          <span>
            하락 <b className="tabular-nums" style={{ color: DOWN }}>{headline.down}</b>
          </span>
          {headline.noData > 0 && <span>비교 불가 {headline.noData}</span>}
        </p>

        {cards.length > 0 && (
          <div className={`mt-3 grid grid-cols-1 gap-2 ${cards.length >= 3 ? "lg:grid-cols-3" : cards.length === 2 ? "lg:grid-cols-2" : ""}`}>
            {cards.map((card) => (
              <InsightCardView key={card.kind} card={card} color={color(card.channelCode)} active={card.channelCode === open} onClick={() => openFromCard(card.channelCode)} />
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
          닐슨이 한 주 전체를 기준으로 매긴 주간 시장 순위입니다(일별 순위의 평균이 아닙니다). 순위는 숫자가 작을수록 좋습니다. ENA·ENA Play·ENA Drama는 수도권 개인2049, 나머지는 전국
          유료방송가구 기준입니다.
        </p>
      </section>

      {/* SECTION 2 · 채널별 성적표 — 기존 채널 순서 고정, 누르면 그 행 바로 아래에 변화와 이유·추이가 펼쳐진다 */}
      <section className={SECTION} aria-labelledby="weekly-scorecard">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="weekly-scorecard" className={H2}>
            채널별 성적표
          </h2>
          <p className="text-[11.5px] text-zinc-400">채널을 누르면 바로 아래에 변화와 이유가 펼쳐집니다</p>
        </div>
        {/* 머리글(태블릿 이상) */}
        <div className={`${ROW_GRID} hidden border-b border-zinc-200 pb-2 text-[12px] text-zinc-500 sm:grid`}>
          <span>채널</span>
          <span className="text-right">이번 주 순위</span>
          <span>지난주 대비</span>
          <span className="text-right">시청률</span>
          <span className="text-right">시청률 변화</span>
          <span>핵심 변화</span>
          <span />
        </div>
        <ul>
          {ordered.map((c) => {
            const cur = c.weeks[c.weeks.length - 1];
            const isOpen = open === c.channelCode;
            const panelId = `weekly-panel-${c.channelCode}`;
            return (
              <li key={c.channelCode} id={`weekly-row-${c.channelCode}`} className={`scroll-mt-4 border-b border-zinc-100 ${isOpen ? "rounded-lg bg-zinc-50/70 ring-1 ring-zinc-200" : ""}`}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(c.channelCode)}
                  className={`${ROW_GRID} grid w-full items-center py-3 text-left text-[13.5px] transition ${isOpen ? "" : "hover:bg-zinc-50"} max-sm:grid-cols-[1fr_auto_auto] max-sm:gap-y-1`}
                >
                  <span className="pl-2 font-semibold" style={{ color: color(c.channelCode) }}>
                    {nameOf(c.channelCode)}
                  </span>
                  <span className="text-right font-bold tabular-nums text-zinc-900">{cur?.rank != null ? `${cur.rank}위` : "—"}</span>
                  <span className="tabular-nums max-sm:text-right">{rankDeltaNode(c.rankChange)}</span>
                  <span className="text-right tabular-nums text-zinc-600 max-sm:hidden">{fmtRating(cur?.rating, c.channelCode)}</span>
                  <span className="text-right font-medium tabular-nums max-sm:col-start-3 max-sm:row-start-2" style={{ color: signColor(c.ratingChangePct) }}>
                    {fmtPct(c.ratingChangePct)}
                  </span>
                  <span className="text-zinc-700 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-2 max-sm:pl-2 max-sm:text-[12.5px] max-sm:text-zinc-500">
                    {coreChangeLabel(c, review, slides)}
                  </span>
                  <span className={`pr-2 text-right text-zinc-400 transition-transform max-sm:hidden ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                    ›
                  </span>
                </button>
                {isOpen && (
                  <div id={panelId} className="border-t border-zinc-200 px-3 pb-5 pt-4 sm:px-5">
                    <ChannelDetailBody c={c} review={review} slides={slides} evidence={renderEvidence(c)} />
                    <TrendBody c={c} color={color(c.channelCode)} />
                    <div className="mt-4 text-right">
                      <button type="button" onClick={() => setOpen(null)} className="text-[12px] text-zinc-500 underline-offset-2 hover:underline">
                        접기
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11.5px] text-zinc-400">시청률 변화는 지난주 대비 상대 변화율(%)입니다.</p>
      </section>

    </div>
  );
}

function InsightCardView({ card, color, active, onClick }: { card: InsightCard; color: string; active: boolean; onClick: () => void }) {
  const [lead, ...rest] = card.facts;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col rounded-lg border-l-[3px] px-3 py-2 text-left ring-1 transition ${active ? "bg-zinc-50 ring-zinc-300" : "bg-white ring-zinc-200 hover:ring-zinc-300"}`}
      style={{ borderLeftColor: color }}
    >
      {/* 낮은 카드(2026-11-23 3차): 1줄 제목·채널·순위, 2줄 사실, 3줄 해석 */}
      <span className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-zinc-400">{card.title}</span>
        <span className="text-[13.5px] font-bold" style={{ color }}>
          {nameOf(card.channelCode)}
        </span>
        <span className="ml-auto text-[16px] font-bold tabular-nums text-zinc-900">{lead.replace(/^이번 주 /, "")}</span>
      </span>
      <span className="mt-0.5 text-[12px] leading-snug tabular-nums text-zinc-600">{rest.join(" · ")}</span>
      <span className="mt-0.5 text-[12px] leading-snug text-zinc-800">{card.note}</span>
    </button>
  );
}

function ChannelDetailBody({ c, review, slides, evidence }: { c: WeeklyChannelInput; review: WeeklyInput; slides: RankSlide[]; evidence: ReactNode }) {
  const items = shiftItems(c);
  // 같은 프로그램은 한 묶음으로(오른 자리·내린 자리를 함께) 보여 준다.
  const groups = groupShifts(items);
  const shown = groups.slice(0, 3);
  const more = groups.slice(3);
  const checks = checkPoints(c, items, slides, review.weekStart);
  const slide = slides.find((s) => s.channelCode === c.channelCode && s.toWeek === review.weekStart) ?? null;
  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className={EYEBROW}>① 이번 주 성과</p>
          <div className="mt-1.5 space-y-1 text-[14.5px] leading-relaxed text-zinc-800">
            {performanceSentences(c).map((s) => (
              <p key={s}>{s}</p>
            ))}
          </div>

          <p className={`${EYEBROW} mt-5`}>③ 다음 편성에서 확인할 점</p>
          {checks.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5 text-[13.5px] leading-relaxed text-zinc-700">
              {checks.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[13px] text-zinc-400">이번 주 자료로 정할 확인 사항이 없습니다.</p>
          )}
        </div>

        <div>
          <p className={EYEBROW}>② 눈에 띄는 편성 변화</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-800">{shiftSummary(c, items)}</p>
          {shown.length > 0 && (
            <ul className="mt-2.5 divide-y divide-zinc-100 rounded-lg bg-white ring-1 ring-zinc-200">
              {shown.map((g) => (
                <ShiftGroupView key={g.program} g={g} code={c.channelCode} />
              ))}
            </ul>
          )}
          {more.length > 0 && (
            <details className="mt-2 text-[12.5px] text-zinc-600">
              <summary className="cursor-pointer text-zinc-500">기타 편성 변화 {more.length}건</summary>
              <ul className="mt-2 divide-y divide-zinc-100 rounded-lg bg-white ring-1 ring-zinc-200">
                {more.map((g) => (
                  <ShiftGroupView key={g.program} g={g} code={c.channelCode} />
                ))}
              </ul>
            </details>
          )}
          {shown.length > 0 && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-zinc-400">
              각 항목은 그 프로그램이 있던 시간대의 시청률을 지난주 같은 시간대와 비교한 값입니다. 채널 전체 시청률 변화와는 다른 값이며, 교체 전후 차이만으로 원인이 확인된 것은
              아닙니다.
            </p>
          )}
        </div>
      </div>

      <details className="mt-5 rounded-lg bg-white px-4 py-3 ring-1 ring-zinc-200">
        <summary className="cursor-pointer text-[13px] font-medium text-zinc-700">④ 상세 근거 보기</summary>
        <div className="mt-3 space-y-3 text-[12px] text-zinc-600">
          <p className="text-[11.5px] text-zinc-500">
            비교 기간: 이번 주 {dotDate(review.weekStart)}~{dotDate(review.weekEnd)} · 지난주{" "}
            {review.priorWeekStart ? `${dotDate(review.priorWeekStart)}~${dotDate(addDaysIso(review.priorWeekStart, 6))}` : "없음"} · 같은 요일·시각 자리
            기준(자리 이어받기 분석). ▲▼ %p는 그 변화가 채널 주간 평균 시청률을 움직인 크기입니다.
          </p>
          {evidence}
          {slide && (
            <div>
              <p className="mb-1 font-semibold text-zinc-700">장기 하락 배경({dotDate(slide.fromWeek)}주 대비)</p>
              <ul className="space-y-1 leading-relaxed">
                {slide.lines.map((l) => (
                  <li key={l}>· {l}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

// 프로그램 하나의 편성 변화 — 오른 자리·내린 자리를 한 묶음으로, 요일×시각 칸으로 어디가 좋아지고 나빠졌는지 보여 준다.
function ShiftGroupView({ g, code }: { g: ShiftGroup; code: string }) {
  const allSlots = g.items.flatMap((it) => it.slots.map((s) => ({ ...s, dir: it.direction })));
  const showGrid = allSlots.length >= 2;
  const single = g.items.length === 1 ? g.items[0] : null;
  return (
    <li className="px-3 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        {single ? (
          <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: single.direction === "up" ? UP : DOWN }}>
            {single.direction === "up" ? "▲ 상승" : "▼ 하락"}
          </span>
        ) : (
          <span className="shrink-0 text-[11.5px] font-semibold text-zinc-600">▲▼ 엇갈림</span>
        )}
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-zinc-900" title={g.program}>
          {g.program}
        </span>
        {g.prime && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[10.5px] text-zinc-500">프라임</span>}
      </div>
      {g.summary && <p className="mt-0.5 text-[12.5px] leading-snug text-zinc-700">{g.summary}</p>}
      <ul className="mt-1 space-y-1">
        {g.items.map((it) => (
          <li key={it.key} className="text-[12.5px] leading-snug text-zinc-600">
            {!single && (
              <b className="mr-1 font-semibold" style={{ color: it.direction === "up" ? UP : DOWN }}>
                {it.direction === "up" ? "▲" : "▼"}
              </b>
            )}
            {it.sentence}
            <span className="block truncate text-[11.5px] tabular-nums text-zinc-400" title={it.slots.length > 0 ? slotWhen([...new Set(it.slots.map((s) => s.dow))], [...new Set(it.slots.map((s) => s.hour))].sort((a, b) => a - b)) : it.where}>
              {it.where}
              {it.slots.length > 1 ? " 평균" : ""} · 지난주 {fmtRating(it.priorAvg, code)} → 이번 주 {fmtRating(it.currentAvg, code)}
            </span>
          </li>
        ))}
      </ul>
      {showGrid && <SlotGrid slots={allSlots} code={code} />}
    </li>
  );
}

const DOW_SHORT = ["", "월", "화", "수", "목", "금", "토", "일"];
function SlotGrid({ slots, code }: { slots: (ShiftItem["slots"][number] & { dir: "up" | "down" })[]; code: string }) {
  const dows = [...new Set(slots.map((s) => s.dow))].sort((a, b) => a - b);
  const hours = [...new Set(slots.map((s) => s.hour))].sort((a, b) => a - b);
  const at = new Map(slots.map((s) => [`${s.dow}|${s.hour}`, s]));
  const hasUp = slots.some((s) => s.dir === "up");
  const hasDown = slots.some((s) => s.dir === "down");
  return (
    <div className="mt-2">
      {/* 전역 규칙(가로 스크롤 영역 안 표 = 너비 100%)에서 빼야 칸이 늘어나지 않는다 — 시간 격자 예외 클래스 dense-grid */}
      <div className="dense-grid overflow-x-auto">
        <table className="border-separate border-spacing-[3px] text-[10.5px] tabular-nums" style={{ width: "max-content" }}>
          <thead>
            <tr>
              <th className="w-[20px]" />
              {hours.map((h) => (
                <th key={h} className="w-[32px] px-0 text-center font-normal text-zinc-400">
                  {h}시
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dows.map((d) => (
              <tr key={d}>
                <th className="pr-1 text-right font-normal text-zinc-500">{DOW_SHORT[d]}</th>
                {hours.map((h) => {
                  const s = at.get(`${d}|${h}`);
                  if (!s) return <td key={h} className="h-[20px] rounded-[3px] bg-zinc-50" />;
                  const up = s.dir === "up";
                  const title = `${DOW_SHORT[d]} ${h}시 · ${s.priorProgram ?? "—"} ${fmtRating(s.priorAvg, code)} → ${s.currentProgram ?? "—"} ${fmtRating(s.currentAvg, code)}`;
                  return (
                    <td
                      key={h}
                      title={title}
                      className="h-[20px] rounded-[3px] text-center font-semibold text-white"
                      style={{ backgroundColor: up ? UP : DOWN }}
                    >
                      {up ? "▲" : "▼"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">
        {hasUp && (
          <>
            <span style={{ color: UP }}>■</span> 지난주보다 좋아진 시간대{" "}
          </>
        )}
        {hasDown && (
          <>
            <span style={{ color: DOWN }}>■</span> 나빠진 시간대{" "}
          </>
        )}
        · 칸에 마우스를 올리면 지난주·이번 주 값이 나옵니다
      </p>
    </div>
  );
}

// ── 추이 ──
function TrendBody({ c, color }: { c: WeeklyChannelInput; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const lines = trendSentences(c);
  const weeks = c.weeks;
  return (
    <div className="mt-6 border-t border-zinc-200 pt-4">
      <p className={EYEBROW}>
        최근 {weeks.length}주 추이 · <span style={{ color }}>{nameOf(c.channelCode)}</span>
      </p>
      {weeks.filter((w) => w.rank !== null).length < 2 ? (
        <p className="mt-1.5 text-[13px] text-zinc-400">추이를 그릴 주간 순위가 2주 이상 쌓이지 않았습니다.</p>
      ) : (
        <>
          {lines.length > 0 && (
            <div className="mb-4 mt-1.5 space-y-0.5 text-[14px] leading-relaxed text-zinc-800">
              {lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <MiniLine
              title="주간 순위"
              sub="위쪽일수록 높은 순위"
              weeks={weeks}
              value={(w) => w.rank}
              invert
              fmt={(v) => `${v}위`}
              color={color}
              hover={hover}
              onHover={setHover}
            />
            <MiniLine
              title="주간 시청률"
              sub={c.targetLabel.includes("2049") ? "수도권 개인2049" : "전국 유료방송가구"}
              weeks={weeks}
              value={(w) => w.rating}
              fmt={(v) => fmtRating(v, c.channelCode)}
              color={color}
              hover={hover}
              onHover={setHover}
              zeroBased
            />
          </div>
          <details className="mt-3 text-[12.5px]">
            <summary className="cursor-pointer text-zinc-500">표로 보기</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left tabular-nums">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="py-1 pr-3 font-medium">주 시작일</th>
                    <th className="py-1 pr-3 text-right font-medium">순위</th>
                    <th className="py-1 pr-3 font-medium">전주 대비</th>
                    <th className="py-1 pr-3 text-right font-medium">시청률</th>
                    <th className="py-1 text-right font-medium">전주 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w, i) => {
                    const p = i > 0 ? weeks[i - 1] : null;
                    const rc = p && p.rank !== null && w.rank !== null ? p.rank - w.rank : null;
                    const pct = p && p.rating !== null && p.rating > 0 && w.rating !== null ? ((w.rating - p.rating) / p.rating) * 100 : null;
                    return (
                      <tr key={w.weekStart} className="border-t border-zinc-100 text-zinc-700">
                        <td className="py-1 pr-3">{dotDate(w.weekStart)}</td>
                        <td className="py-1 pr-3 text-right">{w.rank !== null ? `${w.rank}위` : "—"}</td>
                        <td className="py-1 pr-3">{i === 0 ? "" : rankDeltaNode(rc)}</td>
                        <td className="py-1 pr-3 text-right">{fmtRating(w.rating, c.channelCode)}</td>
                        <td className="py-1 text-right" style={{ color: signColor(pct) }}>
                          {i === 0 ? "" : fmtPct(pct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function MiniLine({
  title,
  sub,
  weeks,
  value,
  fmt,
  color,
  invert = false,
  zeroBased = false,
  hover,
  onHover,
}: {
  title: string;
  sub: string;
  weeks: WeeklyChannelInput["weeks"];
  value: (w: WeeklyChannelInput["weeks"][number]) => number | null;
  fmt: (v: number) => string;
  color: string;
  invert?: boolean;
  zeroBased?: boolean;
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const W = 520;
  const H = 180;
  const L = 44;
  const R = 16;
  const T = 18;
  const B = 24;
  const vals = weeks.map(value);
  const present = vals.filter((v): v is number => v !== null);
  let lo = Math.min(...present);
  let hi = Math.max(...present);
  if (zeroBased) lo = 0;
  if (lo === hi) {
    lo = invert ? Math.max(1, lo - 2) : lo * 0.9;
    hi = invert ? hi + 2 : hi * 1.1 || 1;
  }
  const pad = (hi - lo) * 0.12;
  const yLo = invert ? Math.max(1, lo - pad) : lo;
  const yHi = hi + pad;
  const n = weeks.length;
  const x = (i: number) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  // 순위는 작을수록 위로(invert), 시청률은 클수록 위로.
  const y = (v: number) => (invert ? T + ((v - yLo) / (yHi - yLo)) * (H - T - B) : H - B - ((v - yLo) / (yHi - yLo)) * (H - T - B));
  const ticks = invert ? [Math.round(lo), Math.round((lo + hi) / 2), Math.round(hi)] : [lo, (lo + hi) / 2, hi];
  const uniqTicks = ticks.filter((t, i, a) => a.indexOf(t) === i);
  const pts = vals.map((v, i) => (v === null ? null : { i, v }));
  const path = pts
    .filter((p): p is { i: number; v: number } => p !== null)
    .map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");
  const last = [...pts].reverse().find((p) => p !== null) ?? null;
  const h = hover !== null ? pts[hover] : null;
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
    onHover(i >= 0 && i < n ? i : null);
  };
  return (
    <figure className="rounded-lg ring-1 ring-zinc-200 px-3 pb-2 pt-3">
      <figcaption className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-semibold text-zinc-800">{title}</span>
        <span className="text-[11px] text-zinc-400">{sub}</span>
      </figcaption>
      <svg role="img" aria-label={`${title} 추이`} viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" onMouseMove={onMove} onMouseLeave={() => onHover(null)}>
        {uniqTicks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e4e4e7" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="#71717a">
              {fmt(t)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => (
          <text key={w.weekStart} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10.5} fill={i === n - 1 ? "#3f3f46" : "#a1a1aa"}>
            {dotDate(w.weekStart)}
          </text>
        ))}
        {h && <line x1={x(h.i)} x2={x(h.i)} y1={T - 6} y2={H - B} stroke="#a1a1aa" strokeWidth={1} strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p) =>
          p === null ? null : (
            <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={p.i === n - 1 || p.i === hover ? 4.5 : 2.5} fill={color} stroke="#fff" strokeWidth={p.i === n - 1 || p.i === hover ? 2 : 0} />
          )
        )}
        {last && !h && (
          <text x={x(last.i)} y={y(last.v) - 9} textAnchor="end" fontSize={11.5} fontWeight={700} fill="#18181b">
            {fmt(last.v)}
          </text>
        )}
        {h && (
          <g>
            <rect x={Math.min(Math.max(x(h.i) - 48, L), W - R - 96)} y={2} width={96} height={20} rx={4} fill="#18181b" />
            <text x={Math.min(Math.max(x(h.i), L + 48), W - R - 48)} y={15.5} textAnchor="middle" fontSize={11} fill="#fff">
              {dotDate(weeks[h.i].weekStart)} · {fmt(h.v)}
            </text>
          </g>
        )}
        <rect x={L} y={0} width={W - L - R} height={H - B} fill="transparent" />
      </svg>
    </figure>
  );
}
