"use client";

// Phase 13(2026-09-01, 사용자 지시) — 종합(포트폴리오) 임원 보고용 PPT 보기. 채널별 deck
// 페이지와 동일한 레이아웃, 데이터 소스만 포트폴리오 API.
// Phase 14(2026-09-01) — 실제 SVG 차트 추가(채널별 페이지와 동일한 컴포넌트, 이 프로젝트
// 관례대로 작은 헬퍼는 페이지마다 로컬로 둔다). 포트폴리오 스코프는 요일별·시간대별·연령대별
// 원본 데이터가 없어(portfolioModel.ts 자체가 채널 간 관계만 다룸) 그 2개 슬라이드는 생략되고,
// KPI/Trend/Content 슬라이드에 Peer 비교 차트가 대신 들어간다.
//
// ena-design 전면 재적용(2026-09-09, 사용자 지시 — 채널별 deck 화면과 같은 신고): 색·그라데이션·
// 슬로건은 enaColorTokens.ts를 채널별 deck 페이지와 그대로 공유한다. 포트폴리오는 특정 채널로
// 좁힐 수 없어(portfolioFlatten.ts와 동일한 결정) channelCode=null → ENA Blue 그라데이션 +
// "매일 새로운 ENA" 슬로건 + "KT ENA" 워드마크로 폴백하되, 리본-웨이브 그래픽은 ENA 채널 전용
// 자산이라 포트폴리오에는 쓰지 않는다(.pptx exportRenderers.ts와 동일한 판단).
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ExecutiveDeckDocument, DeckBarPoint } from "@/lib/audienceReport/deckModel";
import { resolveAccent, resolveGradient, resolveSlogan, resolveEodSlogan, SUCCESS, DANGER, GRAY_900 } from "@/lib/audienceReport/enaColorTokens";

const hex = (v: string) => `#${v}`;

function tintWithWhite(accentHex: string, amount: number): string {
  const r = parseInt(accentHex.slice(1, 3), 16);
  const g = parseInt(accentHex.slice(3, 5), 16);
  const b = parseInt(accentHex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** 우상단 로고 — 포트폴리오는 특정 채널이 없어 "KT ENA" 워드마크 텍스트로 고정
 * (.pptx 렌더러의 loadChannelLogo(null)→null 폴백과 동일한 결과). */
function ContentLogo({ accent }: { accent: string }) {
  return (
    <span className="font-ktflow-black absolute right-8 top-6 text-base" style={{ color: accent }}>
      KT ENA
    </span>
  );
}

function ContentSlideShell({ index, total, accent, children }: { index: number; total: number; accent: string; children: React.ReactNode }) {
  return (
    <section className="relative mx-auto mb-6 min-h-[26rem] w-full rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm sm:p-12">
      <ContentLogo accent={accent} />
      <span className="font-ktflow-bold absolute bottom-5 right-8 text-xs" style={{ color: "#7C7C8C" }}>
        {index} / {total}
      </span>
      {children}
    </section>
  );
}

function Eyebrow({ text, accent }: { text: string; accent: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-block h-1 w-6 rounded-full" style={{ backgroundColor: accent }} />
      <span className="font-ktflow-bold text-xs tracking-[0.08em]" style={{ color: accent }}>
        {text}
      </span>
    </div>
  );
}

function ActionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-ktflow-black mb-4 text-balance text-2xl leading-snug sm:text-3xl" style={{ color: hex(GRAY_900) }}>
      {children}
    </h2>
  );
}

function Bullets({ items, accent }: { items: string[]; accent: string }) {
  if (items.length === 0) return <p className="text-sm italic text-neutral-400">표시할 신호가 없습니다.</p>;
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed text-neutral-800 sm:text-base">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function SoWhat({ text, accent }: { text: string; accent: string }) {
  if (!text) return null;
  return (
    <div className="relative mt-4 overflow-hidden rounded-xl py-3 pl-6 pr-4 text-sm" style={{ backgroundColor: tintWithWhite(accent, 0.92) }}>
      <span className="absolute inset-y-2.5 left-2 w-1 rounded-full" style={{ backgroundColor: accent }} />
      <span className="font-ktflow-bold mr-1.5" style={{ color: accent }}>
        So What?
      </span>
      <span className="text-neutral-800">{text}</span>
    </div>
  );
}

