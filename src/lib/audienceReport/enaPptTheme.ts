// 사용자 지시(2026-09-08): "2페이지 각 채널에서 PPT를 만들면 ena-design 스킬과 제작 방식을
// 활용해서 PPT를 만들도록 해줘" — ENA 디자인 시스템(ena-design 스킬)의 규칙을 pptxgenjs
// 원시 요소로 옮긴 공용 테마 레이어. 두 PPT 렌더러(문서형 renderReportPptx, 임원 보고용
// renderDeckPptx)가 이 파일 하나만 보고 그리게 해서 "같은 브랜드인데 문서마다 다르게 보이는"
// 문제를 원천 차단한다(reportFlatten.ts의 "내용 결정은 한 곳" 원칙을 디자인에도 적용).
//
// ena-design 원칙(readme.md) 중 이 파일이 강제하는 것:
//  · 본문 슬라이드 배경은 항상 흰색, 강조색은 단 하나(채널 포인트 컬러).
//  · 그라데이션은 표지·마무리(E.O.D) 슬라이드 전용 — 본문 뒤에는 절대 쓰지 않는다.
//  · 모든 본문 슬라이드 우상단에 채널 로고를 같은 크기로, 우하단에 페이지 번호.
//  · 타이포는 전부 KT Flow. 디스플레이/숫자는 굵게, 본문은 중간 굵기.
//  · 아이콘·이모지 없음. 등락은 ▲/▼ 문자로만.
//  · 여백을 넉넉히, 한 슬라이드에 한 메시지.
//
// 사용자 결정(2026-09-08): 포인트 컬러는 "ENA 채널만 공식 ENA Blue(#2c24ce), 나머지 6개
// 채널은 각자 로고색"으로 간다(2026-09-02의 "채널 로고 색을 포인트 컬러로" 지시와 ena-design의
// "ENA Blue 단일 강조색" 규칙을 절충). 폰트는 KT Flow로 지정한다 — pptxgenjs는 TTF를 파일에
// 심을 수 없어 KT Flow가 없는 PC에서는 시스템 한글 폰트로 대체되지만 레이아웃은 유지된다.
import { readFileSync } from "fs";
import { join } from "path";
import type PptxGenJS from "pptxgenjs";

type PptSlide = ReturnType<PptxGenJS["addSlide"]>;

// ── 단위 변환 ─────────────────────────────────────────────────────────────
// ena-design 캔버스는 1280×720px, pptxgenjs LAYOUT_16x9는 10×5.625in —
// 즉 128px = 1in이라 px 수치를 그대로 옮겨 쓸 수 있다(디자인 원본과 1:1 대응).
const PX_PER_IN = 128;
export const SLIDE_W = 10;
export const SLIDE_H = 5.625;
/** ena-design px 값을 인치로 (레이아웃 좌표·크기용) */
export const px = (v: number): number => v / PX_PER_IN;
/** ena-design px 값을 pt로 (글자 크기용, 1pt = 1/72in) */
export const ptSize = (v: number): number => Math.round(v * (72 / PX_PER_IN) * 10) / 10;

// ── 색 토큰(tokens/colors.css 그대로) ────────────────────────────────────
export const ENA_BLUE = "2C24CE";
export const GRAD_FROM = "00009C";
export const GRAD_TO = "3C32E1";
export const WHITE = "FFFFFF";
export const GRAY_50 = "F7F7FA";
export const GRAY_100 = "EEEEF3";
export const GRAY_200 = "E2E2EA";
export const GRAY_400 = "A6A6B6";
export const GRAY_500 = "7C7C8C";
export const GRAY_600 = "585866";
export const GRAY_800 = "26262F";
export const GRAY_900 = "14141A";
export const SUCCESS = "1F9D6B";
export const DANGER = "D63B3B";
// 폰트 수정(2026-09-09, 사용자 지시): "KT Flow"라는 단일 패밀리명은 시스템에 존재하지
// 않는다 — 설치된 건 "KT Flow Medium/Bold/Black/Thin" 네 개의 개별 패밀리뿐이다. 없는
// 이름을 fontFace로 넣으면 PowerPoint가 기본 폰트로 대체해 자간이 깨졌던 게 원인이었다.
// 굵기별로 실제 패밀리명을 직접 지정하고, 합성 볼드(bold:true)는 쓰지 않는다 — 진짜
// Bold/Black 패밀리 위에 합성 볼드를 덧씌우면 자간이 뭉개진다.
export const FONT_BLACK = "KT Flow Black"; // 제목·큰 숫자(16pt 이상)
export const FONT_BOLD = "KT Flow Bold"; // 소제목·표 헤더·강조 라벨
export const FONT_MEDIUM = "KT Flow Medium"; // 본문·축 라벨·캡션/각주
export const FONT_THIN = "KT Flow Thin"; // 작은 설명
/** @deprecated 굵기별 FONT_* 상수를 쓴다. 하위 호환을 위해서만 남겨둠. */
export const FONT = FONT_MEDIUM;

