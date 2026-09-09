// N절 Phase 2a(2026-09-01) — FlatReport(reportFlatten.ts) → Word(.docx) / PPT(.pptx) 렌더러.
// 두 렌더러 모두 "블록을 그리는 법"만 안다 — 어떤 섹션에 어떤 값을 넣을지는 reportFlatten.ts
// 한 곳에서만 정한다(구 시스템은 이 결정이 docx/pptx에 각각 하드코딩돼 있어 조용히 갈라졌다).
// Word(.docx)의 색·여백은 구 시스템(/api/report/channel/docx)의 스타일을 그대로 승계한다.
// PPT(.pptx)는 사용자 지시(2026-09-08)로 ENA 디자인 시스템(enaPptTheme.ts)으로 전면 교체됐다 —
// 이 파일의 PPT 쪽은 색·여백·타이포를 직접 정하지 않고 그 테마 함수만 조합한다.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";
import PptxGenJS from "pptxgenjs";
import type { FlatReport, DocBlock } from "./reportFlatten";
import type { ExecutiveDeckDocument } from "./deckModel";
// ENA 디자인 시스템(ena-design 스킬) 규칙 모음 — PPT의 색·여백·타이포·로고·표지는 전부 여기서만 온다.
import * as ena from "./enaPptTheme";

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 2, color: "E4E4E7" };

function deltaColor(dir: "up" | "down" | "flat"): string | undefined {
  return dir === "up" ? "059669" : dir === "down" ? "E11D48" : undefined;
}

// ---------------- Word ----------------
function docxCell(text: string, opts?: { bold?: boolean; color?: string }): TableCell {
  return new TableCell({
    borders: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts?.bold, color: opts?.color, size: 18 })] })],
  });
}

function docxBlock(b: DocBlock): (Paragraph | Table)[] {
  switch (b.kind) {
    case "text":
      return [new Paragraph({ text: b.text, spacing: { after: 160 } })];
    case "note":
      return [new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `데이터 없음 — ${b.text}`, italics: true, color: "A1A1AA", size: 18 })] })];
    case "bullets":
      return b.items.map((t) => new Paragraph({ text: t, bullet: { level: 0 }, spacing: { after: 60 } }));
    case "kpi":
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: b.items.map((k) => docxCell(k.label, { bold: true })) }),
            new TableRow({ children: b.items.map((k) => docxCell(`${k.value}${k.delta ? ` (${k.delta})` : ""}`, { color: deltaColor(k.dir) })) }),
          ],
        }),
        new Paragraph({ text: "", spacing: { after: 160 } }),
      ];
    case "table": {
      if (b.rows.length === 0) return [new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: "표시할 행이 없습니다.", italics: true, color: "A1A1AA", size: 18 })] })];
      // Word 표는 행이 너무 많으면 문서가 비대해진다 — 화면과 달리 스크롤이 없으므로 40행에서 끊고 남은 수를 밝힌다.
      const shown = b.rows.slice(0, 40);
      const out: (Paragraph | Table)[] = [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: b.headers.map((h) => docxCell(h, { bold: true })) }), ...shown.map((r) => new TableRow({ children: r.map((c) => docxCell(c)) }))],
        }),
      ];
      if (b.rows.length > shown.length) {
        out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `(전체 ${b.rows.length}행 중 ${shown.length}행만 표시)`, italics: true, color: "A1A1AA", size: 16 })] }));
      } else {
        out.push(new Paragraph({ text: "", spacing: { after: 160 } }));
      }
      return out;
    }
  }
}

export async function renderReportDocx(flat: FlatReport): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: flat.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: flat.subtitle, spacing: { after: 300 } }),
  ];
  for (const section of flat.sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } }));
    for (const block of section.blocks) children.push(...docxBlock(block));
  }
  children.push(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "KT ENA 편성 AI Agent", italics: true, size: 16, color: "A1A1AA" })] }));
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

// ---------------- PPT ----------------
// 사용자 지시(2026-09-08): "2페이지 각 채널에서 PPT를 만들면 ena-design 스킬과 제작 방식을
// 활용해서 PPT를 만들도록" — 아래 두 렌더러(문서형·임원 보고용)는 모두 enaPptTheme.ts의
// ENA 디자인 시스템 위에서만 그린다. 색·여백·타이포를 여기서 직접 정하지 않는다.
/** 한 슬라이드에 넣을 수 있는 표 행 수 — 넘으면 같은 제목으로 슬라이드를 이어서 만든다. */
const PPT_ROWS_PER_SLIDE = 11;

type PptSlide = ReturnType<PptxGenJS["addSlide"]>;

