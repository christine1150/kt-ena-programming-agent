// N절 Phase 2a(2026-09-01) — FlatReport(reportFlatten.ts) → Word(.docx) / PPT(.pptx) 렌더러.
// 두 렌더러 모두 "블록을 그리는 법"만 안다 — 어떤 섹션에 어떤 값을 넣을지는 reportFlatten.ts
// 한 곳에서만 정한다(구 시스템은 이 결정이 docx/pptx에 각각 하드코딩돼 있어 조용히 갈라졌다).
// 색·여백은 구 시스템(/api/report/channel/docx|pptx)의 스타일을 그대로 승계해 문서 인상이
// 바뀌지 않게 했다.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";
import PptxGenJS from "pptxgenjs";
import type { FlatReport, DocBlock } from "./reportFlatten";
import type { ExecutiveDeckDocument } from "./deckModel";

const NAVY = "1E293B";
const ACCENT = "3A30DF";
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
/** 한 슬라이드에 넣을 수 있는 표 행 수 — 넘으면 같은 제목으로 슬라이드를 이어서 만든다. */
const PPT_ROWS_PER_SLIDE = 12;

export async function renderReportPptx(flat: FlatReport): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";

  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  cover.addText(flat.title, { x: 0.6, y: 1.4, w: 8.8, h: 1.2, fontSize: 32, bold: true, color: "FFFFFF" });
  cover.addText(flat.subtitle, { x: 0.6, y: 2.6, w: 8.8, h: 0.6, fontSize: 15, color: "CBD5E1" });
  cover.addText("KT ENA 편성 AI Agent", { x: 0.6, y: 4.9, w: 8.8, h: 0.4, fontSize: 12, italic: true, color: "94A3B8" });

  for (const section of flat.sections) {
    // 한 섹션이 여러 블록이면 블록마다 슬라이드를 나눠 글자가 겹치지 않게 한다.
    for (const block of section.blocks) {
      if (block.kind === "table" && block.rows.length > PPT_ROWS_PER_SLIDE) {
        for (let i = 0; i < block.rows.length; i += PPT_ROWS_PER_SLIDE) {
          const chunk = block.rows.slice(i, i + PPT_ROWS_PER_SLIDE);
          const s = pres.addSlide();
          const suffix = block.rows.length > PPT_ROWS_PER_SLIDE ? ` (${Math.floor(i / PPT_ROWS_PER_SLIDE) + 1})` : "";
          s.addText(section.title + suffix, { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 22, bold: true, color: ACCENT });
          addPptTable(s, block.headers, chunk);
        }
        continue;
      }
      const s = pres.addSlide();
      s.addText(section.title, { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 22, bold: true, color: ACCENT });
      renderPptBlock(s, block);
    }
  }
  // pptxgenjs의 write()는 환경에 따라 string|Buffer|Blob을 반환한다 — Node 런타임에서는 nodebuffer로 강제한다.
  return (await pres.write({ outputType: "nodebuffer" })) as Buffer;
}

type PptSlide = ReturnType<PptxGenJS["addSlide"]>;