// ── 레이아웃 상수(slides/slide.css 그대로) ───────────────────────────────
export const BODY_X = px(96); // 본문 좌우 패딩 96px
export const BODY_W = px(1280 - 96 * 2);
const LOGO_H = px(40); // 모든 본문 슬라이드에서 동일한 로고 높이
const LOGO_TOP = px(44);
const LOGO_RIGHT = px(56);
const PAGENO_Y = px(720 - 36 - 18);
export const EYEBROW_Y = px(96);
export const TITLE_Y = px(138);
/** 제목 아래 본문이 시작되는 기준선 — 모든 슬라이드가 같은 높이에서 시작해 세트로 보인다. */
export const CONTENT_Y = px(232);

// ── 색 유틸 ──────────────────────────────────────────────────────────────
function clampHex(hex: string): string | null {
  const h = hex.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? h : null;
}
function mix(hex: string, target: [number, number, number], amount: number): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const m = (c: number, t: number) => Math.round(c + (t - c) * amount);
  return [m(r, target[0]), m(g, target[1]), m(b, target[2])]
    .map((v) => v.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}
/** 흰색과 섞어 옅은 배경 톤 (amount 1에 가까울수록 흼) */
export const tint = (hex: string, amount: number): string => mix(hex, [255, 255, 255], amount);
/** 검정과 섞어 깊은 톤 (표지 그라데이션 시작색 등) */
export const shade = (hex: string, amount: number): string => mix(hex, [0, 0, 0], amount);

/**
 * 이 리포트의 포인트 컬러. ENA 채널은 ena-design 공식 ENA Blue를 쓰고(사용자 결정
 * 2026-09-08), 나머지 채널은 channels.theme_color(로고색)를, 포트폴리오·미등록 채널은
 * ENA Blue로 폴백한다.
 */
export function resolveAccent(channelCode: string | null, themeColor: string | null | undefined): string {
  if (!channelCode || channelCode === "ENA") return ENA_BLUE;
  return clampHex(themeColor ?? "") ?? ENA_BLUE;
}

/**
 * 표지·마무리 슬라이드의 그라데이션. ENA는 소스 덱에서 추출한 공식 값(#00009C→#3C32E1)을
 * 그대로 쓰고, 다른 채널은 그 채널 색을 같은 방식(짙은 쪽 → 채널색)으로 변형해 쓴다 —
 * ENA 전용 그라데이션을 다른 채널에 그대로 붙이지 않기 위함.
 */
export function resolveGradient(accent: string): { from: string; to: string } {
  if (accent === ENA_BLUE) return { from: GRAD_FROM, to: GRAD_TO };
  return { from: shade(accent, 0.62), to: accent };
}

// ── 자산 로딩 ────────────────────────────────────────────────────────────
// ChannelLogo.tsx와 같은 규칙 — 세로형 로고가 있는 채널은 가로형(_H) 변형을 쓴다
// (우상단에 높이 고정으로 놓기 때문에 가로형이 훨씬 또렷하다).
const HORIZONTAL_LOGO_BY_CODE: Record<string, string> = {
  ENA_DRAMA: "ENA_DRAMA_H.png",
  ENA_PLAY: "ENA_PLAY_H.png",
  ENA_STORY: "ENA_STORY_H.png",
};