/** 오늘 날짜(KST) — 표지 발행일. 이 프로젝트 관례대로 toISOString을 쓰지 않고 로컬 값으로 조립. */
function todayLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export async function renderReportPptx(flat: FlatReport): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  const theme = ena.createEnaTheme({
    channelCode: flat.brand.channelCode,
    channelName: flat.brand.channelName,
    themeColor: flat.brand.themeColor,
  });
  // 로고·그라데이션을 마스터에 한 번만 심는다(슬라이드마다 넣으면 같은 이미지가 슬라이드 수만큼
  // 중복 저장돼 파일이 몇 배로 커진다 — 2026-09-08 실측).
  ena.defineEnaMasters(pres, theme);

  ena.addCoverSlide(pres, theme, {
    eyebrow: flat.brand.channelName.toUpperCase(),
    title: flat.title.replace(/\s—\s.*$/, ""),
    subtitle: flat.subtitle,
    dateLabel: todayLabel(),
    author: "KT ENA 편성 AI Agent",
  });

  const startContentSlide = (title: string): PptSlide =>
    ena.addContentSlide(pres, theme, flat.brand.channelName.toUpperCase(), title, { titlePx: 38 });

  for (const section of flat.sections) {
    // 한 섹션이 여러 블록이면 블록마다 슬라이드를 나눠 글자가 겹치지 않게 한다.
    for (const block of section.blocks) {
      if (block.kind === "table" && block.rows.length > PPT_ROWS_PER_SLIDE) {
        for (let i = 0; i < block.rows.length; i += PPT_ROWS_PER_SLIDE) {
          const chunk = block.rows.slice(i, i + PPT_ROWS_PER_SLIDE);
          const part = Math.floor(i / PPT_ROWS_PER_SLIDE) + 1;
          const total = Math.ceil(block.rows.length / PPT_ROWS_PER_SLIDE);
          const s = startContentSlide(section.title);
          ena.addCaption(s, `${part} / ${total}  ·  전체 ${block.rows.length}행`, ena.CONTENT_Y - ena.px(30));
          addPptTable(s, block.headers, chunk);
        }
        continue;
      }
      const s = startContentSlide(section.title);
      renderPptBlock(s, block, theme);
    }
  }

  ena.addEodSlide(pres, theme);
  // pptxgenjs의 write()는 환경에 따라 string|Buffer|Blob을 반환한다 — Node 런타임에서는 nodebuffer로 강제한다.
  return (await pres.write({ outputType: "nodebuffer" })) as Buffer;
}

function addPptTable(s: PptSlide, headers: string[], rows: string[][]) {
  const header = headers.map((h) => ena.enaTableHeaderCell(h));
  const body = rows.map((r) => r.map((c) => ({ text: c, options: { color: ena.GRAY_800, fontFace: ena.FONT_MEDIUM } })));
  s.addTable([header, ...body], { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, ...ena.enaTableOptions() });
}


// Phase 13(2026-09-01) — "임원 보고용 PPT"(deckModel.ts) 전용 렌더러. FlatReport 기반
// renderReportPptx와는 목적이 다르다(그건 상세 리포트 전체를 표로 옮기는 것, 이건 요약
// 슬라이드) — 그래서 별도 함수로 둔다. 5대 작성 원칙(Action Title 큰 제목, 개조식 bullet,
// So What 강조 바)을 슬라이드 레이아웃 자체로 강제한다.
//
// Phase 14(2026-09-01, 사용자 재지시 — "그래프나 인포그래픽도 다 빠져있음") — chartNote
// 텍스트 박스(플레이스홀더) 대신 pptxgenjs 네이티브 차트(addChart, bar/line)를 실제로 그린다.
// 화면(deck/page.tsx의 SVG)과 여기(PPT 네이티브 차트) 둘 다 deckModel.ts의 DeckChartData
// 하나에서만 값을 가져온다(reportFlatten.ts와 같은 "내용 결정은 한 곳" 원칙).
//
// 사용자 지시(2026-09-08, ena-design 스킬 적용) — 색·여백·타이포·표지/마무리 슬라이드를
// 전부 enaPptTheme.ts로 옮겼다. 여기 남은 것은 "어느 슬라이드에 무엇을 놓을지"뿐이다.
// 상승/하락처럼 방향 자체가 정보인 색만 의미 색(SUCCESS/DANGER)을 그대로 쓴다.
const DECK_UP = ena.SUCCESS;
const DECK_DOWN = ena.DANGER;

type DeckPoint = { label: string; value: number | null };

