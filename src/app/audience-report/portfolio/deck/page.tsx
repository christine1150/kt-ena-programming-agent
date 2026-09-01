"use client";

// Phase 13(2026-09-01, 사용자 지시) — 종합(포트폴리오) 6-슬라이드 임원 보고용 PPT 보기.
// 채널별 deck 페이지와 동일한 레이아웃, 데이터 소스만 포트폴리오 API.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ExecutiveDeckDocument } from "@/lib/audienceReport/deckModel";

function SlideShell({ index, accent, children }: { index: number; accent?: boolean; children: React.ReactNode }) {
  return (
    <section
      className={`relative mx-auto mb-6 flex aspect-video w-full flex-col justify-center overflow-hidden rounded-xl border p-8 shadow-sm sm:p-12 ${
        accent ? "border-transparent bg-[#1E293B] text-white" : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      }`}
    >
      <span className={`absolute right-4 top-4 text-xs ${accent ? "text-slate-400" : "text-neutral-400"}`}>{index} / 6</span>
      {children}
    </section>
  );
}
function ActionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-balance text-2xl font-bold leading-snug text-[#3A30DF] dark:text-indigo-400 sm:text-3xl">{children}</h2>;
}
function ChartNote({ text }: { text: string }) {
  return <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-xs italic text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">{text}</div>;
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
function SoWhat({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-4 rounded-md bg-indigo-50 px-4 py-2.5 text-sm dark:bg-indigo-950/40">
      <span className="mr-1.5 font-semibold text-[#3A30DF] dark:text-indigo-300">So What?</span>
      <span className="text-neutral-800 dark:text-neutral-200">{text}</span>
    </div>
  );
}
// 사용자 지시(2026-09-01): 본문은 짧게, 꼭 필요한 부연 설명만 작은 글씨로 별도 표시.
function SlideNote({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-2 text-[11px] leading-snug text-neutral-400 dark:text-neutral-500">{text}</p>;
}

function DeckBody({ deck, wordHref, pptxHref }: { deck: ExecutiveDeckDocument; wordHref: string; pptxHref: string }) {
  const d = deck.slides;
  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">Executive Deck · 종합</div>
          <div className="text-sm text-neutral-500">{deck.periodLabel}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={pptxHref} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
            PPT 다운로드
          </a>
          <a href={wordHref} target="_blank" className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
            ← Word 보기
          </a>
        </div>
      </header>

      {!deck.generatedByAi && (
        <div className="mb-4 rounded bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          AI 문장 생성이 수치 검증을 통과하지 못해, 근거 신호를 그대로 나열한 폴백 문구로 표시됩니다.
        </div>
      )}

      <SlideShell index={1} accent>
        <div className="text-balance text-2xl font-bold leading-snug sm:text-4xl">{d.title.title}</div>
        <div className="mt-3 text-sm text-slate-300 sm:text-base">{d.title.subtitle}</div>
        <div className="mt-8 text-xs text-slate-400">
          {d.title.dateLabel} · {d.title.author}
        </div>
      </SlideShell>

      <SlideShell index={2}>
        <ActionTitle>{d.executiveSummary.actionTitle}</ActionTitle>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {d.executiveSummary.kpiHighlights.map((h, i) => (
            <div key={i} className="rounded-md bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              {h}
            </div>
          ))}
        </div>
        <Bullets items={d.executiveSummary.verdict} />
        <SlideNote text={d.executiveSummary.note} />
      </SlideShell>

      <SlideShell index={3}>
        <ActionTitle>{d.trend.actionTitle}</ActionTitle>
        <ChartNote text={d.trend.chartNote} />
        <Bullets items={d.trend.bullets} />
        <SoWhat text={d.trend.soWhat} />
        <SlideNote text={d.trend.note} />
      </SlideShell>

      <SlideShell index={4}>
        <ActionTitle>{d.demographic.actionTitle}</ActionTitle>
        <ChartNote text={d.demographic.chartNote} />
        <Bullets items={d.demographic.bullets} />
        <SoWhat text={d.demographic.soWhat} />
        <SlideNote text={d.demographic.note} />
      </SlideShell>

      <SlideShell index={5}>
        <ActionTitle>{d.content.actionTitle}</ActionTitle>
        <ChartNote text={d.content.chartNote} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-emerald-600">TOP 3</div>
            <Bullets items={d.content.topBullets} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-rose-600">BOTTOM 3</div>
            <Bullets items={d.content.bottomBullets} />
          </div>
        </div>
        <SoWhat text={d.content.soWhat} />
        <SlideNote text={d.content.note} />
      </SlideShell>

      <SlideShell index={6}>
        <ActionTitle>{d.strategy.actionTitle}</ActionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1.5 rounded bg-rose-600 px-2 py-1 text-center text-xs font-bold text-white">STOP</div>
            <Bullets items={d.strategy.stop} />
          </div>
          <div>
            <div className="mb-1.5 rounded bg-slate-600 px-2 py-1 text-center text-xs font-bold text-white">KEEP</div>
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

function PortfolioDeckPageInner() {
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
        const res = await fetch(`/api/audience-report/portfolio/deck?${searchParams.toString()}`);
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
  }, [searchParams]);

  if (loading) return <div className="p-8 text-neutral-500">불러오는 중...</div>;
  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!deck) return null;

  const qs = searchParams.toString();
  return <DeckBody deck={deck} wordHref={`/audience-report/portfolio?${qs}`} pptxHref={`/api/audience-report/portfolio/deck/pptx?${qs}`} />;
}

export default function PortfolioDeckPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500">불러오는 중...</div>}>
      <PortfolioDeckPageInner />
    </Suspense>
  );
}