export interface PptImage {
  /** pptxgenjs addImage의 data 형식("image/png;base64,...") */
  data: string;
  /** 가로/세로 비율 — 높이를 고정하고 너비를 계산할 때 쓴다. */
  aspect: number;
}

/** PNG 헤더(IHDR)에서 픽셀 크기를 읽는다 — 이미지 라이브러리 없이 비율만 알면 된다. */
function pngAspect(buf: Buffer): number | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w > 0 && h > 0 ? w / h : null;
}

function loadPublicPng(...segments: string[]): PptImage | null {
  try {
    const buf = readFileSync(join(process.cwd(), "public", ...segments));
    const aspect = pngAspect(buf);
    if (!aspect) return null;
    return { data: `image/png;base64,${buf.toString("base64")}`, aspect };
  } catch {
    // 배포 환경에서 파일을 못 읽어도 PPT 생성 자체는 계속돼야 한다 — 로고만 빠지고
    // 호출부가 텍스트 워드마크로 대체한다(자산 없다고 다운로드가 실패하지 않게).
    return null;
  }
}

/** 본문 슬라이드 우상단에 쓸 채널 로고(없으면 null → 호출부가 채널명 텍스트로 대체) */
export function loadChannelLogo(channelCode: string | null): PptImage | null {
  if (!channelCode) return null;
  const file = HORIZONTAL_LOGO_BY_CODE[channelCode] ?? `${channelCode}.png`;
  return loadPublicPng("channel-logos", file);
}

/** 표지 슬로건 락업에 쓰는 흰색 ENA 워드마크(ena-design assets/ena-logo-white.png 사본) */
export function loadEnaWhiteLogo(): PptImage | null {
  return loadPublicPng("ena-design", "ena-logo-white.png");
}

/** ENA 시그니처 리본-웨이브 그래픽 — ena-design 규칙상 재색·재작도 금지라 ENA 덱에서만 쓴다. */
export function loadEnaRibbon(): PptImage | null {
  return loadPublicPng("ena-design", "ena-ribbon-line.png");
}

export interface EnaDeckTheme {
  accent: string;
  gradient: { from: string; to: string };
  channelCode: string | null;
  channelName: string;
  logo: PptImage | null;
  enaWhiteLogo: PptImage | null;
  ribbon: PptImage | null;
  /** ENA 채널 덱일 때만 true — 리본 그래픽 사용 여부를 가른다. */
  isEnaChannel: boolean;
}

export function createEnaTheme(opts: { channelCode: string | null; channelName: string; themeColor: string | null | undefined }): EnaDeckTheme {
  const accent = resolveAccent(opts.channelCode, opts.themeColor);
  const isEnaChannel = opts.channelCode === "ENA";
  return {
    accent,
    gradient: resolveGradient(accent),
    channelCode: opts.channelCode,
    channelName: opts.channelName,
    logo: loadChannelLogo(opts.channelCode),
    enaWhiteLogo: loadEnaWhiteLogo(),
    ribbon: isEnaChannel ? loadEnaRibbon() : null,
    isEnaChannel,
  };
}

// ── 슬라이드 구성 요소 ───────────────────────────────────────────────────

/** 마스터 이름 — 본문(흰 배경·로고·쪽번호)과 표지/마무리(그라데이션) 두 종류뿐이다. */
export const MASTER_CONTENT = "ENA_CONTENT";
export const MASTER_COVER = "ENA_COVER";

/**
 * 가로 그라데이션을 얇은 세로 띠로 나눠 만든다 — pptxgenjs에는 그라데이션 채우기가 없다.
 * 슬라이드가 아니라 마스터에 한 번만 깔기 때문에 띠 개수를 넉넉히 써도 파일이 커지지 않는다.
 */
function gradientSlices(from: string, to: string, slices = 64): { x: number; y: number; w: number; h: number; fill: { color: string }; line: { color: string; width: number } }[] {
  const toRgb: [number, number, number] = [parseInt(to.slice(0, 2), 16), parseInt(to.slice(2, 4), 16), parseInt(to.slice(4, 6), 16)];
  const w = SLIDE_W / slices;
  return Array.from({ length: slices }, (_, i) => {
    const color = mix(from, toRgb, slices === 1 ? 0 : i / (slices - 1));
    // 띠 사이에 흰 실선이 보이지 않도록 아주 살짝 겹쳐 그린다.
    return { x: i * w, y: 0, w: w + 0.01, h: SLIDE_H, fill: { color }, line: { color, width: 0 } };
  });
}