/** 값이 있는 포인트가 없으면 "데이터 부족" 안내만 — 억지로 빈 차트를 그리지 않는다. */
function addDeckBarChart(
  pres: PptxGenJS,
  s: PptSlide,
  points: DeckPoint[],
  opts: { x: number; y: number; w: number; h: number; diverging?: boolean; rotateLabels?: boolean; accent: string }
) {
  const withValues = points.filter((p) => p.value !== null);
  if (withValues.length === 0) {
    ena.addEmptyState(s, "이 구간은 표시할 데이터가 부족합니다.", { x: opts.x, y: opts.y, w: opts.w, h: opts.h });
    return;
  }
  const base = ena.enaChartBase();
  // pptxgenjs는 시리즈 전체에 하나의 색만 쉽게 못 주므로(막대별 색은 chartColorsOpacity 등으로
  // 세분화 어려움), 등락 방향이 중요한 차트(프로그램 델타 등)는 양/음 두 시리즈로 나눠 각각
  // 다른 색을 준다 — pptxgenjs가 지원하는 표준 방식.
  if (opts.diverging) {
    const posValues = withValues.map((p) => (p.value! >= 0 ? p.value! : 0));
    const negValues = withValues.map((p) => (p.value! < 0 ? p.value! : 0));
    s.addChart(
      pres.ChartType.bar,
      [
        { name: "상승", labels: withValues.map((p) => p.label), values: posValues },
        { name: "하락", labels: withValues.map((p) => p.label), values: negValues },
      ],
      {
        ...base,
        x: opts.x,
        y: opts.y,
        w: opts.w,
        h: opts.h,
        barDir: "col",
        barGrouping: "standard",
        chartColors: [DECK_UP, DECK_DOWN],
        catAxisLabelRotate: opts.rotateLabels ? 30 : 0,
        dataLabelFontSize: 0,
      }
    );
    return;
  }
  s.addChart(pres.ChartType.bar, [{ name: "값", labels: withValues.map((p) => p.label), values: withValues.map((p) => p.value as number) }], {
    ...base,
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    barDir: "col",
    chartColors: [opts.accent],
    catAxisLabelRotate: opts.rotateLabels ? 30 : 0,
  });
}

function addDeckLineChart(pres: PptxGenJS, s: PptSlide, points: DeckPoint[], opts: { x: number; y: number; w: number; h: number; accent: string }) {
  const withValues = points.filter((p) => p.value !== null);
  if (withValues.length === 0) {
    ena.addEmptyState(s, "이 구간은 표시할 데이터가 부족합니다.", { x: opts.x, y: opts.y, w: opts.w, h: opts.h });
    return;
  }
  s.addChart(pres.ChartType.line, [{ name: "시청률", labels: withValues.map((p) => p.label), values: withValues.map((p) => p.value as number) }], {
    ...ena.enaChartBase(),
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    chartColors: [opts.accent],
    lineSize: 2.5,
    lineDataSymbol: "circle",
    lineDataSymbolSize: 5,
    catAxisLabelRotate: withValues.length > 10 ? 45 : 0,
  });
}

