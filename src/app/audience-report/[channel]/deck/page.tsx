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
//
// ena-design 전면 재적용(2026-09-09, 사용자 지시 — "PPT 형식이나 내용이 ENA DESIGN 스킬과
// 거리가 있어 보입니다"): 이 화면은 그동안 exportRenderers.ts/enaPptTheme.ts(.pptx 파일
// 자체)만 ena-design으로 새로 짜여졌고, 사용자가 실제로 보는 이 다운로드 전 웹 미리보기는
// 예전 톤(어두운 네이비 카드, 고정 인디고 액센트, 시스템 폰트)에 그대로 남아 있었다 — 스크린샷
// 신고의 실제 출처. 색·그라데이션·슬로건 계산은 enaColorTokens.ts(순수 함수, Node API 없음)를
// .pptx 렌더러와 그대로 공유해 "웹에서 보는 색과 다운로드한 PPT 색이 다르다"는 사고를 원천
// 차단한다. 표지/EOD는 그라데이션+슬로건 락업, 본문은 흰 배경+우상단 채널 로고+눈썹 라벨(액센트
// 틱+대문자)+검정에 가까운 큰 제목(KT Flow Black)까지 .pptx와 동일한 구성으로 맞춘다.
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { ExecutiveDeckDocument, DeckBarPoint } from "@/lib/audienceReport/deckModel";
import { resolveAccent, resolveGradient, resolveSlogan, resolveEodSlogan, SUCCESS, DANGER, GRAY_900 } from "@/lib/audienceReport/enaColorTokens";

const hex = (v: string) => `#${v}`;