/**
 * 이 프레젠테이션의 두 마스터를 정의한다. **반드시 addSlide보다 먼저 부른다.**
 *
 * 마스터를 쓰는 이유(2026-09-08 실측): pptxgenjs는 슬라이드마다 addImage한 이미지를 매번
 * 새 미디어 파일로 넣는다 — 상세 리포트 29장에 로고를 직접 얹었더니 같은 31KB PNG가 29벌
 * 들어가 파일이 2.2MB까지 부풀었다. 로고·그라데이션·리본처럼 "매 슬라이드 같은 자리에 같은
 * 것"은 마스터에 한 번만 두면 미디어도 한 벌만 저장된다(ena-design의 "로고는 매 슬라이드
 * 같은 자리·같은 크기" 규칙과도 정확히 같은 개념).
 */
export function defineEnaMasters(pres: PptxGenJS, theme: EnaDeckTheme): void {
  // ① 표지·마무리(E.O.D) — 그라데이션 + ENA 덱에서만 리본-웨이브.
  const coverObjects: Record<string, unknown>[] = gradientSlices(theme.gradient.from, theme.gradient.to).map((rect) => ({ rect }));
  if (theme.ribbon) {
    const h = SLIDE_W / theme.ribbon.aspect;
    coverObjects.push({ image: { data: theme.ribbon.data, x: 0, y: SLIDE_H - h, w: SLIDE_W, h } });
  }
  pres.defineSlideMaster({
    title: MASTER_COVER,
    background: { color: theme.gradient.from },
    objects: coverObjects as never,
  });

  // ② 본문 — 흰 배경 + 우상단 로고(모든 슬라이드 동일 크기) + 우하단 쪽번호(자동 채번).
  const contentObjects: Record<string, unknown>[] = [];
  if (theme.logo) {
    const w = LOGO_H * theme.logo.aspect;
    contentObjects.push({ image: { data: theme.logo.data, x: SLIDE_W - LOGO_RIGHT - w, y: LOGO_TOP, w, h: LOGO_H } });
  } else {
    // 로고 파일을 못 읽은 경우에도 브랜딩이 비지 않도록 채널명 워드마크로 대체.
    contentObjects.push({
      text: {
        text: theme.channelName,
        options: { x: SLIDE_W - LOGO_RIGHT - 2, y: LOGO_TOP, w: 2, h: LOGO_H, fontFace: FONT_BLACK, fontSize: ptSize(24), color: theme.accent, align: "right", valign: "middle" },
      },
    });
  }
  pres.defineSlideMaster({
    title: MASTER_CONTENT,
    background: { color: WHITE },
    objects: contentObjects as never,
    slideNumber: { x: SLIDE_W - LOGO_RIGHT - 1, y: PAGENO_Y, w: 1, h: px(18), align: "right", fontFace: FONT_BOLD, fontSize: ptSize(14), color: GRAY_500 },
  });
}

/** 본문 슬라이드 한 장 — 마스터가 배경·로고·쪽번호를 이미 갖고 있어 여기선 내용만 얹는다. */
export function addContentSlide(pres: PptxGenJS, theme: EnaDeckTheme, eyebrow: string, actionTitle: string, opts?: { titlePx?: number }): PptSlide {
  const s = pres.addSlide({ masterName: MASTER_CONTENT });
  addEyebrow(s, eyebrow, theme);
  addActionTitle(s, actionTitle, TITLE_Y, opts?.titlePx);
  return s;
}

