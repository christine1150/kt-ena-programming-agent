"use client";

// 2026-09-17(사용자 지시 — "P를 누르면 Powerpoint 상세버전 미리보기") — 상세 .pptx 미리보기 화면.
//
// 이전에는 이 자리에 6~9장짜리 임원 요약 덱이 떠서, 미리보기와 실제 내려받는 .pptx가 **서로 다른
// 문서**였다. 지금은 서버가 pptSlidePlan.ts로 만든 슬라이드 계획(PptPreviewPayload)을 그대로
// 받아 그린다 — 장수·순서·표 분할·문구가 .pptx와 같은 함수에서 나오므로 "화면에서 본 것과 받은
// 파일이 다르다"는 사고가 구조적으로 생길 수 없다.
//
// 색·그라데이션·슬로건은 enaColorTokens.ts(순수 함수)를 .pptx 렌더러와 공유하고, 레이아웃은
// enaPptTheme.ts의 본문 마스터 구성(흰 배경 + 우상단 로고 + 눈썹 라벨 + 큰 제목 + 쪽번호)을
// 화면 비율로 옮겨 그린다. 채널별 리포트와 종합 리포트가 이 컴포넌트 하나를 공유한다.
import type { PptPreviewPayload, PptSlidePlan } from "@/lib/audienceReport/pptSlidePlan";
import type { DocBlock } from "@/lib/audienceReport/reportFlatten";
import {
  resolveAccent,
  resolveGradient,
  resolveSlogan,
  resolveEodSlogan,
  tint,
  SUCCESS,
  DANGER,
  GRAY_900,
} from "@/lib/audienceReport/enaColorTokens";

const hex = (v: string) => `#${v}`;

function isValidHex(v: string | null | undefined): v is string {
  return !!v && /^#?[0-9A-Fa-f]{6}$/.test(v);
}

// enaPptTheme.ts의 HORIZONTAL_LOGO_BY_CODE / ChannelLogo.tsx의 WIDE_LOGO_OVERRIDE와 동일한
// 매핑(세 채널만 가로형 파일이 있음) — 서버 전용 파일(fs 사용)을 이 클라이언트 컴포넌트에서
// import할 수 없어 값만 그대로 옮겨 적는다.
const HORIZONTAL_LOGO_BY_CODE: Record<string, string> = {
  ENA_DRAMA: "ENA_DRAMA_H.png",
  ENA_PLAY: "ENA_PLAY_H.png",
  ENA_STORY: "ENA_STORY_H.png",
};

function channelLogoSrc(channelCode: string | null): string | null {
  if (!channelCode) return null;
  return `/channel-logos/${HORIZONTAL_LOGO_BY_CODE[channelCode] ?? `${channelCode}.png`}`;
}

/** 우상단 채널 로고 — .pptx 본문 마스터와 같은 자리·같은 상대 크기. 파일이 없으면 워드마크 텍스트. */
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
    // eslint-disable-next-line @next/next/no-img-element -- 로고 파일이 작아 next/image 최적화 이득이 낮음(ChannelLogo.tsx와 동일한 선택)
    <img src={src} alt={channelName} className="absolute right-8 top-6 h-6 w-auto object-contain sm:h-7" />
  );
}

/** 눈썹 라벨 — 액센트 틱 바 + 대문자 볼드(.pptx addEyebrow와 동일 구성). */
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

/** 슬라이드 제목 — 검정에 가까운 큰 제목(ena-design .slide-title, 굵기 대비가 이 시스템의 서명). */
function SlideTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-ktflow-black mb-4 text-balance text-2xl leading-snug sm:text-3xl" style={{ color: hex(GRAY_900) }}>
      {children}
    </h2>
  );
}