function addPptTable(s: PptSlide, headers: string[], rows: string[][]) {
  const header = headers.map((h) => ({ text: h, options: { bold: true, fill: { color: "F4F4F5" }, color: "27272A" } }));
  const body = rows.map((r) => r.map((c) => ({ text: c, options: { color: "27272A" } })));
  s.addTable([header, ...body], { x: 0.5, y: 1.1, w: 9, fontSize: 11, border: { type: "solid", color: "E4E4E7", pt: 1 }, autoPage: false });
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
const DECK_ACCENT = "3A30DF"; // 폴백 색(포트폴리오 스코프·미등록 채널). 채널 스코프는 toPptxHex(deck.themeColor, DECK_ACCENT)로 대체됨.
const DECK_UP = "059669";
const DECK_DOWN = "E11D48";

// 채널 브랜딩(2026-09-02, 사용자 지시: "각 채널의 PPT는 각 채널의 로고 색을 포인트 컬러로 하여
// 세련되게 디자인") — channels.theme_color(예: "#3830e0")를 pptxgenjs가 쓰는 "#" 없는 대문자
// 6자리 hex로 변환한다. 형식이 어긋나면(미등록 채널 등) 기존 기본 색(DECK_ACCENT)으로 폴백 —
// 포트폴리오(다채널) 스코프는 항상 이 폴백을 쓴다.
function toPptxHex(themeColor: string | null | undefined, fallback: string): string {
  if (!themeColor) return fallback;
  const hex = themeColor.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : fallback;
}
/** 채널색과 흰색을 섞어 옅은 배경 톤을 만든다(So What? 강조 바 등) — amount 0~1, 1에 가까울수록 흼. */
function tintWithWhite(hex: string, amount: number): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function addDeckActionTitle(s: PptSlide, title: string, accent: string) {
  s.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.85, fontSize: 22, bold: true, color: accent, valign: "top" });
}
function addDeckSoWhat(s: PptSlide, text: string, y: number, accent: string) {
  if (!text) return;
  s.addShape("rect", { x: 0.5, y, w: 9, h: 0.55, fill: { color: tintWithWhite(accent, 0.9) } });
  s.addShape("rect", { x: 0.5, y, w: 0.06, h: 0.55, fill: { color: accent } });
  s.addText([{ text: "So What?  ", options: { bold: true, color: accent } }, { text, options: { color: "27272A" } }], { x: 0.65, y: y + 0.06, w: 8.7, h: 0.43, fontSize: 12, valign: "middle" });
}
// 사용자 지시(2026-09-01): "본문 글자 수는 제한하되 필요한 설명의 경우 작게 들어갈 수 있음" —
// note가 있으면 개조식 bullet 목록 끝에 글머리표 없는 작은 글씨 줄로 덧붙인다.
function addDeckBullets(s: PptSlide, items: string[], x: number, y: number, w: number, h: number, note?: string) {
  if (items.length === 0 && !note) {
    s.addText("표시할 신호가 없습니다.", { x, y, w, h, fontSize: 12, italic: true, color: "A1A1AA" });
    return;
  }
  const runs: { text: string; options: { bullet: boolean; fontSize: number; color: string; breakLine: boolean; italic?: boolean } }[] = items.map((t) => ({
    text: t,
    options: { bullet: true, fontSize: 12, color: "27272A", breakLine: true },
  }));
  if (note) runs.push({ text: note, options: { bullet: false, fontSize: 9, color: "A1A1AA", breakLine: true, italic: true } });
  s.addText(runs, { x, y, w, h, valign: "top" });
}

type DeckPoint = { label: string; value: number | null };

/** 값이 있는 포인트가 없으면 "데이터 부족" 안내만 — 억지로 빈 차트를 그리지 않는다. */
function addDeckBarChart(pres: PptxGenJS, s: PptSlide, points: DeckPoint[], opts: { x: number; y: number; w: number; h: number; diverging?: boolean; rotateLabels?: boolean; accent?: string }) {
  const withValues = points.filter((p) => p.value !== null);
  if (withValues.length === 0) {
    s.addText("이 구간은 표시할 데이터가 부족합니다.", { x: opts.x, y: opts.y, w: opts.w, h: opts.h, fontSize: 12, italic: true, color: "A1A1AA", align: "center", valign: "middle" });
    return;
  }
  // pptxgenjs는 시리즈 전체에 하나의 색만 쉽게 못 주므로(막대별 색은 chartColorsOpacity 등으로
  // 세분화 어려움), 등락 방향이 중요한 차트(프로그램 델타 등)는 양/음 두 시리즈로 나눠 각각
  // 다른 색을 준다 — pptxgenjs가 지원하는 표준 방식.
  if (opts.diverging) {
    const posValues = withValues.map((p) => (p.value! >= 0 ? p.value! : null));
    const negValues = withValues.map((p) => (p.value! < 0 ? p.value! : null));
    s.addChart(
      pres.ChartType.bar,
      [
        { name: "상승", labels: withValues.map((p) => p.label), values: posValues.map((v) => v ?? 0) },
        { name: "하락", labels: withValues.map((p) => p.label), values: negValues.map((v) => v ?? 0) },
      ],
      {
        x: opts.x, y: opts.y, w: opts.w, h: opts.h,
        barDir: "col", barGrouping: "standard",
        chartColors: [DECK_UP, DECK_DOWN],
        showLegend: false, showTitle: false,
        catAxisLabelFontSize: 8, valAxisLabelFontSize: 8,
        catAxisLabelColor: "52525B", valAxisLabelColor: "52525B",
        catAxisLineColor: "E4E4E7", valAxisLineColor: "E4E4E7",
        catAxisLabelRotate: opts.rotateLabels ? 30 : 0,
        showValAxisTitle: false, showCatAxisTitle: false,
        dataLabelFontSize: 0,
      }
    );
    return;
  }
  s.addChart(pres.ChartType.bar, [{ name: "값", labels: withValues.map((p) => p.label), values: withValues.map((p) => p.value as number) }], {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    barDir: "col",
    chartColors: [opts.accent ?? DECK_ACCENT],
    showLegend: false, showTitle: false,
    catAxisLabelFontSize: 8, valAxisLabelFontSize: 8,
    catAxisLabelColor: "52525B", valAxisLabelColor: "52525B",
    catAxisLineColor: "E4E4E7", valAxisLineColor: "E4E4E7",
    catAxisLabelRotate: opts.rotateLabels ? 30 : 0,
    showValAxisTitle: false, showCatAxisTitle: false,
  });
}

