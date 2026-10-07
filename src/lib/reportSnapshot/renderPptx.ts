// DeckPlan → PowerPoint(.pptx) (단계 14). 슬라이드 구성은 deckPlan.ts가 정하고 여기는 ENA 디자인 시스템(enaPptTheme.ts)으로 그리기만 한다.
//
// 차트는 PowerPoint 기본 차트(편집 가능)로 넣고, 값이 없는 범주는 0으로 그리지 않고 빼서 캡션에 밝힌다.
// 모든 장 아래에는 스냅샷 ID·분석일·생성 시각을 작게 적어 어느 보고서의 장인지 알 수 있게 한다.
import PptxGenJS from "pptxgenjs";
import type { DocBlock } from "@/lib/audienceReport/reportFlatten";
import * as ena from "@/lib/audienceReport/enaPptTheme";
import type { DeckPlan, DeckSlide } from "./deckPlan";
import { chartSeries, columnShares, isNumericText, metaCaption, metaFlags, displayWidth } from "./renderCommon";

type PptSlide = ReturnType<PptxGenJS["addSlide"]>;

/** 본문 영역(인치): 제목 아래 CONTENT_Y부터 하단 바닥글 위까지 */
const TOP = ena.CONTENT_Y;
const BOTTOM = 5.02;
const FOOTER_Y = 5.2;

function titlePxFor(title: string): number {
  const n = [...title].length;
  return n <= 22 ? 38 : n <= 44 ? 30 : n <= 64 ? 26 : 22;
}

/** 글자 수 기반 줄 수 추정(한글 1em, 영숫자 0.55em) — 같은 폭의 상자에서 몇 줄이 되는지 */
function estLines(text: string, widthIn: number, pt: number): number {
  const em = (pt / 72) || 0.1;
  const capacity = Math.max(1, widthIn / em);
  const units = displayWidth(text) / 2; // 한글 1 = 2칸 → em 수
  return Math.max(1, Math.ceil(units / capacity));
}

interface Placed {
  h: number;
  draw: (y: number) => void;
}

function planText(s: PptSlide, b: Extract<DocBlock, { kind: "text" }>, pt: number): Placed {
  const lines = estLines(b.text, ena.BODY_W, pt);
  const h = lines * pt * 1.4 / 72 + 0.08;
  return {
    h,
    draw: (y) => s.addText(b.text, { x: ena.BODY_X, y, w: ena.BODY_W, h, fontFace: ena.FONT_MEDIUM, fontSize: pt, color: ena.GRAY_800, lineSpacingMultiple: 1.3, valign: "top" }),
  };
}

function planBullets(s: PptSlide, b: Extract<DocBlock, { kind: "bullets" }>, pt: number): Placed {
  const w = ena.BODY_W - 0.2;
  const lines = b.items.reduce((n, t) => n + estLines(t, w, pt), 0);
  const h = lines * pt * 1.4 / 72 + b.items.length * 0.05 + 0.06;
  return {
    h,
    draw: (y) =>
      s.addText(
        b.items.map((t) => ({ text: t, options: { bullet: { characterCode: "2022" }, fontSize: pt, color: ena.GRAY_800, breakLine: true, fontFace: ena.FONT_MEDIUM, paraSpaceAfter: 3 } })),
        { x: ena.BODY_X, y, w: ena.BODY_W, h, valign: "top", lineSpacingMultiple: 1.25 }
      ),
  };
}

function captionLines(meta: Parameters<typeof metaCaption>[0]): { flags: string[]; cap: string } {
  return { flags: metaFlags(meta), cap: metaCaption(meta) };
}

function drawCaption(s: PptSlide, y: number, meta: Parameters<typeof metaCaption>[0]): number {
  const { flags, cap } = captionLines(meta);
  let yy = y;
  for (const f of flags) {
    s.addText(f, { x: ena.BODY_X, y: yy, w: ena.BODY_W, h: 0.2, fontFace: ena.FONT_BOLD, fontSize: 8.5, color: "92400E", valign: "top" });
    yy += 0.2;
  }
  if (cap) {
    const lines = estLines(cap, ena.BODY_W, 7.5);
    const h = lines * 7.5 * 1.35 / 72 + 0.04;
    s.addText(cap, { x: ena.BODY_X, y: yy, w: ena.BODY_W, h, fontFace: ena.FONT_MEDIUM, fontSize: 7.5, color: ena.GRAY_500, valign: "top" });
    yy += h;
  }
  return yy - y;
}

function captionHeight(meta: Parameters<typeof metaCaption>[0]): number {
  const { flags, cap } = captionLines(meta);
  return flags.length * 0.2 + (cap ? estLines(cap, ena.BODY_W, 7.5) * 7.5 * 1.35 / 72 + 0.04 : 0);
}