export async function renderDeckPptx(deck: ExecutiveDeckDocument): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  const d = deck.slides;
  const c = deck.charts;
  // ENA 디자인 시스템 테마 — 포인트 컬러(ENA는 공식 ENA Blue, 나머지는 채널 로고색)·로고·
  // 표지 그라데이션이 전부 여기서 결정된다.
  const theme = ena.createEnaTheme({
    channelCode: deck.channelCode,
    channelName: deck.channelCode ?? "KT ENA",
    themeColor: deck.themeColor,
  });
  const accent = theme.accent;
  // 로고·그라데이션·리본을 마스터에 한 번만 심는다(파일 크기·일관성 모두 이 쪽이 맞다).
  ena.defineEnaMasters(pres, theme);

  // 1. 표지 — 그라데이션 + "매일 새로운 ENA" 슬로건 락업(ena-design 01-cover 구성).
  ena.addCoverSlide(pres, theme, {
    eyebrow: `${deck.channelCode ?? "PORTFOLIO"}  ·  ${deck.periodLabel}`,
    title: d.title.title,
    subtitle: d.title.subtitle,
    dateLabel: d.title.dateLabel,
    author: d.title.author,
  });

  /** 본문 슬라이드 공통 시작 — 흰 배경·우상단 로고·쪽번호는 마스터가 이미 갖고 있다. */
  const contentSlide = (eyebrow: string, actionTitle: string): PptSlide => ena.addContentSlide(pres, theme, eyebrow, actionTitle);

  // 2. Executive Summary — KPI 등락률 막대가 2개 미만(예: 단일 일자 모드는 Rating만 전일 대비를
  // 갖는 경우가 많음)이면 텅 빈 차트를 억지로 그리지 않는다 — 대신 핵심 지표를 액센트 틱이 붙은
  // 카드로 세로 나열해 그 공간을 준다.
  {
    const s = contentSlide("EXECUTIVE SUMMARY", d.executiveSummary.actionTitle);
    const bars = c.kpiDeltaBars.filter((b) => b.value !== null);
    if (bars.length >= 2) {
      ena.addCaption(s, "5대 지표 등락률 (전기간 대비, %)", ena.CONTENT_Y - ena.px(30));
      addDeckBarChart(pres, s, c.kpiDeltaBars, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(220), accent });
      ena.addBullets(s, d.executiveSummary.verdict, {
        x: ena.BODY_X,
        y: ena.CONTENT_Y + ena.px(238),
        w: ena.BODY_W,
        h: ena.px(150),
        note: d.executiveSummary.note,
      });
    } else {
      let y = ena.CONTENT_Y;
      for (const h of d.executiveSummary.kpiHighlights) {
        s.addShape("roundRect", { x: ena.BODY_X, y, w: ena.BODY_W, h: ena.px(62), fill: { color: ena.GRAY_50 }, line: { color: ena.GRAY_200, width: 0.75 }, rectRadius: ena.px(10) });
        s.addShape("roundRect", { x: ena.BODY_X, y: y + ena.px(10), w: ena.px(4), h: ena.px(42), fill: { color: accent }, rectRadius: ena.px(2), line: { color: accent, width: 0 } });
        s.addText(h, { x: ena.BODY_X + ena.px(22), y, w: ena.BODY_W - ena.px(40), h: ena.px(62), fontFace: ena.FONT_MEDIUM, fontSize: ena.ptSize(21), color: ena.GRAY_800, valign: "middle" });
        y += ena.px(74);
      }
      ena.addBullets(s, d.executiveSummary.verdict, { x: ena.BODY_X, y: y + ena.px(16), w: ena.BODY_W, h: ena.px(140), note: d.executiveSummary.note });
    }
  }

  // 3. Trend — 일자별 시청률 라인 차트
  {
    const s = contentSlide("TREND", d.trend.actionTitle);
    addDeckLineChart(pres, s, c.trendPoints, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(250), accent });
    ena.addBullets(s, d.trend.bullets, { x: ena.BODY_X, y: ena.CONTENT_Y + ena.px(266), w: ena.BODY_W, h: ena.px(92), note: d.trend.note });
    ena.addSoWhat(s, d.trend.soWhat, ena.px(600), theme);
  }

  // 4. 주중 vs 주말 · 요일별 — 요일별 바 차트(월~일), 결정론적 캡션(LLM 없음)
  if (d.weekday.available) {
    const s = contentSlide("WEEKDAY · WEEKEND", d.weekday.actionTitle);
    addDeckBarChart(pres, s, c.weekdayBars, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(320), accent });
    ena.addCaption(s, d.weekday.caption, ena.px(586), { align: "center" });
  }

  // 5. 시간대별 분석 — 02~25시 바 차트, 결정론적 캡션
  if (d.hourly.available) {
    const s = contentSlide("HOURLY", d.hourly.actionTitle);
    addDeckBarChart(pres, s, c.hourlyBars, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(320), rotateLabels: true, accent });
    ena.addCaption(s, d.hourly.caption, ena.px(586), { align: "center" });
  }

  // 6. Demographic — 연령대별 시청률 바 차트
  {
    const s = contentSlide("AUDIENCE", d.demographic.actionTitle);
    addDeckBarChart(pres, s, c.demographicBars, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(250), rotateLabels: true, accent });
    ena.addBullets(s, d.demographic.bullets, { x: ena.BODY_X, y: ena.CONTENT_Y + ena.px(266), w: ena.BODY_W, h: ena.px(92), note: d.demographic.note });
    ena.addSoWhat(s, d.demographic.soWhat, ena.px(600), theme);
  }

  // 7. Killer Content & Timeslot — 프로그램 등락(성장/약세) 바 차트(방향성 자체가 정보라 상승/
  // 하락 색은 채널색이 아니라 의미 색을 그대로 유지 — DECK_UP/DECK_DOWN).
  {
    const s = contentSlide("CONTENT", d.content.actionTitle);
    addDeckBarChart(pres, s, c.programBars, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(214), diverging: true, rotateLabels: true, accent });
    const colW = (ena.BODY_W - ena.px(32)) / 2;
    const listY = ena.CONTENT_Y + ena.px(232);
    s.addText("TOP", { x: ena.BODY_X, y: listY, w: colW, h: ena.px(24), fontFace: ena.FONT_BOLD, fontSize: ena.ptSize(16), color: DECK_UP, charSpacing: 1 });
    ena.addBullets(s, d.content.topBullets, { x: ena.BODY_X, y: listY + ena.px(28), w: colW, h: ena.px(96), sizePx: 19 });
    s.addText("BOTTOM", { x: ena.BODY_X + colW + ena.px(32), y: listY, w: colW, h: ena.px(24), fontFace: ena.FONT_BOLD, fontSize: ena.ptSize(16), color: DECK_DOWN, charSpacing: 1 });
    ena.addBullets(s, d.content.bottomBullets, { x: ena.BODY_X + colW + ena.px(32), y: listY + ena.px(28), w: colW, h: ena.px(96), note: d.content.note, sizePx: 19 });
    ena.addSoWhat(s, d.content.soWhat, ena.px(600), theme);
  }

  // 8. Strategy — Stop / Keep / Start(KEEP만 채널색 — 나머지 둘은 의미 색 그대로 유지)
  {
    const s = contentSlide("STRATEGY", d.strategy.actionTitle);
    const gap = ena.px(24);
    const colW = (ena.BODY_W - gap * 2) / 3;
    const col = (label: string, color: string, items: string[], i: number) => {
      const x = ena.BODY_X + i * (colW + gap);
      s.addShape("roundRect", { x, y: ena.CONTENT_Y, w: colW, h: ena.px(52), fill: { color }, rectRadius: ena.px(10), line: { color, width: 0 } });
      s.addText(label, { x, y: ena.CONTENT_Y, w: colW, h: ena.px(52), fontFace: ena.FONT_BOLD, fontSize: ena.ptSize(20), color: ena.WHITE, charSpacing: 1.5, align: "center", valign: "middle" });
      ena.addBullets(s, items, { x, y: ena.CONTENT_Y + ena.px(68), w: colW, h: ena.px(290), sizePx: 19 });
    };
    col("STOP", DECK_DOWN, d.strategy.stop, 0);
    col("KEEP", accent, d.strategy.keep, 1);
    col("START", DECK_UP, d.strategy.start, 2);
    if (d.strategy.note) ena.addCaption(s, d.strategy.note, ena.px(600));
  }

  if (!deck.generatedByAi) {
    const s = contentSlide("DATA NOTE", "본 보고서 문장 생성 안내");
    ena.addEmptyState(s, "AI 문장 생성이 검증을 통과하지 못해, 텍스트는 근거 신호를 그대로 나열한 폴백입니다(차트는 실제 데이터 그대로).", {
      x: ena.BODY_X,
      y: ena.CONTENT_Y,
      w: ena.BODY_W,
      h: ena.px(160),
    });
  }

  ena.addEodSlide(pres, theme);
  return (await pres.write({ outputType: "nodebuffer" })) as Buffer;
}