/** 눈썹 라벨 — 30×4px 액센트 틱 바 + 대문자 볼드 텍스트(ena-design .eyebrow). */
export function addEyebrow(slide: PptSlide, text: string, theme: EnaDeckTheme, y: number = EYEBROW_Y): void {
  slide.addShape("roundRect", { x: BODY_X, y: y + px(8), w: px(30), h: px(4), fill: { color: theme.accent }, rectRadius: px(2), line: { color: theme.accent, width: 0 } });
  slide.addText(text, {
    x: BODY_X + px(42),
    y,
    w: BODY_W - px(42),
    h: px(24),
    fontFace: FONT_BOLD,
    fontSize: ptSize(18),
    color: theme.accent,
    charSpacing: 0.8,
    valign: "middle",
  });
}

/** Action Title — 검정에 가까운 큰 제목(ena-design .slide-title, 굵기 대비가 이 시스템의 서명). */
export function addActionTitle(slide: PptSlide, text: string, y: number = TITLE_Y, sizePx = 44): void {
  slide.addText(text, {
    x: BODY_X,
    y,
    w: BODY_W,
    h: px(72),
    fontFace: FONT_BLACK,
    fontSize: ptSize(sizePx),
    color: GRAY_900,
    lineSpacingMultiple: 1.08,
    valign: "top",
  });
}

/** 부제/설명 한 줄(ena-design .slide-sub) */
export function addSubtitle(slide: PptSlide, text: string, y: number): void {
  if (!text) return;
  slide.addText(text, {
    x: BODY_X,
    y,
    w: BODY_W,
    h: px(30),
    fontFace: FONT_BOLD,
    fontSize: ptSize(20),
    color: GRAY_600,
    valign: "top",
  });
}

/** 개조식 불릿 — 본문은 짧게, 부연은 작은 글씨로(사용자 지시 2026-09-01 유지). */
export function addBullets(
  slide: PptSlide,
  items: string[],
  opts: { x: number; y: number; w: number; h: number; note?: string; sizePx?: number }
): void {
  const size = opts.sizePx ?? 21;
  if (items.length === 0 && !opts.note) {
    slide.addText("표시할 신호가 없습니다.", {
      x: opts.x, y: opts.y, w: opts.w, h: opts.h,
      fontFace: FONT_MEDIUM, fontSize: ptSize(18), italic: true, color: GRAY_400,
    });
    return;
  }
  const runs = items.map((t) => ({
    text: t,
    options: { bullet: { characterCode: "2022" }, fontSize: ptSize(size), color: GRAY_800, breakLine: true, fontFace: FONT_MEDIUM },
  }));
  if (opts.note) {
    runs.push({
      text: opts.note,
      options: { bullet: { characterCode: "2022" }, fontSize: ptSize(15), color: GRAY_500, breakLine: true, fontFace: FONT_THIN },
    });
  }
  slide.addText(runs, { x: opts.x, y: opts.y, w: opts.w, h: opts.h, valign: "top", lineSpacingMultiple: 1.35 });
}

/** So What? 강조 바 — 액센트 틱 + 옅은 액센트 배경(ena-design "brand" 카드 톤). */
export function addSoWhat(slide: PptSlide, text: string, y: number, theme: EnaDeckTheme): void {
  if (!text) return;
  const h = px(64);
  slide.addShape("roundRect", {
    x: BODY_X, y, w: BODY_W, h,
    fill: { color: tint(theme.accent, 0.92) },
    rectRadius: px(12),
    line: { color: tint(theme.accent, 0.78), width: 0.75 },
  });
  slide.addShape("roundRect", { x: BODY_X, y: y + px(10), w: px(4), h: h - px(20), fill: { color: theme.accent }, rectRadius: px(2), line: { color: theme.accent, width: 0 } });
  slide.addText(
    [
      { text: "So What?   ", options: { color: theme.accent, fontFace: FONT_BOLD } },
      { text, options: { color: GRAY_800, fontFace: FONT_MEDIUM } },
    ],
    { x: BODY_X + px(22), y, w: BODY_W - px(40), h, fontSize: ptSize(19), valign: "middle" }
  );
}

export interface EnaKpiCard {
  label: string;
  value: string;
  delta?: string;
  dir?: "up" | "down" | "flat";
}

/**
 * KPI 카드 행(ena-design 04-kpi 슬라이드). 첫 카드는 액센트로 채운 "brand" 카드 —
 * 이 시스템의 시그니처 대비를 만든다.
 */