function SlideNote({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-2 text-[11px] leading-snug text-neutral-400">{text}</p>;
}

const CHART_UP = hex(SUCCESS);
const CHART_DOWN = hex(DANGER);

function BarChart({ points, diverging, height = 180, accent }: { points: DeckBarPoint[]; diverging?: boolean; height?: number; accent: string }) {
  const withValues = points.filter((p) => p.value !== null) as { label: string; value: number }[];
  if (withValues.length === 0) return <p className="rounded bg-neutral-50 p-4 text-center text-xs text-neutral-400">이 구간은 표시할 데이터가 부족합니다.</p>;
  const barW = 44;
  const gap = 14;
  const w = withValues.length * (barW + gap) + gap;
  const maxAbs = Math.max(...withValues.map((p) => Math.abs(p.value)), 1e-9);
  const zeroY = diverging ? height / 2 : height - 24;
  const usableHalf = diverging ? height / 2 - 20 : height - 44;
  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height} className="block">
        <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="#E2E2EA" strokeWidth={1} />
        {withValues.map((p, i) => {
          const barH = Math.max(2, (Math.abs(p.value) / maxAbs) * usableHalf);
          const up = p.value >= 0;
          const x = gap + i * (barW + gap);
          const y = up ? zeroY - barH : zeroY;
          const color = diverging ? (up ? CHART_UP : CHART_DOWN) : accent;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={2} fill={color} />
              <text x={x + barW / 2} y={up ? y - 4 : y + barH + 12} textAnchor="middle" fontSize={9} fill="#7C7C8C">
                {p.value.toFixed(p.value !== 0 && Math.abs(p.value) < 1 ? 3 : 1)}
              </text>
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={9} fill="#7C7C8C">
                {p.label.length > 6 ? `${p.label.slice(0, 6)}…` : p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DeckBody({ deck, wordHref, pptxHref }: { deck: ExecutiveDeckDocument; wordHref: string; pptxHref: string }) {
  const d = deck.slides;
  const c = deck.charts;
  // .pptx 렌더러와 동일: 포트폴리오는 channelCode=null → ENA Blue/공식 그라데이션/네트워크
  // 슬로건으로 폴백(portfolioFlatten.ts의 brand 필드와 같은 결정).
  const accentBare = resolveAccent(null, null);
  const accent = hex(accentBare);
  const gradient = resolveGradient(accentBare);
  const slogan = resolveSlogan(null);
  const total = 7; // 기존 6장 + E.O.D 1장
  let idx = 0;
  const next = () => ++idx;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-8">
      <style>{`
        @font-face { font-family: 'KT Flow Black'; src: url('/ena-design/fonts/KTFLOW-BLACK.ttf') format('truetype'); font-display: swap; }
        @font-face { font-family: 'KT Flow Bold'; src: url('/ena-design/fonts/KTFLOW-BOLD.ttf') format('truetype'); font-display: swap; }
        @font-face { font-family: 'KT Flow Medium'; src: url('/ena-design/fonts/KTFLOW-MEDIUM.ttf') format('truetype'); font-display: swap; }
        .font-ktflow-black { font-family: 'KT Flow Black', 'Pretendard', system-ui, sans-serif; }
        .font-ktflow-bold { font-family: 'KT Flow Bold', 'Pretendard', system-ui, sans-serif; }
      `}</style>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-ktflow-bold text-xs uppercase tracking-wide text-neutral-500">Executive Deck · 종합</div>
          <div className="text-sm text-neutral-500">{deck.periodLabel}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={pptxHref} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
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
        <div className="mb-4 rounded bg-amber-50 p-2 text-xs text-amber-700">
          AI 문장 생성이 수치 검증을 통과하지 못해, 텍스트는 근거 신호를 그대로 나열한 폴백 문구로 표시됩니다(차트는 실제 데이터 그대로).
        </div>
      )}

      {/* 1. Title — 그라데이션 + 슬로건 락업(채널별 deck 페이지와 동일 구성, 리본 그래픽만 제외). */}
      <section
        className="relative mx-auto mb-6 flex min-h-[26rem] w-full flex-col justify-center overflow-hidden rounded-2xl p-8 text-white shadow-sm sm:p-12"
        style={{ background: `linear-gradient(90deg, ${hex(gradient.from)}, ${hex(gradient.to)})` }}
      >
        <span className="absolute right-8 top-6 text-xs text-white/60">
          {next()} / {total}
        </span>
        <div className="mb-6 flex items-center gap-2">
          <span className="font-ktflow-black text-lg">{slogan.line1}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ena-design/ena-logo-white.png" alt="ENA" className="h-5" />
        </div>
        <div className="font-ktflow-black text-balance text-2xl leading-snug sm:text-4xl">{d.title.title}</div>
        <div className="mt-4 h-1 w-16 rounded-full bg-white" />
        <div className="font-ktflow-bold mt-4 text-sm text-white/85 sm:text-base">{d.title.subtitle}</div>
        <div className="mt-8 text-xs text-white/60">
          {d.title.dateLabel} · {d.title.author}
        </div>
      </section>

      <ContentSlideShell index={next()} total={total} accent={accent}>
        <Eyebrow text="EXECUTIVE SUMMARY" accent={accent} />
        <ActionTitle>{d.executiveSummary.actionTitle}</ActionTitle>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {d.executiveSummary.kpiHighlights.map((h, i) => (
            <div key={i} className="rounded-lg bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-700">
              {h}
            </div>
          ))}
        </div>
        <div className="mb-2 text-xs text-neutral-500">7채널 추세(12주 평균 대비, %)</div>
        <BarChart points={c.kpiDeltaBars} diverging height={150} accent={accent} />
        <Bullets items={d.executiveSummary.verdict} accent={accent} />
        <SlideNote text={d.executiveSummary.note} />
      </ContentSlideShell>

      <ContentSlideShell index={next()} total={total} accent={accent}>
        <Eyebrow text="TREND" accent={accent} />
        <ActionTitle>{d.trend.actionTitle}</ActionTitle>
        <div className="mb-2 text-xs text-neutral-500">7채널 시청률 수준</div>
        <BarChart points={c.programBars} height={170} accent={accent} />
        <Bullets items={d.trend.bullets} accent={accent} />
        <SoWhat text={d.trend.soWhat} accent={accent} />
        <SlideNote text={d.trend.note} />
      </ContentSlideShell>

      <ContentSlideShell index={next()} total={total} accent={accent}>
        <Eyebrow text="AUDIENCE" accent={accent} />
        <ActionTitle>{d.demographic.actionTitle}</ActionTitle>
        <Bullets items={d.demographic.bullets} accent={accent} />
        <SoWhat text={d.demographic.soWhat} accent={accent} />
        <SlideNote text={d.demographic.note} />
      </ContentSlideShell>

      <ContentSlideShell index={next()} total={total} accent={accent}>
        <Eyebrow text="CONTENT" accent={accent} />
        <ActionTitle>{d.content.actionTitle}</ActionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: CHART_UP }}>
              TOP
            </div>
            <Bullets items={d.content.topBullets} accent={accent} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: CHART_DOWN }}>
              BOTTOM
            </div>
            <Bullets items={d.content.bottomBullets} accent={accent} />
          </div>
        </div>
        <SoWhat text={d.content.soWhat} accent={accent} />
        <SlideNote text={d.content.note} />
      </ContentSlideShell>

      <ContentSlideShell index={next()} total={total} accent={accent}>
        <Eyebrow text="STRATEGY" accent={accent} />
        <ActionTitle>{d.strategy.actionTitle}</ActionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="font-ktflow-bold mb-1.5 rounded px-2 py-1 text-center text-xs text-white" style={{ backgroundColor: CHART_DOWN }}>
              STOP
            </div>
            <Bullets items={d.strategy.stop} accent={accent} />
          </div>
          <div>
            <div className="font-ktflow-bold mb-1.5 rounded px-2 py-1 text-center text-xs text-white" style={{ backgroundColor: accent }}>
              KEEP
            </div>
            <Bullets items={d.strategy.keep} accent={accent} />
          </div>
          <div>
            <div className="font-ktflow-bold mb-1.5 rounded px-2 py-1 text-center text-xs text-white" style={{ backgroundColor: CHART_UP }}>
              START
            </div>
            <Bullets items={d.strategy.start} accent={accent} />
          </div>
        </div>
        <SlideNote text={d.strategy.note} />
      </ContentSlideShell>

      {/* 7. E.O.D(마무리) — 채널별 deck 페이지와 동일하게 신설(2026-09-09 사용자 지시). */}
      <section
        className="relative mx-auto flex min-h-[20rem] w-full flex-col items-center justify-center overflow-hidden rounded-2xl p-8 text-center text-white shadow-sm"
        style={{ background: `linear-gradient(90deg, ${hex(gradient.from)}, ${hex(gradient.to)})` }}
      >
        <div className="font-ktflow-black text-4xl tracking-[0.12em]">E.O.D</div>
        <div className="font-ktflow-bold mt-4 text-sm text-white/80">{resolveEodSlogan(null)}</div>
      </section>
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
