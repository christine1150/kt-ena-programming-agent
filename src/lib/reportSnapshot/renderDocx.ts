// ReportModel → Word(.docx) (단계 14). 스냅샷의 본문·부록을 그대로 그린다 — 내용·문장·ID는 모델이 정하고 여기는 그리는 법만 안다.
//
// 점검 대상(실제 Word 렌더 검증 항목): 한글 글꼴, 표 머리행 반복, 행 쪼개짐 방지, 긴 제목 줄바꿈, 빈 값("—"),
// 흑백 인쇄(색에만 의존하지 않는 ▲/▼·※ 표시), 부록 새 쪽, 쪽번호.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { DocBlock, DocSection } from "@/lib/audienceReport/reportFlatten";
import { barRatio, chartSeries, columnShares, formatChartValue, isNumericText, metaCaption, metaFlags } from "./renderCommon";
import { kstStamp, type ReportModel } from "./template";

const FONT = { ascii: "Malgun Gothic", eastAsia: "Malgun Gothic", hAnsi: "Malgun Gothic", cs: "Malgun Gothic" };
const PAGE_W = 11906; // A4 (twip)
const MARGIN = 1134; // 2cm
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = "111827";
const MUTED = "6B7280";
const LINE = "D4D4D8";
const HEAD_FILL = "F3F4F6";
const ACCENT = "1D4ED8";

const THIN = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const CELL_BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };

function run(text: string, o?: { bold?: boolean; size?: number; color?: string; italics?: boolean }): TextRun {
  return new TextRun({ text, font: FONT, bold: o?.bold, size: o?.size ?? 20, color: o?.color ?? INK, italics: o?.italics });
}

function para(text: string, o?: { bold?: boolean; size?: number; color?: string; after?: number; before?: number; keepNext?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): Paragraph {
  return new Paragraph({
    keepNext: o?.keepNext,
    keepLines: true,
    alignment: o?.align,
    spacing: { after: o?.after ?? 80, before: o?.before ?? 0, line: 270 },
    children: [run(text, { bold: o?.bold, size: o?.size, color: o?.color })],
  });
}

function cell(text: string, width: number, o?: { header?: boolean; align?: "left" | "right" | "center"; fill?: string }): TableCell {
  const align = o?.align === "right" ? AlignmentType.RIGHT : o?.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    shading: o?.header || o?.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill ?? HEAD_FILL } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align, spacing: { after: 0, line: 260 }, children: [run(text, { bold: o?.header, size: 18 })] })],
  });
}

function widths(shares: number[]): number[] {
  const w = shares.map((s) => Math.floor(s * CONTENT_W));
  w[w.length - 1] += CONTENT_W - w.reduce((a, b) => a + b, 0);
  return w;
}

function table(headers: string[], rows: string[][]): Table {
  const w = widths(columnShares(headers, rows));
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: w,
    layout: TableLayoutType.FIXED,
    rows: [
      // 머리행은 쪽이 넘어가도 반복한다(tableHeader), 행은 쪽 경계에서 쪼개지지 않는다(cantSplit).
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, w[i], { header: true, align: "center" })) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: headers.map((_, i) => cell(r[i] ?? "—", w[i], { align: isNumericText(r[i] ?? "") ? "right" : "left" })) })),
    ],
  });
}

function captionParas(meta: Parameters<typeof metaCaption>[0]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const f of metaFlags(meta)) out.push(para(f, { size: 16, color: "92400E", after: 40, before: 40 }));
  const cap = metaCaption(meta);
  if (cap) out.push(para(cap, { size: 15, color: MUTED, after: 140, before: 30 }));
  else out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return out;
}

function blockToNodes(b: DocBlock, keepNext = false): (Paragraph | Table)[] {
  switch (b.kind) {
    case "text":
      return [para(b.text, { after: 120, keepNext })];
    case "note":
      return []; // 모델이 note를 본문에서 이미 걷어냈다 — 방법·한계 주석으로 모은다
    case "bullets":
      return b.items.map((t) => new Paragraph({ bullet: { level: 0 }, keepLines: true, spacing: { after: 36, line: 255 }, children: [run(t, { size: 19 })] }));
    case "kpi": {
      const w = widths(b.items.map(() => 1 / b.items.length));
      const sign = (d: "up" | "down" | "flat") => (d === "up" ? ACCENT : d === "down" ? "B91C1C" : INK);
      const t = new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: w,
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({ tableHeader: true, cantSplit: true, children: b.items.map((k, i) => cell(k.label, w[i], { header: true, align: "center" })) }),
          new TableRow({
            cantSplit: true,
            children: b.items.map(
              (k, i) =>
                new TableCell({
                  width: { size: w[i], type: WidthType.DXA },
                  borders: CELL_BORDERS,
                  margins: { top: 70, bottom: 70, left: 90, right: 90 },
                  children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [run(k.value, { bold: true, size: 26 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [run(k.delta ?? "—", { size: 17, color: sign(k.dir) })] }),
                  ],
                })
            ),
          }),
        ],
      });
      return [t, ...captionParas(b.meta)];
    }
    case "table": {
      if (b.rows.length === 0) return [para("표시할 행이 없음", { size: 18, color: MUTED })];
      return [table(b.headers, b.rows), ...captionParas(b.meta)];
    }
    case "chart": {
      const s = chartSeries(b);
      const rows = s.categories.map((c, i) => {
        const len = Math.max(1, Math.round(barRatio(s.values[i], s.values) * 24));
        return [c, formatChartValue(s.values[i], b.decimals), (s.values[i] < 0 ? "▓" : "█").repeat(len)];
      });
      const nodes: (Paragraph | Table)[] = [para(b.title, { bold: true, size: 19, keepNext: true, after: 60, before: 60 })];
      if (rows.length === 0) nodes.push(para("그릴 값이 없음", { size: 18, color: MUTED }));
      else {
        const w = widths([0.28, 0.17, 0.55]);
        nodes.push(
          new Table({
            width: { size: CONTENT_W, type: WidthType.DXA },
            columnWidths: w,
            layout: TableLayoutType.FIXED,
            rows: rows.map(
              (r) =>
                new TableRow({
                  cantSplit: true,
                  children: [cell(r[0], w[0], {}), cell(r[1], w[1], { align: "right" }), cell(r[2], w[2], {})],
                })
            ),
          })
        );
      }
      if (s.missing.length > 0) nodes.push(para(`※ 값 없음(그리지 않음): ${s.missing.join(", ")}`, { size: 16, color: "92400E", after: 40, before: 40 }));
      nodes.push(...captionParas(b.meta));
      return nodes;
    }
  }
}

