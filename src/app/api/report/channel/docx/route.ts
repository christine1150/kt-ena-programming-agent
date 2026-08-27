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
  const tierSuffix = report.reportTier === "quarterly" ? " — Quarterly Report" : report.reportTier === "annual" ? " — Annual Report" : "";
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `${report.channel.name} — ${report.periodLabel}${tierSuffix}`, heading: HeadingLevel.TITLE }),
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

  // Phase B(2026-08-27) — Quarterly(12섹션)/Annual(15섹션) 확장. report/[date]/page.tsx의
  // PeriodExtendedSections·pptx/route.ts의 확장 슬라이드와 같은 순서·데이터.
  if (report.reportTier !== "standard") {
    if (report.trendSeries.length > 0) {
      children.push(new Paragraph({ text: report.trendGranularity === "week" ? "주별 추이(Weekly Trend)" : "월별 추이(Monthly Trend)", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
      for (const t of report.trendSeries) children.push(new Paragraph({ text: `${t.periodStart}: ${t.rating !== null ? t.rating.toFixed(3) : "—"}` }));
    }
    children.push(new Paragraph({ text: "Turning Points", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    if (report.turningPoints.length > 0) {
      for (const tp of report.turningPoints)
        children.push(
          new Paragraph({ text: `${tp.direction === "up" ? "▲" : "▼"} ${tp.periodStart}: ${tp.fromRating.toFixed(3)} → ${tp.toRating.toFixed(3)} (${tp.changePct >= 0 ? "+" : ""}${tp.changePct.toFixed(1)}%)` })
        );
    } else {
      children.push(new Paragraph({ children: [new TextRun({ text: "이 기간엔 직전 구간 대비 15% 이상 등락한 급변점이 감지되지 않았습니다.", italics: true })] }));
    }
    if (report.portfolioTopPrograms.length > 0 || report.portfolioWeakPrograms.length > 0) {
      children.push(new Paragraph({ text: "Program Portfolio Review", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
      for (const p of report.portfolioTopPrograms) children.push(new Paragraph({ text: `· (Top) ${p.name} — ${p.detail}` }));
      for (const p of report.portfolioWeakPrograms) children.push(new Paragraph({ text: `· (Weak) ${p.name} — ${p.detail}` }));
    }
    if (report.audienceHighlights.length > 0) {
      children.push(new Paragraph({ text: "Audience Composition", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
      for (const a of report.audienceHighlights)
        children.push(new Paragraph({ text: `· ${a.label} — ${a.periodAvgRating !== null ? a.periodAvgRating.toFixed(3) : "—"}${a.deltaPct !== null ? ` (${a.deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(a.deltaPct).toFixed(1)}%)` : ""}` }));
    }
    if (report.reportTier === "annual" && report.quarterlyBreakdown.length > 0) {
      children.push(new Paragraph({ text: "Quarterly Breakdown", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
      for (const q of report.quarterlyBreakdown) children.push(new Paragraph({ text: `Q${q.quarterNum}(${q.dateFrom}~${q.dateTo}): ${q.avgRating !== null ? q.avgRating.toFixed(3) : "—"}` }));
    }
    if (report.reportTier === "annual" && report.annualRank) {
      children.push(new Paragraph({ text: "Annual Rank Snapshot", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
      children.push(
        new Paragraph({
          text: `연초 누적 평균 시청률 ${report.annualRank.avgRating !== null ? report.annualRank.avgRating.toFixed(3) : "—"}${report.annualRank.avgRank !== null ? ` · 평균 순위 ${report.annualRank.avgRank.toFixed(1)}위` : ""}`,
        })
      );
    }
    if (report.reportTier === "annual" && report.newlyScheduledPrograms.length > 0) {
      children.push(new Paragraph({ text: "Year in Review — 신규 편성", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
      for (const p of report.newlyScheduledPrograms) children.push(new Paragraph({ text: `· ${p.name} — ${p.periodAvgRating !== null ? p.periodAvgRating.toFixed(3) : "—"}` }));
    }
    if (report.strategicImplications) {
      children.push(new Paragraph({ text: "Strategic Implications", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
      children.push(new Paragraph({ text: report.strategicImplications, spacing: { after: 200 } }));
    }
    children.push(new Paragraph({ text: "Data Notes & Exclusions", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    children.push(
      new Paragraph({
        text: `표본 ${report.daysWithData}일 기준(Nielsen 시청률 데이터). FUNdex/Content Buzz(접근 경로 없음)와 개인 시청자 단위 이동(패널) 추적은 포함되지 않습니다. Turning Points는 직전 구간 대비 등락률 임계값(±15%) 기반 v1 휴리스틱입니다.`,
      })
    );
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
