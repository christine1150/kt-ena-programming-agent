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

// Phase 13(2026-09-01) — "6-슬라이드 임원 보고용 PPT"(deckModel.ts) 전용 렌더러. FlatReport
// 기반 renderReportPptx와는 목적이 다르다(그건 상세 리포트 전체를 표로 옮기는 것, 이건 6장
// 고정 구조의 요약 슬라이드) — 그래서 별도 함수로 둔다. 5대 작성 원칙(Action Title 큰 제목,
// 개조식 bullet, 차트 삽입 위치 박스, So What 강조 바)을 슬라이드 레이아웃 자체로 강제한다.
const DECK_ACCENT = "3A30DF";
const DECK_SOWHAT_BG = "EEF2FF";

function addDeckActionTitle(s: PptSlide, title: string) {
  s.addText(title, { x: 0.5, y: 0.35, w: 9, h: 1.0, fontSize: 24, bold: true, color: DECK_ACCENT, valign: "top" });
}
function addDeckChartNote(s: PptSlide, note: string, y: number) {
  s.addShape("rect", { x: 0.5, y, w: 9, h: 0.9, fill: { color: "F4F4F5" }, line: { color: "D4D4D8", dashType: "dash", width: 1 } });
  s.addText(note, { x: 0.6, y: y + 0.1, w: 8.8, h: 0.7, fontSize: 12, italic: true, color: "71717A", valign: "middle" });
}
function addDeckSoWhat(s: PptSlide, text: string, y: number) {
  if (!text) return;
  s.addShape("rect", { x: 0.5, y, w: 9, h: 0.7, fill: { color: DECK_SOWHAT_BG } });
  s.addText([{ text: "So What?  ", options: { bold: true, color: DECK_ACCENT } }, { text, options: { color: "27272A" } }], { x: 0.65, y: y + 0.08, w: 8.7, h: 0.54, fontSize: 13, valign: "middle" });
}
// 사용자 지시(2026-09-01): "본문 글자 수는 제한하되 필요한 설명의 경우 작게 들어갈 수 있음" —
// note가 있으면 개조식 bullet 목록 끝에 글머리표 없는 작은 글씨 줄로 덧붙인다(별도 박스를 새로
// 만들면 16:9 슬라이드의 좁은 세로 여백을 넘기기 쉬워, 같은 텍스트 상자 안에 스타일만 다르게).
function addDeckBullets(s: PptSlide, items: string[], y: number, h: number, note?: string) {
  if (items.length === 0 && !note) {
    s.addText("표시할 신호가 없습니다.", { x: 0.5, y, w: 9, h, fontSize: 13, italic: true, color: "A1A1AA" });
    return;
  }
  const runs: { text: string; options: { bullet: boolean; fontSize: number; color: string; breakLine: boolean; italic?: boolean } }[] = items.map((t) => ({
    text: t,
    options: { bullet: true, fontSize: 14, color: "27272A", breakLine: true },
  }));
  if (note) runs.push({ text: note, options: { bullet: false, fontSize: 10, color: "A1A1AA", breakLine: true, italic: true } });
  s.addText(runs, { x: 0.5, y, w: 9, h, valign: "top" });
}

export async function renderDeckPptx(deck: ExecutiveDeckDocument): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  const d = deck.slides;

  // 1. Title
  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  cover.addText(d.title.title, { x: 0.6, y: 1.6, w: 8.8, h: 1.4, fontSize: 30, bold: true, color: "FFFFFF" });
  cover.addText(d.title.subtitle, { x: 0.6, y: 3.0, w: 8.8, h: 0.5, fontSize: 15, color: "CBD5E1" });
  cover.addText(d.title.dateLabel, { x: 0.6, y: 4.6, w: 8.8, h: 0.4, fontSize: 12, color: "94A3B8" });
  cover.addText(d.title.author, { x: 0.6, y: 4.95, w: 8.8, h: 0.4, fontSize: 12, italic: true, color: "94A3B8" });

  // 2. Executive Summary
  {
    const s = pres.addSlide();
    addDeckActionTitle(s, d.executiveSummary.actionTitle);
    const header = d.executiveSummary.kpiHighlights.map((h) => ({ text: h, options: { fontSize: 13, bold: true, fill: { color: "F4F4F5" }, color: DECK_ACCENT } }));
    if (header.length > 0) s.addTable([header], { x: 0.5, y: 1.5, w: 9, h: 0.9, border: { type: "solid", color: "E4E4E7", pt: 1 }, valign: "middle" });
    addDeckBullets(s, d.executiveSummary.verdict, 2.7, 2.0, d.executiveSummary.note);
  }

  // 3. Trend
  {
    const s = pres.addSlide();
    addDeckActionTitle(s, d.trend.actionTitle);
    addDeckChartNote(s, d.trend.chartNote, 1.5);
    addDeckBullets(s, d.trend.bullets, 2.6, 2.1, d.trend.note);
    addDeckSoWhat(s, d.trend.soWhat, 4.9);
  }

  // 4. Demographic
  {
    const s = pres.addSlide();
    addDeckActionTitle(s, d.demographic.actionTitle);
    addDeckChartNote(s, d.demographic.chartNote, 1.5);
    addDeckBullets(s, d.demographic.bullets, 2.6, 2.1, d.demographic.note);
    addDeckSoWhat(s, d.demographic.soWhat, 4.9);
  }

  // 5. Killer Content & Timeslot
  {
    const s = pres.addSlide();
    addDeckActionTitle(s, d.content.actionTitle);
    addDeckChartNote(s, d.content.chartNote, 1.5);
    s.addText("TOP 3", { x: 0.5, y: 2.55, w: 4.3, h: 0.35, fontSize: 13, bold: true, color: "059669" });
    addDeckBullets(s, d.content.topBullets, 2.9, 1.7);
    s.addText("BOTTOM 3", { x: 5.2, y: 2.55, w: 4.3, h: 0.35, fontSize: 13, bold: true, color: "E11D48" });
    addDeckBullets(s, d.content.bottomBullets, 2.9, 1.7, d.content.note);
    addDeckSoWhat(s, d.content.soWhat, 4.75);
  }

  // 6. Strategy — Stop / Keep / Start
  {
    const s = pres.addSlide();
    addDeckActionTitle(s, d.strategy.actionTitle);
    const col = (label: string, color: string, items: string[], x: number) => {
      s.addShape("rect", { x, y: 1.5, w: 2.9, h: 0.5, fill: { color } });
      s.addText(label, { x, y: 1.5, w: 2.9, h: 0.5, fontSize: 15, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
      addDeckBullets(s, items, 2.15, 2.7);
    };
    col("STOP", "E11D48", d.strategy.stop, 0.5);
    col("KEEP", "334155", d.strategy.keep, 3.55);
    col("START", "059669", d.strategy.start, 6.6);
    if (d.strategy.note) s.addText(d.strategy.note, { x: 0.5, y: 5.0, w: 9, h: 0.4, fontSize: 9, italic: true, color: "A1A1AA" });
  }

  if (!deck.generatedByAi) {
    const s = pres.addSlide();
    s.addText("AI 문장 생성이 검증을 통과하지 못해, 위 슬라이드 내용은 근거 신호를 그대로 나열한 폴백입니다.", { x: 0.6, y: 2.3, w: 8.8, h: 1, fontSize: 14, color: "71717A", align: "center" });
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