function sectionNodes(sec: DocSection): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 150, after: 60 }, children: [run(sec.title, { bold: true, size: 25 })] })];
  sec.blocks.forEach((b, i) => {
    // 표·차트·KPI 바로 앞의 소제목 문장은 그 블록과 같은 쪽에 둔다(제목만 쪽 끝에 남지 않게).
    const next = sec.blocks[i + 1];
    out.push(...blockToNodes(b, b.kind === "text" && !!next && (next.kind === "table" || next.kind === "chart" || next.kind === "kpi")));
  });
  return out;
}

function infoTable(model: ReportModel): Table {
  // 7줄을 한 줄에 두 쌍(라벨·값)씩 4줄로 압축한다 — 일간 보고서가 1~2쪽에 들어가도록 머리 영역을 줄인다.
  const w = widths([0.12, 0.38, 0.12, 0.38]);
  const lines = model.infoLines;
  const labelCell = (t: string, i: number) => new TableCell({ width: { size: w[i], type: WidthType.DXA }, borders: CELL_BORDERS, shading: { type: ShadingType.CLEAR, color: "auto", fill: HEAD_FILL }, margins: { top: 25, bottom: 25, left: 80, right: 80 }, children: [new Paragraph({ spacing: { after: 0 }, children: [run(t, { bold: true, size: 15 })] })] });
  const valueCell = (t: string, i: number) => new TableCell({ width: { size: w[i], type: WidthType.DXA }, borders: CELL_BORDERS, margins: { top: 25, bottom: 25, left: 80, right: 80 }, children: [new Paragraph({ spacing: { after: 0 }, children: [run(t, { size: 15 })] })] });
  const rows: TableRow[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const l = lines[i];
    const r = lines[i + 1];
    rows.push(new TableRow({ cantSplit: true, children: [labelCell(l.label, 0), valueCell(l.value, 1), labelCell(r?.label ?? "", 2), valueCell(r?.value ?? "", 3)] }));
  }
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, rows });
}

export async function renderModelDocx(model: ReportModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 60 }, children: [run(model.title.replace(/(d)-(d)/g, "$1‑$2"), { bold: true, size: 32 })] }),
    para(model.subtitle, { size: 20, color: MUTED, after: 140 }),
    infoTable(model),
    new Paragraph({ spacing: { after: 80 }, children: [] }),
  ];
  for (const sec of model.body) children.push(...sectionNodes(sec));

  if (model.appendix.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        keepNext: true,
        spacing: { after: 60 },
        children: [run("부록 — 상세 통계와 방법", { bold: true, size: 30 })],
      }),
      para("본문의 근거가 되는 상세 표와 방법·한계 주석입니다. 본문과 같은 스냅샷에서 만든 값입니다.", { size: 18, color: MUTED, after: 120 })
    );
    for (const sec of model.appendix) children.push(...sectionNodes(sec));
  }
  children.push(para(`KT ENA 편성 AI Agent · ${model.meta.id}`, { size: 15, color: MUTED, align: AlignmentType.RIGHT, before: 300 }));

  const stamp = `${model.meta.id} · 분석일 ${model.meta.analysis.to} · 생성 ${kstStamp(model.meta.generatedAt)}`;
  const doc = new Document({
    creator: "KT ENA 편성 AI Agent",
    title: model.title,
    description: `ReportSnapshot ${model.meta.id} (${model.meta.versions.calc})`,
    styles: {
      default: { document: { run: { font: FONT, size: 20, color: INK } } },
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1100, bottom: 1000, left: MARGIN, right: MARGIN, header: 480, footer: 480 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(stamp, { size: 14, color: MUTED })] })] }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: MUTED })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
