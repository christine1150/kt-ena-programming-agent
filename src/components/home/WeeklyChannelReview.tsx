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
  SORT_LABELS,
  sortChannels,
  trendSentences,
  type InsightCard,
  type SortKey,
  type WeeklyChannelInput,
  type WeeklyInput,
} from "@/lib/weeklyReview/narrative";

const READABLE_TEXT_COLOR: Record<string, string> = { OLIFE: "#22c55e" };
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
  const [selected, setSelected] = useState<string>(() => cards[0]?.channelCode ?? review.channels[0]?.channelCode ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const sorted = useMemo(() => sortChannels(review.channels, sortKey, slides, review.weekStart), [review, sortKey, slides]);
  const sel = review.channels.find((c) => c.channelCode === selected) ?? review.channels[0];
  // OLIFE 브랜드색(연두)은 흰 바탕 글자로 읽기 어려워 홈 일간 세부 내역과 같은 보정색을 쓴다.
  const color = (code: string) => READABLE_TEXT_COLOR[code] ?? colorByCode.get(code) ?? "#3f3f46";

  const select = (code: string) => {
    setSelected(code);
    if (typeof document !== "undefined") document.getElementById("weekly-channel-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

        <p className="mt-5 text-[17px] font-semibold leading-snug text-zinc-900 sm:text-[19px]">{headline.sentence}</p>
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
          <div className={`mt-5 grid grid-cols-1 gap-3 ${cards.length >= 3 ? "md:grid-cols-3" : cards.length === 2 ? "md:grid-cols-2" : ""}`}>
            {cards.map((card) => (
              <InsightCardView key={card.kind} card={card} color={color(card.channelCode)} active={card.channelCode === sel?.channelCode} onClick={() => select(card.channelCode)} />
            ))}
          </div>
        )}
        <p className="mt-4 text-[11.5px] leading-relaxed text-zinc-400">
          닐슨이 한 주 전체를 기준으로 매긴 주간 시장 순위입니다(일별 순위의 평균이 아닙니다). 순위는 숫자가 작을수록 좋습니다. ENA·ENA Play·ENA Drama는 수도권 개인2049, 나머지는 전국
          유료방송가구 기준입니다.
        </p>
      </section>

      {/* SECTION 2 · 채널별 성적표 */}
      <section className={SECTION} aria-labelledby="weekly-scorecard">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="weekly-scorecard" className={H2}>
            채널별 성적표
          </h2>
          <div role="group" aria-label="정렬" className="inline-flex flex-wrap rounded-full bg-zinc-100 p-0.5">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                title={SORT_LABELS[k].hint}
                aria-pressed={sortKey === k}
                onClick={() => setSortKey(k)}
                className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${sortKey === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
              >
                {SORT_LABELS[k].label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="채널별 성적표(가로 스크롤)">
          <table className="w-full min-w-[560px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-zinc-200 text-[12px] text-zinc-500">
                <th className="py-2 pr-3 font-medium">채널</th>
                <th className="py-2 pr-3 text-right font-medium">이번 주 순위</th>
                <th className="py-2 pr-3 font-medium">지난주 대비</th>
                <th className="py-2 pr-3 text-right font-medium">시청률</th>
                <th className="py-2 pr-3 text-right font-medium">시청률 변화</th>
                <th className="py-2 font-medium">핵심 변화</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const cur = c.weeks[c.weeks.length - 1];
                const active = c.channelCode === sel?.channelCode;
                return (
                  <tr
                    key={c.channelCode}
                    onClick={() => select(c.channelCode)}
                    className={`cursor-pointer border-b border-zinc-100 transition ${active ? "bg-zinc-50" : "hover:bg-zinc-50/60"}`}
                    aria-selected={active}
                  >
                    <td className="py-2.5 pr-3">
                      <button type="button" className="text-left font-semibold" style={{ color: color(c.channelCode) }} onClick={(e) => (e.stopPropagation(), select(c.channelCode))}>
                        {active && <span className="mr-1 text-zinc-400" aria-hidden>›</span>}
                        {nameOf(c.channelCode)}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-zinc-900">{cur?.rank != null ? `${cur.rank}위` : "—"}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{rankDeltaNode(c.rankChange)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-600">{fmtRating(cur?.rating, c.channelCode)}</td>
                    <td className="py-2.5 pr-3 text-right font-medium tabular-nums" style={{ color: signColor(c.ratingChangePct) }}>
                      {fmtPct(c.ratingChangePct)}
                    </td>
                    <td className="py-2.5 text-zinc-700">{coreChangeLabel(c, review, slides)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-zinc-400">채널을 누르면 아래에 변화와 이유가 나옵니다. 시청률 변화는 지난주 대비 상대 변화율(%)입니다.</p>
      </section>

      {/* SECTION 3 · 선택 채널의 변화와 이유 */}
      {sel && <ChannelDetail key={sel.channelCode} c={sel} review={review} slides={slides} color={color(sel.channelCode)} evidence={renderEvidence(sel)} />}

      {/* SECTION 4 · 최근 추이 */}
      {sel && <TrendSection key={`t-${sel.channelCode}`} c={sel} color={color(sel.channelCode)} compareView={compareView} />}
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
      className={`flex flex-col rounded-lg px-4 py-3.5 text-left ring-1 transition ${active ? "bg-zinc-50 ring-zinc-300" : "bg-white ring-zinc-200 hover:ring-zinc-300"}`}
    >
      <span className={EYEBROW}>{card.title}</span>
      <span className="mt-1 text-[15px] font-bold" style={{ color }}>
        {nameOf(card.channelCode)}
      </span>
      <span className="mt-1.5 text-[20px] font-bold leading-tight tabular-nums text-zinc-900">{lead}</span>
      <ul className="mt-1 space-y-0.5 text-[12.5px] tabular-nums text-zinc-600">
        {rest.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <span className="mt-2.5 border-t border-zinc-100 pt-2 text-[12.5px] leading-snug text-zinc-700">{card.note}</span>
    </button>
  );
}

function ChannelDetail({ c, review, slides, color, evidence }: { c: WeeklyChannelInput; review: WeeklyInput; slides: RankSlide[]; color: string; evidence: ReactNode }) {
  const items = shiftItems(c);
  const shown = items.slice(0, 3);
  const more = items.slice(3);
  const checks = checkPoints(c, items, slides, review.weekStart);
  const slide = slides.find((s) => s.channelCode === c.channelCode && s.toWeek === review.weekStart) ?? null;
  return (
    <section id="weekly-channel-detail" className={`${SECTION} scroll-mt-4`} aria-labelledby="weekly-detail-title">
      <h2 id="weekly-detail-title" className={H2}>
        <span style={{ color }}>{nameOf(c.channelCode)}</span> · 변화와 이유
      </h2>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
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
            <ul className="mt-2.5 divide-y divide-zinc-100 rounded-lg ring-1 ring-zinc-200">
              {shown.map((it) => (
                <ShiftRow key={it.key} it={it} code={c.channelCode} />
              ))}
            </ul>
          )}
          {more.length > 0 && (
            <details className="mt-2 text-[12.5px] text-zinc-600">
              <summary className="cursor-pointer text-zinc-500">기타 편성 변화 {more.length}건</summary>
              <ul className="mt-2 divide-y divide-zinc-100 rounded-lg ring-1 ring-zinc-200">
                {more.map((it) => (
                  <ShiftRow key={it.key} it={it} code={c.channelCode} />
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

      <details className="mt-5 rounded-lg bg-zinc-50 px-4 py-3">
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
    </section>
  );
}

function ShiftRow({ it, code }: { it: ReturnType<typeof shiftItems>[number]; code: string }) {
  const up = it.direction === "up";
  return (
    <li className="px-3 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: up ? UP : DOWN }}>
          {up ? "▲ 상승" : "▼ 하락"}
        </span>
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-zinc-900" title={it.program}>
          {it.program}
        </span>
        {it.prime && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[10.5px] text-zinc-500">프라임</span>}
      </div>
      <p className="mt-0.5 text-[12.5px] leading-snug text-zinc-600">{it.sentence}</p>
      <p className="mt-0.5 truncate text-[11.5px] tabular-nums text-zinc-400" title={`${it.priorProgram ?? "—"} → ${it.currentProgram ?? "—"}`}>
        {it.where}
        {it.where.endsWith("시간대") ? " 평균" : ""} · 지난주 {fmtRating(it.priorAvg, code)} → 이번 주 {fmtRating(it.currentAvg, code)}
      </p>
    </li>
  );
}

// ── 추이 ──
function TrendSection({ c, color, compareView }: { c: WeeklyChannelInput; color: string; compareView: ReactNode }) {
  const [mode, setMode] = useState<"single" | "compare">("single");
  const [hover, setHover] = useState<number | null>(null);
  const lines = trendSentences(c);
  const weeks = c.weeks;
  return (
    <section className={SECTION} aria-labelledby="weekly-trend-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="weekly-trend-title" className={H2}>
          최근 {weeks.length}주 추이 {mode === "single" && <span style={{ color }}>· {nameOf(c.channelCode)}</span>}
        </h2>
        <div role="group" aria-label="보기" className="inline-flex rounded-full bg-zinc-100 p-0.5">
          {(["single", "compare"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${mode === m ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              {m === "single" ? "선택 채널" : "여러 채널 비교"}
            </button>
          ))}
        </div>
      </div>
      {mode === "compare" ? (
        <div>
          {compareView}
          <p className="mt-2 text-[11.5px] text-zinc-400">그룹마다 순위 범위(세로축)가 달라 두 그래프의 기울기를 서로 비교하면 변화가 과장돼 보일 수 있습니다.</p>
        </div>
      ) : weeks.filter((w) => w.rank !== null).length < 2 ? (
        <p className="text-[13px] text-zinc-400">추이를 그릴 주간 순위가 2주 이상 쌓이지 않았습니다.</p>
      ) : (
        <>
          {lines.length > 0 && (
            <div className="mb-4 space-y-0.5 text-[14px] leading-relaxed text-zinc-800">
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
    </section>
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
