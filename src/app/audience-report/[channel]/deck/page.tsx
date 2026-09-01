"use client";

// Phase 13(2026-09-01, 사용자 지시) — 임원 보고용 PPT 보기. "Word 보기"
// (/audience-report/[channel])와 완전히 다른 레이아웃 — 슬라이드 카드를 세로로 나열해 PPT
// 인상을 주면서도 스크롤만으로 전부 읽을 수 있게 한다(별도 캐러셀 상태 없이 안정적으로 동작).
//
// Phase 14(2026-09-01, 사용자 재지시 — "그래프나 인포그래픽도 다 빠져있음") — chartNote
// 플레이스홀더 대신 실제 SVG 차트를 그린다. 이 프로젝트 전반의 관례(라이브러리 없이 직접
// SVG로 차트를 그림, WhyCandidateRankingChart 등)를 그대로 따르고, PPT 다운로드(pptxgenjs
// 네이티브 차트)와 같은 deckModel.ts DeckChartData 값 하나만 쓴다(두 렌더러가 다른 숫자를
// 보여줄 위험 차단).
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { ExecutiveDeckDocument, DeckBarPoint } from "@/lib/audienceReport/deckModel";

// 사용자 지시(2026-09-02): "PPT 채널 브랜딩이 안 됐다"는 신고 — 재확인 결과 실제 .pptx 파일
// (exportRenderers.ts)에는 채널색이 정확히 반영돼 있었지만, 사용자가 보는 이 웹 미리보기
// 페이지(다운로드 전 확인 화면, 참고 스크린샷의 실제 출처)는 고정 인디고(#3A30DF)를 그대로
// 쓰고 있어 반영되지 않은 것처럼 보였다 — 여기도 deck.themeColor를 accent로 threading한다.
function isValidHex(v: string | null | undefined): v is string {
  return !!v && /^#[0-9A-Fa-f]{6}$/.test(v);
}
/** accent와 흰색을 섞어 옅은 배경 톤을 만든다(So What? 박스 배경 등). amount 0~1, 1에 가까울수록 흼. */
function tintWithWhite(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function SlideShell({ index, total, accent, brandColor, children }: { index: number; total: number; accent?: boolean; brandColor?: string; children: React.ReactNode }) {
  return (
    <section
      className={`relative mx-auto mb-6 flex min-h-[26rem] w-full flex-col justify-center overflow-hidden rounded-xl border p-8 shadow-sm sm:p-12 ${
        accent ? "border-transparent bg-[#1E293B] text-white" : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      }`}
    >
      {/* 콘텐츠 슬라이드마다 얇은 채널색 브랜드 바(.pptx 파일과 동일한 디자인, 사용자 지시 —
          "세련되게 디자인"이 웹 미리보기에도 그대로 보이도록). */}
      {!accent && brandColor && <div className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: brandColor }} />}
      <span className={`absolute right-4 top-4 text-xs ${accent ? "text-slate-400" : "text-neutral-400"}`}>
        {index} / {total}
      </span>
      {children}
    </section>
  );
}

