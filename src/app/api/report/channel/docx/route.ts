// Channel Intelligence Report — Word(.docx) 다운로드(Phase 3, 2026-08-27 / Phase 4, 2026-08-27
// 확장: 기간 리포트 지원). /api/report/channel을 그대로 호출해 같은 JSON을 받는다(값 계산은
// channelReport.ts 한 곳에서만 — 문서 포맷 3종(미리보기/Word/PPT)이 서로 다른 숫자를 보여주는
// 사고를 막기 위함). 이 라우트가 하는 일은 그 JSON을 .docx 문단/표로 배치하는 것뿐이다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import type { ChannelReportData, ChannelPeriodReportData } from "@/lib/channelReport";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 2, color: "E4E4E7" };
function cell(text: string, opts?: { bold?: boolean; color?: string }): TableCell {
  return new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    borders: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts?.bold, color: opts?.color })] })],
  });
}
const FOOTER = new Paragraph({
  spacing: { before: 400 },
  alignment: AlignmentType.RIGHT,
  children: [new TextRun({ text: "KT ENA 편성 AI Agent", italics: true, size: 16, color: "A1A1AA" })],
});

function buildDailyDoc(report: ChannelReportData): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `${report.channel.name} — Channel Intelligence Report`, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `기준일 ${report.asOfDate} · 타깃 ${report.channel.primaryTarget ?? "—"}`, spacing: { after: 300 } }),
  ];
  if (report.health) {
    children.push(new Paragraph({ text: "Health Score", heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: `${report.health.score}점 · ${report.health.label}`, bold: true, size: 32 })] }));
    for (const axis of report.health.axes) children.push(new Paragraph({ text: `· ${axis.label}: ${axis.reason}`, spacing: { after: 60 } }));
  }
  if (report.aiSummary) {
    children.push(new Paragraph({ text: "AI Executive Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    children.push(new Paragraph({ text: report.aiSummary, spacing: { after: 200 } }));
  }
  if (report.kpis.length > 0) {
    children.push(new Paragraph({ text: "스코어 카드", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    const rows = [
      new TableRow({ children: report.kpis.map((k) => cell(k.label, { bold: true })) }),
      new TableRow({
        children: report.kpis.map((k) =>
          cell(`${k.value}${k.deltaLabel ? ` (${k.deltaDirection === "up" ? "▲" : "▼"} ${k.deltaLabel})` : ""}`, {
            color: k.deltaDirection === "up" ? "059669" : k.deltaDirection === "down" ? "e11d48" : undefined,
          })
        ),
      }),
    ];
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  }
  if (report.win || report.weakness) {
    children.push(new Paragraph({ text: "Biggest Win / Weakness", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    if (report.win) children.push(new Paragraph({ text: `▲ WIN — ${report.win.daypartLabel}: 경쟁채널 대비 격차 ${report.win.gapChange >= 0 ? "▲" : "▼"} ${Math.abs(report.win.gapChange).toFixed(4)}(좁혀짐)` }));
    if (report.weakness) children.push(new Paragraph({ text: `▼ WEAKNESS — ${report.weakness.daypartLabel}: 경쟁채널 대비 격차 ${report.weakness.gapChange >= 0 ? "▲" : "▼"} ${Math.abs(report.weakness.gapChange).toFixed(4)}(벌어짐)` }));
  }
  if (report.topPrograms.length > 0) {
    children.push(new Paragraph({ text: "Top Programs", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    for (const p of report.topPrograms) children.push(new Paragraph({ text: `· ${p.name} — ${p.detail}` }));
  }
  if (report.weakPrograms.length > 0) {
    children.push(new Paragraph({ text: "Weak Programs(REPLACE)", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    for (const p of report.weakPrograms) children.push(new Paragraph({ text: `· ${p.name} — ${p.detail}` }));
  }
  if (report.momentum.length > 0) {
    children.push(new Paragraph({ text: "Program Momentum", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    const labelKo = { RISING: "상승세", STABLE: "안정", DECLINING: "하락세" };
    for (const m of report.momentum) children.push(new Paragraph({ text: `· ${m.name} — ${m.momentum.toFixed(2)} (${labelKo[m.label]})` }));
  }
  children.push(FOOTER);
  return children;
}

// Phase 4(2026-08-27) — 기간 리포트(WTD/MTD/QTD/YTD/DoD~YoY/직접 선택). PeriodDocTemplate
// (report/[date]/page.tsx)와 같은 섹션 순서(Executive Summary → 스코어 카드 → Growth/Weakness
// Driver → Daypart Win/Weakness → Top Programs/경쟁 비교).
function buildPeriodDoc(report: ChannelPeriodReportData): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `${report.channel.name} — ${report.periodLabel}`, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `${report.dateFrom} ~ ${report.dateTo}(표본 ${report.daysWithData}일) · 타깃 ${report.channel.primaryTarget ?? "—"}`, spacing: { after: 300 } }),
  ];
  if (report.aiSummary) {
    children.push(new Paragraph({ text: "AI Executive Summary", heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ text: report.aiSummary, spacing: { after: 200 } }));
  }
  if (report.kpis.length > 0) {
    children.push(new Paragraph({ text: "스코어 카드", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    const rows = [
      new TableRow({ children: report.kpis.map((k) => cell(k.label, { bold: true })) }),
      new TableRow({
        children: report.kpis.map((k) => {
          const parts = [k.value];
          if (k.priorDeltaPct !== null) parts.push(`${k.priorDeltaPct >= 0 ? "▲" : "▼"}${Math.abs(k.priorDeltaPct).toFixed(1)}%(${report.comparisonLabel ?? "직전 기간"})`);
          if (k.baselineDeltaPct !== null) parts.push(`${k.baselineDeltaPct >= 0 ? "▲" : "▼"}${Math.abs(k.baselineDeltaPct).toFixed(1)}%(12주 평균)`);
          return cell(parts.join(" "), { color: k.priorDeltaPct !== null ? (k.priorDeltaPct >= 0 ? "059669" : "e11d48") : undefined });
        }),
      }),
    ];
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    if (report.bestDay || report.worstDay) {
      const parts = [];
      if (report.bestDay) parts.push(`최고 ${report.bestDay.date}(${report.bestDay.rating?.toFixed(3) ?? "—"})`);
      if (report.worstDay) parts.push(`최저 ${report.worstDay.date}(${report.worstDay.rating?.toFixed(3) ?? "—"})`);
      children.push(new Paragraph({ text: parts.join(" · "), spacing: { before: 100 } }));
    }
  }
  if (report.growthDrivers.length > 0 || report.weaknessDrivers.length > 0) {
    children.push(new Paragraph({ text: "Growth / Weakness Driver", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    for (const d of report.growthDrivers) children.push(new Paragraph({ text: `▲ GROWTH — ${d.name}: Impact ${d.ratingDelta !== null ? `+${d.ratingDelta.toFixed(3)}` : "—"}` }));
    for (const d of report.weaknessDrivers) children.push(new Paragraph({ text: `▼ WEAKNESS — ${d.name}: Impact ${d.ratingDelta?.toFixed(3) ?? "—"}` }));
  }
  if (report.win || report.weakness) {
    children.push(new Paragraph({ text: "Daypart Win / Weakness", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    if (report.win) children.push(new Paragraph({ text: `▲ WIN — ${report.win.daypartLabel}: 경쟁채널 대비 격차 ${Math.abs(report.win.gapChange).toFixed(4)} 좁혀짐` }));
    if (report.weakness) children.push(new Paragraph({ text: `▼ WEAKNESS — ${report.weakness.daypartLabel}: 경쟁채널 대비 격차 ${Math.abs(report.weakness.gapChange).toFixed(4)} 벌어짐` }));
  }
  if (report.topPrograms.length > 0) {
    children.push(new Paragraph({ text: "Top Programs", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    for (const p of report.topPrograms) children.push(new Paragraph({ text: `· ${p.name} — ${p.detail}` }));
  }
  if (report.competitorTopPrograms.length > 0) {
    children.push(new Paragraph({ text: "경쟁채널 Top Programs", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    for (const p of report.competitorTopPrograms) children.push(new Paragraph({ text: `· ${p.competitorName} — ${p.programName}(${p.rating?.toFixed(3) ?? "—"})` }));
  }
  children.push(FOOTER);
  return children;
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { origin, search, searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.json({ ok: false, message: "code 파라미터가 필요합니다." }, { status: 400 });

  const reportRes = await fetch(`${origin}/api/report/channel${search}`, { headers: { cookie: request.headers.get("cookie") ?? "" } });
  const reportJson = await reportRes.json();
  if (!reportJson.ok) return NextResponse.json({ ok: false, message: reportJson.message ?? "리포트 데이터를 불러오지 못했습니다." }, { status: 404 });

  const isPeriod = reportJson.mode === "period";
  const children = isPeriod ? buildPeriodDoc(reportJson.report) : buildDailyDoc(reportJson.report);
  const dateLabel = isPeriod ? `${reportJson.report.dateFrom}_${reportJson.report.dateTo}` : reportJson.report.asOfDate;

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${code}_${dateLabel}_report.docx"`,
    },
  });
}