function planTable(s: PptSlide, b: Extract<DocBlock, { kind: "table" }>, maxPt: number): Placed {
  const shares = columnShares(b.headers, b.rows, { min: 12, max: 40 });
  const colW = shares.map((x) => x * ena.BODY_W);
  const fontPt = Math.min(maxPt, b.headers.length >= 6 || b.rows.length > 7 ? 8 : 9);
  const cellLines = (text: string, i: number) => estLines(text, Math.max(0.3, colW[i] - 0.2), fontPt);
  const rowHeights = [b.headers.map((h, i) => cellLines(h, i)), ...b.rows.map((r) => b.headers.map((_, i) => cellLines(r[i] ?? "—", i)))].map((ls) => Math.max(...ls) * fontPt * 1.5 / 72 + (fontPt >= 9 ? 0.14 : 0.11));
  const h = rowHeights.reduce((a, c) => a + c, 0);
  return {
    h: h + captionHeight(b.meta),
    draw: (y) => {
      const header = b.headers.map((x) => ena.enaTableHeaderCell(x));
      const body = b.rows.map((r) => b.headers.map((_, i) => ({ text: r[i] ?? "—", options: { color: ena.GRAY_800, fontFace: ena.FONT_MEDIUM, align: isNumericText(r[i] ?? "") ? ("right" as const) : ("left" as const) } })));
      s.addTable([header, ...body] as never, {
        x: ena.BODY_X,
        y,
        w: ena.BODY_W,
        colW,
        rowH: rowHeights,
        ...ena.enaTableOptions(),
        fontSize: fontPt,
        margin: [0.03, 0.06, 0.03, 0.06],
      });
      drawCaption(s, y + h + 0.03, b.meta);
    },
  };
}

function planKpi(s: PptSlide, b: Extract<DocBlock, { kind: "kpi" }>, theme: ena.EnaDeckTheme): Placed {
  const rows = Math.ceil(Math.min(b.items.length, 6) / 3);
  const h = rows * ena.px(150) + (rows - 1) * ena.px(24);
  return {
    h: h + captionHeight(b.meta),
    draw: (y) => {
      const cards = b.items.slice(0, 6).map((k) => ({ label: k.label, value: k.value, delta: k.delta ?? undefined, dir: k.dir }));
      const after = ena.addKpiCards(s, cards.slice(0, 3), theme, y);
      let bottom = after;
      if (cards.length > 3) bottom = ena.addKpiCards(s, cards.slice(3, 6), theme, after + ena.px(24), { maxPerRow: 3 });
      drawCaption(s, bottom + 0.04, b.meta);
    },
  };
}

function drawChart(pres: PptxGenJS, s: PptSlide, b: Extract<DocBlock, { kind: "chart" }>, theme: ena.EnaDeckTheme, x: number, y: number, w: number, h: number): void {
  const series = chartSeries(b);
  s.addText(b.title, { x, y, w, h: 0.24, fontFace: ena.FONT_BOLD, fontSize: 10, color: ena.GRAY_900, valign: "middle" });
  if (series.categories.length === 0) {
    ena.addEmptyState(s, "그릴 값이 없음", { x, y: y + 0.28, w, h: Math.max(0.4, h - 0.7) });
    return;
  }
  const fmt = b.decimals > 0 ? `0.${"0".repeat(b.decimals)}` : "0";
  const hasNeg = series.values.some((v) => v < 0);
  const opts: Record<string, unknown> = {
    ...ena.enaChartBase(),
    x,
    y: y + 0.26,
    w,
    h: h - 0.26 - 0.4,
    barDir: "col",
    barGapWidthPct: 60,
    chartColors: [theme.accent],
    showValue: true,
    dataLabelFontFace: ena.FONT_MEDIUM,
    dataLabelFontSize: 8,
    dataLabelColor: ena.GRAY_800,
    dataLabelFormatCode: fmt,
    valAxisLabelFormatCode: fmt,
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 8,
    ...(hasNeg ? { invertedColors: [ena.DANGER] } : {}),
  };
  s.addChart("bar", [{ name: b.title, labels: series.categories, values: series.values }], opts as never);
  const note = series.missing.length > 0 ? `※ 값 없음(그리지 않음): ${series.missing.join(", ")}` : "";
  const cap = [note, metaCaption(b.meta)].filter(Boolean).join("  ");
  if (cap) s.addText(cap, { x, y: y + h - 0.38, w, h: 0.38, fontFace: ena.FONT_MEDIUM, fontSize: 7, color: ena.GRAY_500, valign: "top" });
}