function ActionTitle({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-balance text-2xl font-bold leading-snug sm:text-3xl" style={{ color: accent }}>
      {children}
    </h2>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm italic text-neutral-400">표시할 신호가 없습니다.</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200 sm:text-base">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function SoWhat({ text, accent }: { text: string; accent: string }) {
  if (!text) return null;
  return (
    <div className="mt-4 rounded-md px-4 py-2.5 text-sm" style={{ backgroundColor: tintWithWhite(accent, 0.92) }}>
      <span className="mr-1.5 font-semibold" style={{ color: accent }}>
        So What?
      </span>
      <span className="text-neutral-800 dark:text-neutral-200">{text}</span>
    </div>
  );
}

// 사용자 지시(2026-09-01): "슬라이드의 본문 글자 수는 제한하되 필요한 설명의 경우 작게 들어갈
// 수 있습니다" — 개조식 본문은 짧게 유지하고, 꼭 필요한 부연 설명만 이 작은 글씨 note로 별도 표시.
function SlideNote({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-2 text-[11px] leading-snug text-neutral-400 dark:text-neutral-500">{text}</p>;
}

const CHART_UP = "#059669";
const CHART_DOWN = "#e11d48";
const CHART_ACCENT_FALLBACK = "#3A30DF";

/** 값이 있는 막대만 그린다 — 데이터가 아예 없으면 "데이터 부족" 안내로 대체(빈 차트 그리지 않음). */
function BarChart({ points, diverging, height = 180, accent = CHART_ACCENT_FALLBACK }: { points: DeckBarPoint[]; diverging?: boolean; height?: number; accent?: string }) {
  const withValues = points.filter((p) => p.value !== null) as { label: string; value: number }[];
  if (withValues.length === 0) return <p className="rounded bg-neutral-50 p-4 text-center text-xs text-neutral-400 dark:bg-neutral-900">이 구간은 표시할 데이터가 부족합니다.</p>;
  const barW = 44;
  const gap = 14;
  const w = withValues.length * (barW + gap) + gap;
  const maxAbs = Math.max(...withValues.map((p) => Math.abs(p.value)), 1e-9);
  const zeroY = diverging ? height / 2 : height - 24;
  const usableHalf = diverging ? height / 2 - 20 : height - 44;
  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height} className="block">
        <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="currentColor" className="text-neutral-200 dark:text-neutral-700" strokeWidth={1} />
        {withValues.map((p, i) => {
          const barH = Math.max(2, (Math.abs(p.value) / maxAbs) * usableHalf);
          const up = p.value >= 0;
          const x = gap + i * (barW + gap);
          const y = up ? zeroY - barH : zeroY;
          const color = diverging ? (up ? CHART_UP : CHART_DOWN) : accent;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={2} fill={color} />
              <text x={x + barW / 2} y={up ? y - 4 : y + barH + 12} textAnchor="middle" fontSize={9} fill="currentColor" className="text-neutral-500 dark:text-neutral-400">
                {p.value.toFixed(p.value !== 0 && Math.abs(p.value) < 1 ? 3 : 1)}
              </text>
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={9} fill="currentColor" className="text-neutral-500 dark:text-neutral-400">
                {p.label.length > 6 ? `${p.label.slice(0, 6)}…` : p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LineChart({ points, height = 180, accent = CHART_ACCENT_FALLBACK }: { points: DeckBarPoint[]; height?: number; accent?: string }) {
  const withValues = points.filter((p) => p.value !== null) as { label: string; value: number }[];
  if (withValues.length === 0) return <p className="rounded bg-neutral-50 p-4 text-center text-xs text-neutral-400 dark:bg-neutral-900">이 구간은 표시할 데이터가 부족합니다.</p>;
  const stepW = 46;
  const w = Math.max(withValues.length * stepW, 200);
  const padY = 20;
  const max = Math.max(...withValues.map((p) => p.value));
  const min = Math.min(...withValues.map((p) => p.value), 0);
  const range = max - min || 1;
  const usableH = height - padY * 2;
  const xOf = (i: number) => 10 + i * stepW;
  const yOf = (v: number) => padY + usableH - ((v - min) / range) * usableH;
  const path = withValues.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(p.value)}`).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg width={w + 20} height={height} className="block">
        <path d={path} fill="none" stroke={accent} strokeWidth={2} />
        {withValues.map((p, i) => (
          <g key={i}>
            <circle cx={xOf(i)} cy={yOf(p.value)} r={2.5} fill={accent} />
            {i % Math.max(1, Math.floor(withValues.length / 10)) === 0 && (
              <text x={xOf(i)} y={height - 4} textAnchor="middle" fontSize={9} fill="currentColor" className="text-neutral-500 dark:text-neutral-400">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function DeckBody({ deck, wordHref, pptxHref }: { deck: ExecutiveDeckDocument; wordHref: string; pptxHref: string }) {
  const d = deck.slides;
  const c = deck.charts;
  const total = 6 + (d.weekday.available ? 1 : 0) + (d.hourly.available ? 1 : 0);
  let idx = 0;
  const next = () => ++idx;
  // 사용자 지시(2026-09-02): 채널 로고 색을 포인트 컬러로 — .pptx 파일과 동일한 소스(deck.themeColor).
  const accent = isValidHex(deck.themeColor) ? deck.themeColor : CHART_ACCENT_FALLBACK;
  // .pptx 렌더러(exportRenderers.ts)와 동일한 판단: 등락률 막대가 2개 미만이면 거의 빈 차트를
  // 억지로 그리지 않고 핵심 지표 카드로 그 공간을 채운다(레이아웃 재정비, 사용자 지시).
  const kpiBarCount = c.kpiDeltaBars.filter((b) => b.value !== null).length;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">Executive Deck</div>
          <div className="text-sm text-neutral-500">{deck.periodLabel}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={pptxHref} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
            PPT 다운로드
          </a>
          <a
            href={wordHref}
            target="_blank"
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:opacity-80"
            style={{ borderColor: accent, backgroundColor: tintWithWhite(accent, 0.92), color: accent }}
          >
            ← Word 보기
          </a>
        </div>
      </header>

      {!deck.generatedByAi && (
        <div className="mb-4 rounded bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          AI 문장 생성이 수치 검증을 통과하지 못해, 텍스트는 근거 신호를 그대로 나열한 폴백 문구로 표시됩니다(차트는 실제 데이터 그대로).
        </div>
      )}

      {/* 1. Title — 채널 색 액센트 바로 브랜딩(.pptx 커버와 동일한 디자인). */}
      <SlideShell index={next()} total={total} accent>
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: accent }} />
        {deck.channelCode && (
          <div className="mb-3 inline-block w-fit rounded px-2 py-1 text-xs font-bold text-white" style={{ backgroundColor: accent }}>
            {deck.channelCode}
          </div>
        )}
        <div className="text-balance text-2xl font-bold leading-snug sm:text-4xl">{d.title.title}</div>
        <div className="mt-3 h-0.5 w-16" style={{ backgroundColor: accent }} />
        <div className="mt-3 text-sm text-slate-300 sm:text-base">{d.title.subtitle}</div>
        <div className="mt-8 text-xs text-slate-400">
          {d.title.dateLabel} · {d.title.author}
        </div>
      </SlideShell>

      {/* 2. Executive Summary */}
      <SlideShell index={next()} total={total} brandColor={accent}>
        <ActionTitle accent={accent}>{d.executiveSummary.actionTitle}</ActionTitle>
        {kpiBarCount >= 2 ? (
          <>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {d.executiveSummary.kpiHighlights.map((h, i) => (
                <div key={i} className="rounded-md bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                  {h}
                </div>
              ))}
            </div>
            <div className="mb-2 text-xs text-neutral-500">5대 지표 등락률(전기간 대비, %)</div>
            <BarChart points={c.kpiDeltaBars} diverging height={150} />
          </>
        ) : (
          // 지표 등락 막대가 1개뿐이라 거의 빈 차트가 되던 문제(사용자 지시) — 핵심 지표를 채널색
          // 강조 바가 붙은 카드로 세로 나열해 그 공간을 대신 채운다(.pptx 렌더러와 동일한 판단).
          <div className="mb-4 space-y-2">
            {d.executiveSummary.kpiHighlights.map((h, i) => (
              <div key={i} className="rounded-md border-l-4 bg-neutral-50 px-3 py-2.5 text-sm font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300" style={{ borderLeftColor: accent }}>
                {h}
              </div>
            ))}
          </div>
        )}
        <Bullets items={d.executiveSummary.verdict} />
        <SlideNote text={d.executiveSummary.note} />
      </SlideShell>

      {/* 3. Trend */}
      <SlideShell index={next()} total={total} brandColor={accent}>
        <ActionTitle accent={accent}>{d.trend.actionTitle}</ActionTitle>
        <LineChart points={c.trendPoints} height={170} accent={accent} />
        <Bullets items={d.trend.bullets} />
        <SoWhat text={d.trend.soWhat} accent={accent} />
        <SlideNote text={d.trend.note} />
      </SlideShell>

      {/* 4(신규). 주중 vs 주말 · 요일별 */}
      {d.weekday.available && (
        <SlideShell index={next()} total={total} brandColor={accent}>
          <ActionTitle accent={accent}>{d.weekday.actionTitle}</ActionTitle>
          <BarChart points={c.weekdayBars} height={200} accent={accent} />
          <p className="mt-3 text-center text-sm text-neutral-600 dark:text-neutral-300">{d.weekday.caption}</p>
        </SlideShell>
      )}

      {/* 5(신규). 시간대별 분석 */}
      {d.hourly.available && (
        <SlideShell index={next()} total={total} brandColor={accent}>
          <ActionTitle accent={accent}>{d.hourly.actionTitle}</ActionTitle>
          <BarChart points={c.hourlyBars} height={200} accent={accent} />
          <p className="mt-3 text-center text-sm text-neutral-600 dark:text-neutral-300">{d.hourly.caption}</p>
        </SlideShell>
      )}

      {/* 6. Demographic / Positioning */}
      <SlideShell index={next()} total={total} brandColor={accent}>
        <ActionTitle accent={accent}>{d.demographic.actionTitle}</ActionTitle>
        <BarChart points={c.demographicBars} height={170} accent={accent} />
        <Bullets items={d.demographic.bullets} />
        <SoWhat text={d.demographic.soWhat} accent={accent} />
        <SlideNote text={d.demographic.note} />
      </SlideShell>

      {/* 7. Killer Content & Timeslot — 상승/하락은 채널색이 아니라 의미 색(초록/빨강) 유지. */}
      <SlideShell index={next()} total={total} brandColor={accent}>
        <ActionTitle accent={accent}>{d.content.actionTitle}</ActionTitle>
        <div className="mb-2 text-xs text-neutral-500">프로그램별 등락(성장/약세)</div>
        <BarChart points={c.programBars} diverging height={170} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-emerald-600">TOP</div>
            <Bullets items={d.content.topBullets} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-rose-600">BOTTOM</div>
            <Bullets items={d.content.bottomBullets} />
          </div>
        </div>
        <SoWhat text={d.content.soWhat} accent={accent} />
        <SlideNote text={d.content.note} />
      </SlideShell>

      {/* 8. Strategy — Stop / Keep / Start(KEEP만 채널색, 나머지는 의미 색 유지). */}
      <SlideShell index={next()} total={total} brandColor={accent}>
        <ActionTitle accent={accent}>{d.strategy.actionTitle}</ActionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1.5 rounded bg-rose-600 px-2 py-1 text-center text-xs font-bold text-white">STOP</div>
            <Bullets items={d.strategy.stop} />
          </div>
          <div>
            <div className="mb-1.5 rounded px-2 py-1 text-center text-xs font-bold text-white" style={{ backgroundColor: accent }}>
              KEEP
            </div>
            <Bullets items={d.strategy.keep} />
          </div>
          <div>
            <div className="mb-1.5 rounded bg-emerald-600 px-2 py-1 text-center text-xs font-bold text-white">START</div>
            <Bullets items={d.strategy.start} />
          </div>
        </div>
        <SlideNote text={d.strategy.note} />
      </SlideShell>
    </main>
  );
}

function ChannelDeckPageInner() {
  const params = useParams<{ channel: string }>();
  const searchParams = useSearchParams();
  const [deck, setDeck] = useState<ExecutiveDeckDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/audience-report/${params.channel}/deck?${searchParams.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) setError(json.message ?? "PPT 보고서를 불러오지 못했습니다.");
        else setDeck(json.deck);
      } catch {
        if (!cancelled) setError("PPT 보고서를 불러오는 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.channel, searchParams]);

  if (loading) return <div className="p-8 text-neutral-500">불러오는 중...</div>;
  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!deck) return null;

  const qs = searchParams.toString();
  return <DeckBody deck={deck} wordHref={`/audience-report/${params.channel}?${qs}`} pptxHref={`/api/audience-report/${params.channel}/deck/pptx?${qs}`} />;
}

export default function ChannelDeckPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500">불러오는 중...</div>}>
      <ChannelDeckPageInner />
    </Suspense>
  );
}
