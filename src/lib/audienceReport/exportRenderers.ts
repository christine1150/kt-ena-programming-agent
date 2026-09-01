// N절 Phase 2a(2026-09-01) — FlatReport(reportFlatten.ts) → Word(.docx) / PPT(.pptx) 렌더러.
// 두 렌더러 모두 "블록을 그리는 법"만 안다 — 어떤 섹션에 어떤 값을 넣을지는 reportFlatten.ts
// 한 곳에서만 정한다(구 시스템은 이 결정이 docx/pptx에 각각 하드코딩돼 있어 조용히 갈라졌다).
// 색·여백은 구 시스템(/api/report/channel/docx|pptx)의 스타일을 그대로 승계해 문서 인상이
// 바뀌지 않게 했다.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";
import PptxGenJS from "pptxgenjs";
import type { FlatReport, DocBlock } from "./reportFlatten";

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