export function addKpiCards(slide: PptSlide, cards: EnaKpiCard[], theme: EnaDeckTheme, y: number, opts?: { maxPerRow?: number }): number {
  if (cards.length === 0) return y;
  const perRow = Math.min(opts?.maxPerRow ?? 3, cards.length);
  const gap = px(24);
  const cardW = (BODY_W - gap * (perRow - 1)) / perRow;
  const cardH = px(150);
  cards.slice(0, perRow).forEach((card, i) => {
    const x = BODY_X + i * (cardW + gap);
    const isBrand = i === 0;
    slide.addShape("roundRect", {
      x, y, w: cardW, h: cardH,
      fill: { color: isBrand ? theme.accent : WHITE },
      line: { color: isBrand ? theme.accent : GRAY_200, width: 1 },
      rectRadius: px(16),
    });
    slide.addText(card.label, {
      x: x + px(24), y: y + px(20), w: cardW - px(48), h: px(24),
      fontFace: FONT_BOLD, fontSize: ptSize(16),
      color: isBrand ? tint(theme.accent, 0.82) : GRAY_600,
      valign: "middle",
    });
    slide.addText(card.value, {
      x: x + px(24), y: y + px(46), w: cardW - px(48), h: px(60),
      fontFace: FONT_BLACK, fontSize: ptSize(52),
      color: isBrand ? WHITE : theme.accent,
      valign: "middle",
    });
    if (card.delta) {
      const deltaColor = isBrand ? tint(theme.accent, 0.75) : card.dir === "up" ? SUCCESS : card.dir === "down" ? DANGER : GRAY_500;
      slide.addText(card.delta, {
        x: x + px(24), y: y + px(108), w: cardW - px(48), h: px(24),
        fontFace: FONT_BOLD, fontSize: ptSize(15), color: deltaColor, valign: "middle",
      });
    }
  });
  return y + cardH;
}

/** 차트/표 위에 붙는 작은 캡션 — 무엇을 보고 있는지 한 줄로. */
export function addCaption(slide: PptSlide, text: string, y: number, opts?: { align?: "left" | "center" }): void {
  if (!text) return;
  slide.addText(text, {
    x: BODY_X, y, w: BODY_W, h: px(24),
    fontFace: FONT_MEDIUM, fontSize: ptSize(15), color: GRAY_500,
    align: opts?.align ?? "left", valign: "middle",
  });
}

/** 표 스타일 — 머리행은 옅은 회색 채움, 실선은 헤어라인(ena-design 카드/보더 규칙). */
export function enaTableOptions(): {
  border: { type: "solid"; color: string; pt: number };
  fontFace: string;
  fontSize: number;
  color: string;
  valign: "middle";
  autoPage: false;
} {
  return {
    border: { type: "solid", color: GRAY_200, pt: 0.75 },
    fontFace: FONT_MEDIUM,
    fontSize: ptSize(16),
    color: GRAY_800,
    valign: "middle",
    autoPage: false,
  };
}

export function enaTableHeaderCell(text: string): { text: string; options: Record<string, unknown> } {
  return { text, options: { fill: { color: GRAY_50 }, color: GRAY_900, fontFace: FONT_BOLD } };
}

/**
 * 표지 슬라이드 — 그라데이션(마스터) + "매일 새로운 ENA" 슬로건 락업 + 큰 제목.
 * (ena-design 01-cover의 구성을 그대로 따르되, 채널 식별은 눈썹 줄에서 한다.)
 */
