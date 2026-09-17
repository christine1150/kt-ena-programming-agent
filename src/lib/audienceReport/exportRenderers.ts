// N절 Phase 2a(2026-09-01) — FlatReport(reportFlatten.ts) → Word(.docx) / PPT(.pptx) 렌더러.
// 두 렌더러 모두 "블록을 그리는 법"만 안다 — 어떤 섹션에 어떤 값을 넣을지는 reportFlatten.ts
// 한 곳에서만 정한다(구 시스템은 이 결정이 docx/pptx에 각각 하드코딩돼 있어 조용히 갈라졌다).
// Word(.docx)의 색·여백은 구 시스템(/api/report/channel/docx)의 스타일을 그대로 승계한다.
// PPT(.pptx)는 사용자 지시(2026-09-08)로 ENA 디자인 시스템(enaPptTheme.ts)으로 전면 교체됐다 —
// 이 파일의 PPT 쪽은 색·여백·타이포를 직접 정하지 않고 그 테마 함수만 조합한다.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";
import PptxGenJS from "pptxgenjs";
import type { FlatReport, DocBlock } from "./reportFlatten";
// 슬라이드 분할(무엇이 몇 번째 장인지)은 이 렌더러가 정하지 않는다 — 브라우저 미리보기와
// 같은 계획을 써야 "화면에서 본 것과 받은 파일이 다르다"는 사고가 없다(2026-09-17).
import { planReportPpt, omitEmptyBlocks } from "./pptSlidePlan";
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
  // 사용자 지시 — 데이터가 없어 분석할 수 없는 항목은 "데이터 없음"이라고 적지 말고 항목 자체를
  // 뺀다. Word·PPT가 같은 규칙을 쓰도록 같은 함수(omitEmptyBlocks)를 통과시킨다.
  const doc = omitEmptyBlocks(flat);
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: doc.subtitle, spacing: { after: 300 } }),
  ];
  for (const section of doc.sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } }));
    for (const block of section.blocks) children.push(...docxBlock(block));
  }
  children.push(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "KT ENA 편성 AI Agent", italics: true, size: 16, color: "A1A1AA" })] }));
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

// ---------------- PPT ----------------
// 사용자 지시(2026-09-08): "2페이지 각 채널에서 PPT를 만들면 ena-design 스킬과 제작 방식을
// 활용해서 PPT를 만들도록" — 이 렌더러는 enaPptTheme.ts의 ENA 디자인 시스템 위에서만 그린다.
// 색·여백·타이포를 여기서 직접 정하지 않는다.
// 2026-09-17 — 별도로 있던 "6~9장 임원 요약 덱" 렌더러(renderDeckPptx)는 제거했다. 보고서는
// 채널/종합 각각 Word·PPT 4종뿐이고, PPT 미리보기도 이 상세 렌더러와 같은 계획을 그린다.
type PptSlide = ReturnType<PptxGenJS["addSlide"]>;

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

  // 장 구성은 planReportPpt가 단독으로 정한다 — 브라우저 미리보기(pptPreview.tsx)가 같은 함수를
  // 호출하므로 두 곳의 슬라이드 순서·장수·표 분할이 구조적으로 어긋날 수 없다.
  for (const slide of planReportPpt(flat)) {
    if (slide.kind === "cover") {
      ena.addCoverSlide(pres, theme, {
        eyebrow: slide.eyebrow,
        title: slide.title,
        subtitle: slide.subtitle,
        dateLabel: slide.dateLabel,
        author: slide.author,
      });
      continue;
    }
    if (slide.kind === "eod") {
      ena.addEodSlide(pres, theme);
      continue;
    }
    const s = ena.addContentSlide(pres, theme, slide.eyebrow, slide.title, { titlePx: 38 });
    if (slide.caption) ena.addCaption(s, slide.caption, ena.CONTENT_Y - ena.px(30));
    renderPptBlock(s, slide.block, theme);
  }

  // pptxgenjs의 write()는 환경에 따라 string|Buffer|Blob을 반환한다 — Node 런타임에서는 nodebuffer로 강제한다.
  return (await pres.write({ outputType: "nodebuffer" })) as Buffer;
}

function addPptTable(s: PptSlide, headers: string[], rows: string[][]) {
  const header = headers.map((h) => ena.enaTableHeaderCell(h));
  const body = rows.map((r) => r.map((c) => ({ text: c, options: { color: ena.GRAY_800, fontFace: ena.FONT_MEDIUM } })));
  s.addTable([header, ...body], { x: ena.BODY_X, y: ena.CONTENT_Y, w: ena.BODY_W, ...ena.enaTableOptions() });
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
