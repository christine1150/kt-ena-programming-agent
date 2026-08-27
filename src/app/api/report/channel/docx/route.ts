// Channel Intelligence Report — Word(.docx) 다운로드(Phase 3, 2026-08-27, 사용자 지시:
// "워드와 PPT 형태를 사용자 요청에 따라 먼저 만들고..."). /api/report/channel과 완전히 같은
// 조립 로직(buildChannelReportData)을 그대로 다시 호출한다 — 문서 포맷 3종(Word/PPT/PDF)이
// 서로 다른 숫자를 보여주는 사고를 막기 위해 값 계산은 단 한 곳(channelReport.ts)에서만 한다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildChannelReportData, type ChannelReportData } from "@/lib/channelReport";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";

async function fetchReportData(origin: string, code: string, date: string, cookie: string): Promise<ChannelReportData | null> {
  const forward = { headers: { cookie } };
  const dashboardRes = await fetch(`${origin}/api/dashboard/channel?code=${code}&date=${date}`, forward);
  const dashboardJson = await dashboardRes.json();
  if (!dashboardJson.ok || !dashboardJson.asOfDate) return null;

  const fitScoreRes = await fetch(`${origin}/api/scheduling/fit-score?code=${code}&date=${date}`, forward);
  const fitScoreJson = await fitScoreRes.json();
  const fitScoreItems = fitScoreJson.ok ? (fitScoreJson.items ?? []) : [];

  const programIds = fitScoreItems.map((f: { program_id: string }) => f.program_id).filter(Boolean);
  let momentumItems: { program_id: string; momentum: number | null; label: "RISING" | "STABLE" | "DECLINING" | null }[] = [];
  if (programIds.length > 0) {
    const momentumRes = await fetch(`${origin}/api/scheduling/program-momentum?code=${code}&program_ids=${programIds.join(",")}&date=${date}`, forward);
    const momentumJson = await momentumRes.json();
    if (momentumJson.ok) momentumItems = momentumJson.items ?? [];
  }

  return buildChannelReportData(
    { code: dashboardJson.channel.code, name: dashboardJson.channel.name, primaryTarget: dashboardJson.channel.primaryTarget, market: dashboardJson.channel.market },
    dashboardJson.asOfDate,
    {
      trend: dashboardJson.trend ?? [],
      narrativeSignal: dashboardJson.narrativeSignal ?? null,
      rootCauseAlert: dashboardJson.rootCauseAlert ?? null,
      opportunityAlert: dashboardJson.opportunityAlert ?? null,
      daypartOpportunity: dashboardJson.daypartOpportunity ?? [],
      topPrograms: dashboardJson.topPrograms ?? [],
      briefingLlm: dashboardJson.briefingLlm ?? null,
    },
    fitScoreItems,
    momentumItems
  );
}

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 2, color: "E4E4E7" };
function cell(text: string, opts?: { bold?: boolean; color?: string }): TableCell {
  return new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    borders: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts?.bold, color: opts?.color })] })],
  });
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const date = searchParams.get("date");
  if (!code || !date) return NextResponse.json({ ok: false, message: "code, date 파라미터가 필요합니다." }, { status: 400 });

  const report = await fetchReportData(origin, code, date, request.headers.get("cookie") ?? "");
  if (!report) return NextResponse.json({ ok: false, message: "리포트 데이터를 불러오지 못했습니다." }, { status: 404 });

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `${report.channel.name} — Channel Intelligence Report`, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `기준일 ${report.asOfDate} · 타깃 ${report.channel.primaryTarget ?? "—"}`, spacing: { after: 300 } }),
  ];

  if (report.health) {
    children.push(new Paragraph({ text: "Health Score", heading: HeadingLevel.HEADING_1 }));
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: `${report.health.score}점 · ${report.health.label}`, bold: true, size: 32 })],
      })
    );
    for (const axis of report.health.axes) {
      children.push(new Paragraph({ text: `· ${axis.label}: ${axis.reason}`, spacing: { after: 60 } }));
    }
  }

  if (report.aiSummary) {
    children.push(new Paragraph({ text: "AI Executive Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    children.push(new Paragraph({ text: report.aiSummary, spacing: { after: 200 } }));
  }

  if (report.kpis.length > 0) {
    children.push(new Paragraph({ text: "KPI 스코어카드", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    const rows = [
      new TableRow({ children: report.kpis.map((k) => cell(k.label, { bold: true })) }),
      new TableRow({
        children: report.kpis.map((k) => cell(`${k.value}${k.deltaLabel ? ` (${k.deltaDirection === "up" ? "▲" : "▼"} ${k.deltaLabel})` : ""}`, { color: k.deltaDirection === "up" ? "059669" : k.deltaDirection === "down" ? "e11d48" : undefined })),
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

  children.push(
    new Paragraph({
      spacing: { before: 400 },
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "KT ENA 편성 AI Agent", italics: true, size: 16, color: "A1A1AA" })],
    })
  );

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${report.channel.code}_${report.asOfDate}_report.docx"`,
    },
  });
}