function renderContent(pres: PptxGenJS, theme: ena.EnaDeckTheme, slide: Extract<DeckSlide, { kind: "content" }>): void {
  const s = ena.addContentSlide(pres, theme, slide.appendix ? `${slide.eyebrow} · 부록` : slide.eyebrow, slide.title, { titlePx: titlePxFor(slide.title) });
  if (slide.caption) ena.addCaption(s, slide.caption, ena.CONTENT_Y - ena.px(30));

  // 차트 한두 개는 윗줄에 나란히 그리고, 나머지 블록은 그 아래에 쌓는다. 나머지 높이를 먼저 재서 차트 높이를 정한다.
  const charts = slide.blocks.filter((bl): bl is Extract<DocBlock, { kind: "chart" }> => bl.kind === "chart");
  const rest = slide.blocks.filter((bl) => bl.kind !== "chart");
  const avail = BOTTOM - TOP;
  // 내용이 들어갈 때까지 글자·표 크기를 한 단계씩 줄인다(차트가 있으면 차트 최소 높이를 남긴다).
  const GAP = 0.14;
  const baseText = rest.length > 1 || charts.length > 0 ? 9.5 : 11;
  const tiers = [
    { text: baseText, table: 9 },
    { text: Math.min(baseText, 9), table: 8 },
    { text: 8.5, table: 7.5 },
    { text: 8, table: 7 },
  ];
  const planRest = (t: { text: number; table: number }): Placed[] =>
    rest.map((bl): Placed => {
      switch (bl.kind) {
        case "text":
          return planText(s, bl, t.text);
        case "bullets":
          return planBullets(s, bl, t.text);
        case "table":
          return planTable(s, bl, t.table);
        case "kpi":
          return planKpi(s, bl, theme);
        default:
          return { h: 0, draw: () => undefined };
      }
    });
  const reserve = charts.length > 0 ? 1.5 + 0.08 : 0;
  let placed = planRest(tiers[0]);
  for (const t of tiers) {
    placed = planRest(t);
    if (placed.reduce((a2, pl) => a2 + pl.h + GAP, 0) + reserve <= avail) break;
  }
  const restH = placed.reduce((a2, p) => a2 + p.h + GAP, 0);
  let y = TOP;
  if (charts.length > 0) {
    const chartH = rest.length > 0 ? Math.max(1.5, Math.min(2.2, avail - restH - 0.08)) : avail - 0.05;
    const gap = 0.2;
    const w = charts.length === 1 ? ena.BODY_W : (ena.BODY_W - gap) / 2;
    charts.slice(0, 2).forEach((c, i) => drawChart(pres, s, c, theme, ena.BODY_X + i * (w + gap), y, w, chartH));
    y += chartH + 0.08;
  }
  for (const p of placed) {
    p.draw(y);
    y += p.h + GAP;
  }
  s.addText(slide.footer, { x: ena.BODY_X, y: FOOTER_Y, w: ena.BODY_W - 1.2, h: 0.2, fontFace: ena.FONT_MEDIUM, fontSize: 7, color: ena.GRAY_400, valign: "middle" });
}

export async function renderDeckPptx(plan: DeckPlan): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  pres.title = plan.title;
  pres.author = "KT ENA 편성 AI Agent";
  pres.subject = `ReportSnapshot ${plan.meta.id}`;
  const theme = ena.createEnaTheme({ channelCode: plan.brand.channelCode, channelName: plan.brand.channelName, themeColor: plan.brand.themeColor });
  ena.defineEnaMasters(pres, theme);

  for (const slide of plan.slides) {
    if (slide.kind === "cover") {
      ena.addCoverSlide(pres, theme, { eyebrow: slide.eyebrow, title: slide.title, subtitle: slide.subtitle, dateLabel: slide.dateLabel, author: slide.author });
    } else if (slide.kind === "divider") {
      const s = pres.addSlide({ masterName: ena.MASTER_COVER });
      s.addText(slide.eyebrow, { x: ena.px(73), y: ena.px(260), w: ena.BODY_W, h: ena.px(26), fontFace: ena.FONT_BOLD, fontSize: ena.ptSize(18), color: ena.WHITE, transparency: 25 });
      s.addText(slide.title, { x: ena.px(73), y: ena.px(296), w: ena.BODY_W, h: ena.px(90), fontFace: ena.FONT_BLACK, fontSize: ena.ptSize(60), color: ena.WHITE });
      s.addText(slide.subtitle, { x: ena.px(73), y: ena.px(396), w: ena.BODY_W, h: ena.px(34), fontFace: ena.FONT_BOLD, fontSize: ena.ptSize(20), color: ena.WHITE, transparency: 20 });
    } else if (slide.kind === "eod") {
      ena.addEodSlide(pres, theme);
    } else {
      renderContent(pres, theme, slide);
    }
  }
  return (await pres.write({ outputType: "nodebuffer" })) as Buffer;
}