/** accent는 CSS용(`#` 포함), accentBare는 enaColorTokens 계산용(`#` 없는 6자리) — 두 표기를 섞지 않는다. */
function BlockView({ block, accent, accentBare }: { block: DocBlock; accent: string; accentBare: string }) {
  switch (block.kind) {
    case "text":
      return <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-800 sm:text-base">{block.text}</p>;
    case "bullets":
      return (
        <ul className="space-y-1.5 text-sm leading-relaxed text-neutral-800 sm:text-base">
          {block.items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      );
    case "kpi":
      // .pptx addKpiCards와 같은 구성 — 한 줄에 3장, 각 줄의 첫 카드는 액센트로 채운 brand 카드.
      return (
        <div className="space-y-3">
          {[block.items.slice(0, 3), block.items.slice(3, 6)]
            .filter((row) => row.length > 0)
            .map((row, ri) => (
              <div key={ri} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {row.map((k, i) => {
                  const brand = i === 0;
                  const deltaColor = brand ? hex(tint(accentBare, 0.75)) : k.dir === "up" ? hex(SUCCESS) : k.dir === "down" ? hex(DANGER) : "#7C7C8C";
                  return (
                    <div
                      key={k.label}
                      className="rounded-2xl border px-5 py-4"
                      style={{ backgroundColor: brand ? accent : "#FFFFFF", borderColor: brand ? accent : "#E2E2EA" }}
                    >
                      <div className="font-ktflow-bold text-xs" style={{ color: brand ? hex(tint(accentBare, 0.82)) : "#585866" }}>
                        {k.label}
                      </div>
                      <div className="font-ktflow-black mt-1 text-3xl tabular-nums" style={{ color: brand ? "#FFFFFF" : accent }}>
                        {k.value}
                      </div>
                      {k.delta && (
                        <div className="font-ktflow-bold mt-1 text-xs tabular-nums" style={{ color: deltaColor }}>
                          {k.delta}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                {block.headers.map((h) => (
                  <th key={h} className="font-ktflow-bold border-b px-2 py-2 text-left text-xs" style={{ backgroundColor: "#F7F7FA", borderColor: "#E2E2EA", color: hex(GRAY_900) }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b px-2 py-1.5 align-top text-neutral-800" style={{ borderColor: "#E2E2EA" }}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note":
      // 계획 단계(pptSlidePlan.omitEmptyBlocks)에서 이미 걸러지므로 정상 경로에서는 나타나지 않는다.
      return <p className="rounded bg-neutral-50 p-4 text-center text-xs text-neutral-400">{block.text}</p>;
  }
}

export function PptPreview({
  payload,
  pptxHref,
  wordHref,
  headerLabel,
}: {
  payload: PptPreviewPayload;
  /** 이 미리보기의 형식 그대로 받는 다운로드 경로(.pptx) */
  pptxHref: string;
  /** 같은 기간의 Word 미리보기로 넘어가는 교차 이동 경로 */
  wordHref: string;
  headerLabel: string;
}) {
  const { brand, slides } = payload;
  // .pptx 렌더러(enaPptTheme.createEnaTheme)와 완전히 같은 계산 — 웹에서 보는 색과 다운로드한
  // PPT 색이 다르게 보이는 사고를 여기서 차단한다.
  const accentBare = resolveAccent(brand.channelCode, isValidHex(brand.themeColor) ? brand.themeColor : null);
  const accent = hex(accentBare);
  const gradient = resolveGradient(accentBare);
  const slogan = resolveSlogan(brand.channelCode);
  const isEnaChannel = brand.channelCode === "ENA";
  const total = slides.length;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-8">
      {/* KT Flow — ena-design assets/fonts 원본을 그대로 서빙(public/ena-design/fonts). 굵기별
          개별 패밀리를 직접 지정한다(합성 볼드 금지 규칙). */}
      <style>{`
        @font-face { font-family: 'KT Flow Black'; src: url('/ena-design/fonts/KTFLOW-BLACK.ttf') format('truetype'); font-display: swap; }
        @font-face { font-family: 'KT Flow Bold'; src: url('/ena-design/fonts/KTFLOW-BOLD.ttf') format('truetype'); font-display: swap; }
        @font-face { font-family: 'KT Flow Medium'; src: url('/ena-design/fonts/KTFLOW-MEDIUM.ttf') format('truetype'); font-display: swap; }
        .font-ktflow-black { font-family: 'KT Flow Black', 'Pretendard', system-ui, sans-serif; }
        .font-ktflow-bold { font-family: 'KT Flow Bold', 'Pretendard', system-ui, sans-serif; }
        .font-ktflow-medium { font-family: 'KT Flow Medium', 'Pretendard', system-ui, sans-serif; }
      `}</style>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-ktflow-bold text-xs uppercase tracking-wide text-neutral-500">{headerLabel}</div>
          <div className="text-sm text-neutral-500">{payload.subtitle}</div>
          <div className="mt-0.5 text-xs text-neutral-400">총 {total}장 — 아래 미리보기가 그대로 PPT 파일로 저장됩니다.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={pptxHref}
            className="font-ktflow-bold rounded-md px-3 py-1.5 text-xs text-white hover:opacity-90"
            style={{ backgroundColor: accent }}
          >
            PPT 다운로드
          </a>
          <a
            href={wordHref}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:opacity-80"
            style={{ borderColor: accent, backgroundColor: hex(tint(accentBare, 0.92)), color: accent }}
          >
            ← Word 미리보기
          </a>
        </div>
      </header>

      {slides.map((slide, i) => (
        <SlideView
          key={i}
          slide={slide}
          index={i + 1}
          total={total}
          accent={accent}
          accentBare={accentBare}
          gradient={gradient}
          slogan={slogan}
          isEnaChannel={isEnaChannel}
          brand={brand}
        />
      ))}
    </main>
  );
}

function SlideView({
  slide,
  index,
  total,
  accent,
  accentBare,
  gradient,
  slogan,
  isEnaChannel,
  brand,
}: {
  slide: PptSlidePlan;
  index: number;
  total: number;
  accent: string;
  accentBare: string;
  gradient: { from: string; to: string };
  slogan: { line1: string; line2: string; isEnaWordmark: boolean };
  isEnaChannel: boolean;
  brand: PptPreviewPayload["brand"];
}) {
  if (slide.kind === "cover") {
    return (
      <section
        className="relative mx-auto mb-6 flex min-h-[26rem] w-full flex-col justify-center overflow-hidden rounded-2xl p-8 text-white shadow-sm sm:p-12"
        style={{ background: `linear-gradient(90deg, ${hex(gradient.from)}, ${hex(gradient.to)})` }}
      >
        <span className="absolute right-8 top-6 text-xs text-white/60">
          {index} / {total}
        </span>
        {isEnaChannel && (
          // eslint-disable-next-line @next/next/no-img-element -- ENA 시그니처 리본은 재색·재작도 금지(원본 그대로)
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
          <div className="mb-3 inline-block w-fit rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: "rgba(255,255,255,0.16)" }}>
            {slide.eyebrow}
          </div>
          <div className="font-ktflow-black text-balance text-2xl leading-snug sm:text-4xl">{slide.title}</div>
          <div className="mt-4 h-1 w-16 rounded-full bg-white" />
          <div className="font-ktflow-bold mt-4 text-sm text-white/85 sm:text-base">{slide.subtitle}</div>
          <div className="font-ktflow-medium mt-8 text-xs text-white/60">
            {slide.dateLabel} · {slide.author}
          </div>
        </div>
      </section>
    );
  }

  if (slide.kind === "eod") {
    return (
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
          <div className="font-ktflow-bold mt-4 text-sm text-white/80">{resolveEodSlogan(brand.channelCode)}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative mx-auto mb-6 min-h-[26rem] w-full rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm sm:p-12">
      <ContentLogo channelCode={brand.channelCode} channelName={brand.channelName} accent={accent} />
      <span className="font-ktflow-bold absolute bottom-5 right-8 text-xs" style={{ color: "#7C7C8C" }}>
        {index} / {total}
      </span>
      <Eyebrow text={slide.eyebrow} accent={accent} />
      <SlideTitle>{slide.title}</SlideTitle>
      {slide.caption && <div className="mb-2 text-xs text-neutral-500">{slide.caption}</div>}
      <BlockView block={slide.block} accent={accent} accentBare={accentBare} />
    </section>
  );
}