function renderPptBlock(s: PptSlide, b: DocBlock, theme: ena.EnaDeckTheme) {
  switch (b.kind) {
    case "text":
      s.addText(b.text, {
        x: ena.BODY_X,
        y: ena.CONTENT_Y,
        w: ena.BODY_W,
        h: ena.px(330),
        fontFace: ena.FONT_MEDIUM,
        fontSize: ena.ptSize(21),
        color: ena.GRAY_800,
        lineSpacingMultiple: 1.35,
        valign: "top",
      });
      return;
    case "note":
      ena.addEmptyState(s, `데이터 없음 — ${b.text}`, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(140) });
      return;
    case "bullets":
      ena.addBullets(s, b.items, { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(330) });
      return;
    case "kpi": {
      // ena-design 04-kpi 슬라이드 그대로 — 첫 카드는 액센트로 채운 brand 카드.
      const cards = b.items.map((k) => ({ label: k.label, value: k.value, delta: k.delta ?? undefined, dir: k.dir }));
      const firstRow = cards.slice(0, 3);
      const secondRow = cards.slice(3, 6);
      const afterFirst = ena.addKpiCards(s, firstRow, theme, ena.CONTENT_Y);
      if (secondRow.length > 0) ena.addKpiCards(s, secondRow, theme, afterFirst + ena.px(24), { maxPerRow: 3 });
      return;
    }
    case "table":
      if (b.rows.length === 0) {
        ena.addEmptyState(s, "표시할 행이 없습니다.", { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, h: ena.px(120) });
        return;
      }
      addPptTable(s, b.headers, b.rows);
      return;
  }
}