function addDeckLineChart(pres: PptxGenJS, s: PptSlide, points: DeckPoint[], opts: { x: number; y: number; w: number; h: number; accent?: string }) {
  const withValues = points.filter((p) => p.value !== null);
  if (withValues.length === 0) {
    s.addText("이 구간은 표시할 데이터가 부족합니다.", { x: opts.x, y: opts.y, w: opts.w, h: opts.h, fontSize: 12, italic: true, color: "A1A1AA", align: "center", valign: "middle" });
    return;
  }
  s.addChart(pres.ChartType.line, [{ name: "시청률", labels: withValues.map((p) => p.label), values: withValues.map((p) => p.value as number) }], {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    chartColors: [opts.accent ?? DECK_ACCENT],
    lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 4,
    showLegend: false, showTitle: false,
    catAxisLabelFontSize: 8, valAxisLabelFontSize: 8,
    catAxisLabelColor: "52525B", valAxisLabelColor: "52525B",
    catAxisLineColor: "E4E4E7", valAxisLineColor: "E4E4E7",
    catAxisLabelRotate: withValues.length > 10 ? 45 : 0,
    showValAxisTitle: false, showCatAxisTitle: false,
  });
}

/** 콘텐츠 슬라이드 상단에 채널 색 얇은 브랜드 바를 그어 8장 전체가 한 세트로 보이게 한다(사용자
 * 지시: "세련되게 디자인"). 텍스트가 아니라 순수 장식 요소라 캡션 글자 수엔 영향 없음. */
function addDeckBrandBar(s: PptSlide, accent: string) {
  s.addShape("rect", { x: 0, y: 0, w: 10, h: 0.06, fill: { color: accent } });
}