export function addCoverSlide(
  pres: PptxGenJS,
  theme: EnaDeckTheme,
  content: { eyebrow: string; title: string; subtitle: string; dateLabel: string; author: string }
): void {
  const s = pres.addSlide({ masterName: MASTER_COVER });

  // 슬로건 락업: "매일 새로운" + 흰색 ENA 워드마크
  const sloganY = px(104);
  s.addText("매일 새로운", {
    x: px(73), y: sloganY, w: px(200), h: px(34),
    fontFace: FONT_BLACK, fontSize: ptSize(24), color: WHITE, valign: "middle",
  });
  if (theme.enaWhiteLogo) {
    const h = px(30);
    s.addImage({ data: theme.enaWhiteLogo.data, x: px(73 + 138), y: sloganY + px(2), w: h * theme.enaWhiteLogo.aspect, h });
  } else {
    s.addText("ENA", {
      x: px(73 + 138), y: sloganY, w: px(120), h: px(34),
      fontFace: FONT_BLACK, fontSize: ptSize(26), color: WHITE, valign: "middle",
    });
  }

  if (content.eyebrow) {
    s.addText(content.eyebrow, {
      x: px(73), y: px(178), w: BODY_W, h: px(26),
      fontFace: FONT_BOLD, fontSize: ptSize(18), color: WHITE, charSpacing: 1.2, transparency: 25, valign: "middle",
    });
  }
  s.addText(content.title, {
    x: px(73), y: px(214), w: px(900), h: px(150),
    fontFace: FONT_BLACK, fontSize: ptSize(54), color: WHITE, lineSpacingMultiple: 1.12, valign: "top",
  });
  s.addShape("rect", { x: px(73), y: px(392), w: px(120), h: px(4), fill: { color: WHITE }, line: { color: WHITE, width: 0 } });
  if (content.subtitle) {
    s.addText(content.subtitle, {
      x: px(73), y: px(414), w: px(900), h: px(34),
      fontFace: FONT_BOLD, fontSize: ptSize(21), color: WHITE, transparency: 18, valign: "top",
    });
  }
  s.addText(`${content.dateLabel}    ·    ${content.author}`, {
    x: px(73), y: px(590), w: px(900), h: px(28),
    fontFace: FONT_MEDIUM, fontSize: ptSize(16), color: WHITE, transparency: 30, valign: "middle",
  });
}

/** 마무리(E.O.D) 슬라이드 — 그라데이션 + 슬로건. ena-design 06-eod와 같은 성격. */
export function addEodSlide(pres: PptxGenJS, theme: EnaDeckTheme): void {
  const s = pres.addSlide({ masterName: MASTER_COVER });
  s.addText("E.O.D", {
    x: 0, y: px(292), w: SLIDE_W, h: px(70),
    fontFace: FONT_BLACK, fontSize: ptSize(46), color: WHITE, charSpacing: 4, align: "center", valign: "middle",
  });
  s.addText("매일 새로운 ENA", {
    x: 0, y: px(368), w: SLIDE_W, h: px(34),
    fontFace: FONT_BOLD, fontSize: ptSize(20), color: WHITE, transparency: 25, align: "center", valign: "middle",
  });
}

/** 값이 없을 때 쓰는 공통 안내 — 빈 차트를 억지로 그리지 않는다는 원칙을 시각적으로도 통일. */
export function addEmptyState(slide: PptSlide, text: string, opts: { x: number; y: number; w: number; h: number }): void {
  slide.addShape("roundRect", { ...opts, fill: { color: GRAY_50 }, line: { color: GRAY_200, width: 0.75 }, rectRadius: px(12) });
  slide.addText(text, {
    ...opts,
    fontFace: FONT_MEDIUM, fontSize: ptSize(17), color: GRAY_400, align: "center", valign: "middle",
  });
}

/** 차트 공통 옵션 — 축·눈금 색을 ENA 뉴트럴로 맞춰 어느 슬라이드에 놓아도 같은 인상. */
export function enaChartBase(): Record<string, unknown> {
  return {
    showLegend: false,
    showTitle: false,
    chartArea: { fill: { color: WHITE } },
    plotArea: { fill: { color: WHITE } },
    catAxisLabelFontFace: FONT_MEDIUM,
    valAxisLabelFontFace: FONT_MEDIUM,
    catAxisLabelFontSize: ptSize(14),
    valAxisLabelFontSize: ptSize(14),
    catAxisLabelColor: GRAY_600,
    valAxisLabelColor: GRAY_600,
    catAxisLineColor: GRAY_200,
    valAxisLineColor: GRAY_200,
    valGridLine: { color: GRAY_100, style: "solid", size: 0.75 },
    showValAxisTitle: false,
    showCatAxisTitle: false,
  };
}