function isValidHex(v: string | null | undefined): v is string {
  return !!v && /^#[0-9A-Fa-f]{6}$/.test(v);
}
/** accent와 흰색을 섞어 옅은 배경 톤을 만든다(So What? 박스 배경 등). amount 0~1, 1에 가까울수록 흼. */
function tintWithWhite(accentHex: string, amount: number): string {
  const r = parseInt(accentHex.slice(1, 3), 16);
  const g = parseInt(accentHex.slice(3, 5), 16);
  const b = parseInt(accentHex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// enaPptTheme.ts의 HORIZONTAL_LOGO_BY_CODE / ChannelLogo.tsx의 WIDE_LOGO_OVERRIDE와 동일한
// 매핑(세 채널만 가로형 파일이 있음) — 두 서버 전용 파일을 이 클라이언트 컴포넌트에서
// import할 수 없어(fs 사용) 값만 그대로 옮겨 적는다.
const HORIZONTAL_LOGO_BY_CODE: Record<string, string> = {
  ENA_DRAMA: "ENA_DRAMA_H.png",
  ENA_PLAY: "ENA_PLAY_H.png",
  ENA_STORY: "ENA_STORY_H.png",
};
function channelLogoSrc(channelCode: string | null): string | null {
  if (!channelCode) return null;
  return `/channel-logos/${HORIZONTAL_LOGO_BY_CODE[channelCode] ?? `${channelCode}.png`}`;
}

/** 우상단 채널 로고 — .pptx 본문 마스터와 같은 자리·같은 상대 크기(ena-design "로고는 매
 * 슬라이드 같은 자리·같은 크기" 규칙). 파일이 없으면 채널명 워드마크 텍스트로 대체(마스터 정의와 동일). */
function ContentLogo({ channelCode, channelName, accent }: { channelCode: string | null; channelName: string; accent: string }) {
  const src = channelLogoSrc(channelCode);
  if (!src) {
    return (
      <span className="font-ktflow-black absolute right-8 top-6 text-base" style={{ color: accent }}>
        {channelName}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 로고 파일 자체가 작아 next/image 최적화 이득이 낮음(ChannelLogo.tsx와 동일한 선택)
    <img src={src} alt={channelName} className="absolute right-8 top-6 h-6 w-auto object-contain sm:h-7" />
  );
}

/** 본문 슬라이드 — 흰 배경, 우상단 로고, 우하단 쪽번호(ena-design 본문 마스터와 동일 구성). */
function ContentSlideShell({
  index,
  total,
  accent,
  channelCode,
  channelName,
  children,
}: {
  index: number;
  total: number;
  accent: string;
  channelCode: string | null;
  channelName: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative mx-auto mb-6 min-h-[26rem] w-full rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm sm:p-12">
      <ContentLogo channelCode={channelCode} channelName={channelName} accent={accent} />
      <span className="font-ktflow-bold absolute bottom-5 right-8 text-xs" style={{ color: "#7C7C8C" }}>
        {index} / {total}
      </span>
      {children}
    </section>
  );
}

/** 눈썹 라벨 — 액센트 틱 바 + 대문자 볼드 텍스트(ena-design .eyebrow, .pptx addEyebrow와 동일 구성). */
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

/** Action Title — 검정에 가까운 큰 제목(ena-design .slide-title, 굵기 대비가 이 시스템의 서명 — 액센트가 아니다). */
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

/** So What? 강조 바 — 액센트 틱 + 옅은 액센트 배경(ena-design "brand" 카드 톤, .pptx addSoWhat과 동일 구성). */
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

// 사용자 지시(2026-09-01): "슬라이드의 본문 글자 수는 제한하되 필요한 설명의 경우 작게 들어갈
// 수 있습니다" — 개조식 본문은 짧게 유지하고, 꼭 필요한 부연 설명만 이 작은 글씨 note로 별도 표시.
function SlideNote({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-2 text-[11px] leading-snug text-neutral-400">{text}</p>;
}

const CHART_UP = hex(SUCCESS);
const CHART_DOWN = hex(DANGER);

/** 값이 있는 막대만 그린다 — 데이터가 아예 없으면 "데이터 부족" 안내로 대체(빈 차트 그리지 않음). */
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

function LineChart({ points, height = 180, accent }: { points: DeckBarPoint[]; height?: number; accent: string }) {
  const withValues = points.filter((p) => p.value !== null) as { label: string; value: number }[];
  if (withValues.length === 0) return <p className="rounded bg-neutral-50 p-4 text-center text-xs text-neutral-400">이 구간은 표시할 데이터가 부족합니다.</p>;
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
              <text x={xOf(i)} y={height - 4} textAnchor="middle" fontSize={9} fill="#7C7C8C">
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
  // .pptx 렌더러(exportRenderers.ts)와 완전히 같은 계산: ENA 채널은 항상 공식 ENA Blue,
  // 나머지는 채널 로고색(themeColor), 둘 다 없으면 ENA Blue 폴백 — 웹 미리보기와 다운받은
  // PPT가 다른 색으로 보이는 사고를 여기서 차단한다.
  const accentBare = resolveAccent(deck.channelCode, deck.themeColor && isValidHex(deck.themeColor) ? deck.themeColor : null);
  const accent = hex(accentBare);
  const gradient = resolveGradient(accentBare);
  const slogan = resolveSlogan(deck.channelCode);
  const isEnaChannel = deck.channelCode === "ENA";
  const channelName = d.title.title.split(" ")[0] || deck.channelCode || "ENA";

  const eodSlide = 1; // EOD(마무리) 슬라이드 1장을 항상 마지막에 추가
  const total = 6 + (d.weekday.available ? 1 : 0) + (d.hourly.available ? 1 : 0) + eodSlide;
  let idx = 0;
  const next = () => ++idx;
  // .pptx 렌더러(exportRenderers.ts)와 동일한 판단: 등락률 막대가 2개 미만이면 거의 빈 차트를
  // 억지로 그리지 않고 핵심 지표 카드로 그 공간을 채운다(레이아웃 재정비, 사용자 지시).
  const kpiBarCount = c.kpiDeltaBars.filter((b) => b.value !== null).length;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-8">
      {/* KT Flow — ena-design assets/fonts 원본을 그대로 서빙(public/ena-design/fonts). PC에
          폰트가 없어도 @font-face로 웹폰트가 로드되므로 .pptx와 달리 항상 실제 KT Flow로 보인다. */}
      <style>{`
        @font-face { font-family: 'KT Flow Black'; src: url('/ena-design/fonts/KTFLOW-BLACK.ttf') format('truetype'); font-display: swap; }
        @font-face { font-family: 'KT Flow Bold'; src: url('/ena-design/fonts/KTFLOW-BOLD.ttf') format('truetype'); font-display: swap; }
        @font-face { font-family: 'KT Flow Medium'; src: url('/ena-design/fonts/KTFLOW-MEDIUM.ttf') format('truetype'); font-display: swap; }
        @font-face { font-family: 'KT Flow Thin'; src: url('/ena-design/fonts/KTFLOW-THIN.ttf') format('truetype'); font-display: swap; }
        .font-ktflow-black { font-family: 'KT Flow Black', 'Pretendard', system-ui, sans-serif; }
        .font-ktflow-bold { font-family: 'KT Flow Bold', 'Pretendard', system-ui, sans-serif; }
        .font-ktflow-medium { font-family: 'KT Flow Medium', 'Pretendard', system-ui, sans-serif; }
      `}</style>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-ktflow-bold text-xs uppercase tracking-wide text-neutral-500">Executive Deck</div>
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

      {/* 1. Title — ena-design 표지: 그라데이션 배경 + 슬로건 락업(.pptx addCoverSlide와 동일 구성).
          ENA 채널만 시그니처 리본-웨이브 그래픽을 하단에 깐다(재색·재작도 금지 규칙 — 다른
          채널 색으로 물들이지 않고 ENA 덱에서만 원본 그대로 사용). */}
      <section
        className="relative mx-auto mb-6 flex min-h-[26rem] w-full flex-col justify-center overflow-hidden rounded-2xl p-8 text-white shadow-sm sm:p-12"
        style={{ background: `linear-gradient(90deg, ${hex(gradient.from)}, ${hex(gradient.to)})` }}
      >
        <span className="absolute right-8 top-6 text-xs text-white/60">
          {next()} / {total}
        </span>
        {isEnaChannel && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/ena-design/ena-ribbon-line.png" alt="" aria-hidden className="pointer-events-none absolute bottom-0 left-0 w-full opacity-90" />
        )}
        <div className="relative z-10">
          <div className="mb-6 flex items-center gap-2">
            <span className="font-ktflow-black text-lg">{slogan.line1}</span>
            {slogan.isEnaWordmark ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/ena-design/ena-logo-white.png" alt="ENA" className="h-5" />
            ) : (
              <span className="font-ktflow-black text-lg">{slogan.line2}</span>
            )}
          </div>
          {deck.channelCode && (
            <div className="mb-3 inline-block w-fit rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: "rgba(255,255,255,0.16)" }}>
              {deck.channelCode}
            </div>
          )}
          <div className="font-ktflow-black text-balance text-2xl leading-snug sm:text-4xl">{d.title.title}</div>
          <div className="mt-4 h-1 w-16 rounded-full bg-white" />
          <div className="font-ktflow-bold mt-4 text-sm text-white/85 sm:text-base">{d.title.subtitle}</div>
          <div className="font-ktflow-medium mt-8 text-xs text-white/60">
            {d.title.dateLabel} · {d.title.author}
          </div>
        </div>
      </section>

      {/* 2. Executive Summary */}
      <ContentSlideShell index={next()} total={total} accent={accent} channelCode={deck.channelCode} channelName={channelName}>
        <Eyebrow text="EXECUTIVE SUMMARY" accent={accent} />
        <ActionTitle>{d.executiveSummary.actionTitle}</ActionTitle>
        {kpiBarCount >= 2 ? (
          <>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {d.executiveSummary.kpiHighlights.map((h, i) => (
                <div key={i} className="rounded-lg bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-700">
                  {h}
                </div>
              ))}
            </div>
            <div className="mb-2 text-xs text-neutral-500">5대 지표 등락률(전기간 대비, %)</div>
            <BarChart points={c.kpiDeltaBars} diverging height={150} accent={accent} />
          </>
        ) : (
          // 지표 등락 막대가 1개뿐이라 거의 빈 차트가 되던 문제(사용자 지시) — 핵심 지표를 채널색
          // 강조 바가 붙은 카드로 세로 나열해 그 공간을 대신 채운다(.pptx 렌더러와 동일한 판단).
          <div className="mb-4 space-y-2">
            {d.executiveSummary.kpiHighlights.map((h, i) => (
              <div key={i} className="rounded-lg border-l-4 bg-neutral-50 px-3 py-2.5 text-sm font-medium text-neutral-700" style={{ borderLeftColor: accent }}>
                {h}
              </div>
            ))}
          </div>
        )}
        <Bullets items={d.executiveSummary.verdict} accent={accent} />
        <SlideNote text={d.executiveSummary.note} />
      </ContentSlideShell>

      {/* 3. Trend */}
      <ContentSlideShell index={next()} total={total} accent={accent} channelCode={deck.channelCode} channelName={channelName}>
        <Eyebrow text="TREND" accent={accent} />
        <ActionTitle>{d.trend.actionTitle}</ActionTitle>
        <LineChart points={c.trendPoints} height={170} accent={accent} />
        <Bullets items={d.trend.bullets} accent={accent} />
        <SoWhat text={d.trend.soWhat} accent={accent} />
        <SlideNote text={d.trend.note} />
      </ContentSlideShell>

      {/* 4(신규). 주중 vs 주말 · 요일별 */}
      {d.weekday.available && (
        <ContentSlideShell index={next()} total={total} accent={accent} channelCode={deck.channelCode} channelName={channelName}>
          <Eyebrow text="WEEKDAY · WEEKEND" accent={accent} />
          <ActionTitle>{d.weekday.actionTitle}</ActionTitle>
          <BarChart points={c.weekdayBars} height={200} accent={accent} />
          <p className="mt-3 text-center text-sm text-neutral-600">{d.weekday.caption}</p>
        </ContentSlideShell>
      )}

      {/* 5(신규). 시간대별 분석 */}
      {d.hourly.available && (
        <ContentSlideShell index={next()} total={total} accent={accent} channelCode={deck.channelCode} channelName={channelName}>
          <Eyebrow text="HOURLY" accent={accent} />
          <ActionTitle>{d.hourly.actionTitle}</ActionTitle>
          <BarChart points={c.hourlyBars} height={200} accent={accent} />
          <p className="mt-3 text-center text-sm text-neutral-600">{d.hourly.caption}</p>
        </ContentSlideShell>
      )}

      {/* 6. Demographic / Positioning */}
      <ContentSlideShell index={next()} total={total} accent={accent} channelCode={deck.channelCode} channelName={channelName}>
        <Eyebrow text="AUDIENCE" accent={accent} />
        <ActionTitle>{d.demographic.actionTitle}</ActionTitle>
        <BarChart points={c.demographicBars} height={170} accent={accent} />
        <Bullets items={d.demographic.bullets} accent={accent} />
        <SoWhat text={d.demographic.soWhat} accent={accent} />
        <SlideNote text={d.demographic.note} />
      </ContentSlideShell>

      {/* 7. Killer Content & Timeslot — 상승/하락은 채널색이 아니라 의미 색(초록/빨강) 유지. */}
      <ContentSlideShell index={next()} total={total} accent={accent} channelCode={deck.channelCode} channelName={channelName}>
        <Eyebrow text="CONTENT" accent={accent} />
        <ActionTitle>{d.content.actionTitle}</ActionTitle>
        <div className="mb-2 text-xs text-neutral-500">프로그램별 등락(성장/약세)</div>
        <BarChart points={c.programBars} diverging height={170} accent={accent} />
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

      {/* 8. Strategy — Stop / Keep / Start(KEEP만 채널색, 나머지는 의미 색 유지). */}
      <ContentSlideShell index={next()} total={total} accent={accent} channelCode={deck.channelCode} channelName={channelName}>
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

      {/* 9. E.O.D(마무리) — ena-design 06-eod: 그라데이션 + 슬로건, 다운로드 전 웹 미리보기에도
          .pptx와 같은 "시작·끝은 그라데이션" 인상을 준다(2026-09-09 사용자 지시로 신설). */}
      <section
        className="relative mx-auto flex min-h-[20rem] w-full flex-col items-center justify-center overflow-hidden rounded-2xl p-8 text-center text-white shadow-sm"
        style={{ background: `linear-gradient(90deg, ${hex(gradient.from)}, ${hex(gradient.to)})` }}
      >
        {isEnaChannel && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/ena-design/ena-ribbon-line.png" alt="" aria-hidden className="pointer-events-none absolute bottom-0 left-0 w-full opacity-90" />
        )}
        <div className="relative z-10">
          <div className="font-ktflow-black text-4xl tracking-[0.12em]">E.O.D</div>
          <div className="font-ktflow-bold mt-4 text-sm text-white/80">{resolveEodSlogan(deck.channelCode)}</div>
        </div>
      </section>
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