export async function renderDeckPptx(deck: ExecutiveDeckDocument): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  const d = deck.slides;
  const c = deck.charts;
  // 채널 브랜딩(2026-09-02) — 이 리포트가 다루는 채널의 로고 색을 포인트 컬러로. 포트폴리오
  // (다채널) 스코프나 미등록 채널은 기존 기본 색(DECK_ACCENT)으로 조용히 폴백한다.
  const accent = toPptxHex(deck.themeColor, DECK_ACCENT);

  // 1. Title — 채널 색 액센트 바 + 태그로 브랜딩(로고 이미지 대신 컬러로 "이 채널의 보고서"를 표시).
  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  cover.addShape("rect", { x: 0, y: 0, w: 0.18, h: 5.63, fill: { color: accent } });
  cover.addShape("rect", { x: 0.6, y: 1.35, w: 0.7, h: 0.28, fill: { color: accent } });
  cover.addText(deck.channelCode ?? "PORTFOLIO", { x: 0.6, y: 1.35, w: 0.7, h: 0.28, fontSize: 9, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
  cover.addText(d.title.title, { x: 0.6, y: 1.75, w: 8.8, h: 1.4, fontSize: 30, bold: true, color: "FFFFFF" });
  cover.addShape("rect", { x: 0.6, y: 3.05, w: 1.4, h: 0.03, fill: { color: accent } });
  cover.addText(d.title.subtitle, { x: 0.6, y: 3.2, w: 8.8, h: 0.5, fontSize: 15, color: "CBD5E1" });
  cover.addText(d.title.dateLabel, { x: 0.6, y: 4.6, w: 8.8, h: 0.4, fontSize: 12, color: "94A3B8" });
  cover.addText(d.title.author, { x: 0.6, y: 4.95, w: 8.8, h: 0.4, fontSize: 12, italic: true, color: "94A3B8" });

  // 2. Executive Summary — KPI 등락률 막대가 2개 미만(예: 단일 일자 모드는 Rating만 전일 대비를
  // 갖는 경우가 많음)이면 텅 빈 차트를 억지로 그리지 않는다(사용자 지시: "레이아웃이 예쁘도록
  // 재배열") — 대신 핵심 지표를 채널색 강조 바가 붙은 카드로 세로 나열해 그 공간을 준다.
  {
    const s = pres.addSlide();
    addDeckBrandBar(s, accent);
    addDeckActionTitle(s, d.executiveSummary.actionTitle, accent);
    const bars = c.kpiDeltaBars.filter((b) => b.value !== null);
    if (bars.length >= 2) {
      s.addText("5대 지표 등락률(전기간 대비, %)", { x: 0.5, y: 1.25, w: 9, h: 0.3, fontSize: 10, color: "71717A" });
      addDeckBarChart(pres, s, c.kpiDeltaBars, { x: 0.5, y: 1.55, w: 9, h: 2.15, accent });
      addDeckBullets(s, d.executiveSummary.verdict, 0.5, 3.85, 9, 1.3, d.executiveSummary.note);
    } else {
      let y = 1.3;
      for (const h of d.executiveSummary.kpiHighlights) {
        s.addShape("rect", { x: 0.5, y, w: 0.05, h: 0.62, fill: { color: accent } });
        s.addShape("rect", { x: 0.58, y, w: 8.92, h: 0.62, fill: { color: "F8FAFC" } });
        s.addText(h, { x: 0.75, y, w: 8.6, h: 0.62, fontSize: 13, color: "27272A", valign: "middle" });
        y += 0.74;
      }
      addDeckBullets(s, d.executiveSummary.verdict, 0.5, y + 0.15, 9, 1.5, d.executiveSummary.note);
    }
  }

  // 3. Trend — 일자별 시청률 라인 차트(공간을 넓게 써서 여백을 줄임)
  {
    const s = pres.addSlide();
    addDeckBrandBar(s, accent);
    addDeckActionTitle(s, d.trend.actionTitle, accent);
    addDeckLineChart(pres, s, c.trendPoints, { x: 0.5, y: 1.25, w: 9, h: 2.5, accent });
    addDeckBullets(s, d.trend.bullets, 0.5, 3.85, 9, 0.9, d.trend.note);
    addDeckSoWhat(s, d.trend.soWhat, 4.85, accent);
  }

  // 4(신규). 주중 vs 주말 · 요일별 — 요일별 바 차트(월~일), 결정론적 캡션(LLM 없음)
  if (d.weekday.available) {
    const s = pres.addSlide();
    addDeckBrandBar(s, accent);
    addDeckActionTitle(s, d.weekday.actionTitle, accent);
    addDeckBarChart(pres, s, c.weekdayBars, { x: 0.5, y: 1.25, w: 9, h: 3.25, accent });
    s.addText(d.weekday.caption, { x: 0.5, y: 4.65, w: 9, h: 0.5, fontSize: 11, color: "52525B", align: "center" });
  }

  // 5(신규). 시간대별 분석 — 02~25시 바 차트(프라임 강조), 결정론적 캡션
  if (d.hourly.available) {
    const s = pres.addSlide();
    addDeckBrandBar(s, accent);
    addDeckActionTitle(s, d.hourly.actionTitle, accent);
    addDeckBarChart(pres, s, c.hourlyBars, { x: 0.5, y: 1.25, w: 9, h: 3.25, rotateLabels: true, accent });
    s.addText(d.hourly.caption, { x: 0.5, y: 4.65, w: 9, h: 0.5, fontSize: 11, color: "52525B", align: "center" });
  }

  // 6. Demographic — 연령대별 시청률 바 차트
  {
    const s = pres.addSlide();
    addDeckBrandBar(s, accent);
    addDeckActionTitle(s, d.demographic.actionTitle, accent);
    addDeckBarChart(pres, s, c.demographicBars, { x: 0.5, y: 1.25, w: 9, h: 2.5, rotateLabels: true, accent });
    addDeckBullets(s, d.demographic.bullets, 0.5, 3.85, 9, 0.9, d.demographic.note);
    addDeckSoWhat(s, d.demographic.soWhat, 4.85, accent);
  }

  // 7. Killer Content & Timeslot — 프로그램 등락(성장/약세) 바 차트(방향성 자체가 정보라 상승/
  // 하락 색은 채널색이 아니라 의미 색을 그대로 유지 — DECK_UP/DECK_DOWN).
  {
    const s = pres.addSlide();
    addDeckBrandBar(s, accent);
    addDeckActionTitle(s, d.content.actionTitle, accent);
    addDeckBarChart(pres, s, c.programBars, { x: 0.5, y: 1.25, w: 9, h: 2.2, diverging: true, rotateLabels: true });
    s.addText("TOP", { x: 0.5, y: 3.55, w: 4.3, h: 0.3, fontSize: 11, bold: true, color: DECK_UP });
    addDeckBullets(s, d.content.topBullets, 0.5, 3.85, 4.3, 0.9);
    s.addText("BOTTOM", { x: 5.2, y: 3.55, w: 4.3, h: 0.3, fontSize: 11, bold: true, color: DECK_DOWN });
    addDeckBullets(s, d.content.bottomBullets, 5.2, 3.85, 4.3, 0.9, d.content.note);
    addDeckSoWhat(s, d.content.soWhat, 4.85, accent);
  }

  // 8. Strategy — Stop / Keep / Start(KEEP만 채널색 — 나머지 둘은 의미 색 그대로 유지)
  {
    const s = pres.addSlide();
    addDeckBrandBar(s, accent);
    addDeckActionTitle(s, d.strategy.actionTitle, accent);
    const col = (label: string, color: string, items: string[], x: number) => {
      s.addShape("rect", { x, y: 1.3, w: 2.9, h: 0.45, fill: { color } });
      s.addText(label, { x, y: 1.3, w: 2.9, h: 0.45, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
      addDeckBullets(s, items, x, 1.9, 2.9, 3.0);
    };
    col("STOP", DECK_DOWN, d.strategy.stop, 0.5);
    col("KEEP", accent, d.strategy.keep, 3.55);
    col("START", DECK_UP, d.strategy.start, 6.6);
    if (d.strategy.note) s.addText(d.strategy.note, { x: 0.5, y: 5.0, w: 9, h: 0.4, fontSize: 9, italic: true, color: "A1A1AA" });
  }

  if (!deck.generatedByAi) {
    const s = pres.addSlide();
    s.addText("AI 문장 생성이 검증을 통과하지 못해, 텍스트는 근거 신호를 그대로 나열한 폴백입니다(차트는 실제 데이터 그대로).", { x: 0.6, y: 2.3, w: 8.8, h: 1, fontSize: 14, color: "71717A", align: "center" });
  }

  return (await pres.write({ outputType: "nodebuffer" })) as Buffer;
}

function renderPptBlock(s: PptSlide, b: DocBlock) {
  switch (b.kind) {
    case "text":
      s.addText(b.text, { x: 0.5, y: 1.1, w: 9, h: 4, fontSize: 15, color: "27272A", valign: "top" });
      return;
    case "note":
      s.addText(`데이터 없음 — ${b.text}`, { x: 0.5, y: 1.1, w: 9, h: 1, fontSize: 14, italic: true, color: "A1A1AA", valign: "top" });
      return;
    case "bullets":
      s.addText(b.items.map((t) => ({ text: t, options: { bullet: true, fontSize: 14, color: "27272A" } })), { x: 0.5, y: 1.1, w: 9, h: 4, valign: "top" });
      return;
    case "kpi": {
      const header = b.items.map((k) => ({ text: k.label, options: { bold: true, fill: { color: "F4F4F5" }, color: "27272A" } }));
      const values = b.items.map((k) => ({ text: `${k.value}${k.delta ? `\n${k.delta}` : ""}`, options: { color: deltaColor(k.dir) ?? "27272A", fontSize: 12 } }));
      s.addTable([header, values], { x: 0.5, y: 1.1, w: 9, fontSize: 14, border: { type: "solid", color: "E4E4E7", pt: 1 } });
      return;
    }
    case "table":
      if (b.rows.length === 0) {
        s.addText("표시할 행이 없습니다.", { x: 0.5, y: 1.1, w: 9, h: 0.6, fontSize: 14, italic: true, color: "A1A1AA" });
        return;
      }
      addPptTable(s, b.headers, b.rows);
      return;
  }
}
