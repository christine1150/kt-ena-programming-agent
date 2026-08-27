// Channel Intelligence Report — PPT(.pptx) 다운로드(Phase 3, 2026-08-27 / Phase 4, 2026-08-27
// 확장: 기간 리포트 지원). /api/report/channel을 그대로 호출해 같은 JSON을 받는다(값 계산은
// channelReport.ts 단 한 곳 — docx 라우트와 동일한 이유).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import type { ChannelReportData, ChannelPeriodReportData } from "@/lib/channelReport";
import PptxGenJS from "pptxgenjs";

const NAVY = "1E293B";
const ACCENT = "3A30DF";

function buildDailySlides(pres: PptxGenJS, report: ChannelReportData) {
  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  cover.addText(report.channel.name, { x: 0.6, y: 1.4, w: 8.8, h: 0.9, fontSize: 36, bold: true, color: "FFFFFF" });
  cover.addText(`Channel Intelligence Report · 기준일 ${report.asOfDate}`, { x: 0.6, y: 2.2, w: 8.8, h: 0.5, fontSize: 16, color: "CBD5E1" });
  if (report.health) {
    cover.addText(`${report.health.score}점 · ${report.health.label}`, { x: 0.6, y: 3.0, w: 8.8, h: 0.7, fontSize: 24, bold: true, color: "A5F3FC" });
  }
  cover.addText("KT ENA 편성 AI Agent", { x: 0.6, y: 4.9, w: 8.8, h: 0.4, fontSize: 12, italic: true, color: "94A3B8" });

  if (report.aiSummary) {
    const s = pres.addSlide();
    s.addText("AI Executive Summary", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    s.addText(report.aiSummary, { x: 0.5, y: 1.1, w: 9, h: 4, fontSize: 16, color: "27272A", valign: "top" });
  }

  if (report.kpis.length > 0) {
    const s = pres.addSlide();
    s.addText("스코어 카드", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    const header = report.kpis.map((k) => ({ text: k.label, options: { bold: true, fill: { color: "F4F4F5" }, color: "27272A" } }));
    const values = report.kpis.map((k) => ({
      text: `${k.value}${k.deltaLabel ? `\n${k.deltaDirection === "up" ? "▲" : "▼"} ${k.deltaLabel}` : ""}`,
      options: { color: k.deltaDirection === "up" ? "059669" : k.deltaDirection === "down" ? "E11D48" : "27272A", fontSize: 12 },
    }));
    s.addTable([header, values], { x: 0.5, y: 1.1, w: 9, colW: Array(report.kpis.length).fill(9 / report.kpis.length), fontSize: 14, border: { type: "solid", color: "E4E4E7", pt: 1 } });
  }

  if (report.win || report.weakness) {
    const s = pres.addSlide();
    s.addText("Biggest Win / Weakness", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    let y = 1.2;
    if (report.win) {
      s.addText(`▲ WIN — ${report.win.daypartLabel}`, { x: 0.5, y, w: 9, h: 0.5, fontSize: 18, bold: true, color: "059669" });
      s.addText(`경쟁채널 대비 격차 ${Math.abs(report.win.gapChange).toFixed(4)} 좁혀짐`, { x: 0.5, y: y + 0.5, w: 9, h: 0.4, fontSize: 14, color: "27272A" });
      y += 1.2;
    }
    if (report.weakness) {
      s.addText(`▼ WEAKNESS — ${report.weakness.daypartLabel}`, { x: 0.5, y, w: 9, h: 0.5, fontSize: 18, bold: true, color: "E11D48" });
      s.addText(`경쟁채널 대비 격차 ${Math.abs(report.weakness.gapChange).toFixed(4)} 벌어짐`, { x: 0.5, y: y + 0.5, w: 9, h: 0.4, fontSize: 14, color: "27272A" });
    }
  }

  if (report.topPrograms.length > 0 || report.weakPrograms.length > 0) {
    const s = pres.addSlide();
    s.addText("Top / Weak Programs", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    const y = 1.15;
    if (report.topPrograms.length > 0) {
      s.addText("Top Programs", { x: 0.5, y, w: 4.3, h: 0.4, fontSize: 14, bold: true, color: "059669" });
      s.addText(report.topPrograms.map((p) => `${p.name} — ${p.detail}`).join("\n"), { x: 0.5, y: y + 0.4, w: 4.3, h: 3, fontSize: 12, color: "27272A", valign: "top" });
    }
    if (report.weakPrograms.length > 0) {
      s.addText("Weak Programs(REPLACE)", { x: 5.1, y, w: 4.3, h: 0.4, fontSize: 14, bold: true, color: "E11D48" });
      s.addText(report.weakPrograms.map((p) => `${p.name} — ${p.detail}`).join("\n"), { x: 5.1, y: y + 0.4, w: 4.3, h: 3, fontSize: 12, color: "27272A", valign: "top" });
    }
  }

  if (report.momentum.length > 0) {
    const labelKo = { RISING: "상승세", STABLE: "안정", DECLINING: "하락세" };
    const s = pres.addSlide();
    s.addText("Program Momentum", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    const rows = report.momentum.map((m) => [
      { text: m.name, options: { fontSize: 13 } },
      { text: m.momentum.toFixed(2), options: { fontSize: 13, align: "right" as const } },
      { text: labelKo[m.label], options: { fontSize: 13, color: m.label === "RISING" ? "059669" : m.label === "DECLINING" ? "E11D48" : "71717A" } },
    ]);
    s.addTable(rows, { x: 0.5, y: 1.1, w: 9, colW: [5.5, 2, 1.5], fontSize: 13, border: { type: "solid", color: "E4E4E7", pt: 1 } });
  }
}

// Phase 4(2026-08-27) — 기간 리포트(WTD/MTD/QTD/YTD/DoD~YoY/직접 선택). PeriodSlideTemplate
// (report/[date]/page.tsx)와 같은 슬라이드 순서.
function buildPeriodSlides(pres: PptxGenJS, report: ChannelPeriodReportData) {
  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  cover.addText(report.channel.name, { x: 0.6, y: 1.4, w: 8.8, h: 0.9, fontSize: 36, bold: true, color: "FFFFFF" });
  cover.addText(`${report.periodLabel} · ${report.dateFrom} ~ ${report.dateTo}`, { x: 0.6, y: 2.2, w: 8.8, h: 0.5, fontSize: 16, color: "CBD5E1" });
  cover.addText("KT ENA 편성 AI Agent", { x: 0.6, y: 4.9, w: 8.8, h: 0.4, fontSize: 12, italic: true, color: "94A3B8" });

  if (report.aiSummary) {
    const s = pres.addSlide();
    s.addText("AI Executive Summary", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    s.addText(report.aiSummary, { x: 0.5, y: 1.1, w: 9, h: 4, fontSize: 16, color: "27272A", valign: "top" });
  }

  if (report.kpis.length > 0) {
    const s = pres.addSlide();
    s.addText("스코어 카드", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    const header = report.kpis.map((k) => ({ text: k.label, options: { bold: true, fill: { color: "F4F4F5" }, color: "27272A" } }));
    const values = report.kpis.map((k) => {
      const lines = [k.value];
      if (k.priorDeltaPct !== null) lines.push(`${k.priorDeltaPct >= 0 ? "▲" : "▼"} ${Math.abs(k.priorDeltaPct).toFixed(1)}%(${report.comparisonLabel ?? "직전 기간"})`);
      if (k.baselineDeltaPct !== null) lines.push(`${k.baselineDeltaPct >= 0 ? "▲" : "▼"} ${Math.abs(k.baselineDeltaPct).toFixed(1)}%(12주 평균)`);
      return { text: lines.join("\n"), options: { color: k.priorDeltaPct !== null ? (k.priorDeltaPct >= 0 ? "059669" : "E11D48") : "27272A", fontSize: 11 } };
    });
    s.addTable([header, values], { x: 0.5, y: 1.1, w: 9, colW: Array(report.kpis.length).fill(9 / report.kpis.length), fontSize: 13, border: { type: "solid", color: "E4E4E7", pt: 1 } });
  }

  if (report.growthDrivers.length > 0 || report.weaknessDrivers.length > 0) {
    const s = pres.addSlide();
    s.addText("Growth / Weakness Driver", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    const rows = [
      ...report.growthDrivers.map((d) => [
        { text: "GROWTH", options: { fontSize: 12, bold: true, color: "059669" } },
        { text: d.name, options: { fontSize: 12 } },
        { text: d.ratingDelta !== null ? `+${d.ratingDelta.toFixed(3)}` : "—", options: { fontSize: 12, align: "right" as const, color: "059669" } },
      ]),
      ...report.weaknessDrivers.map((d) => [
        { text: "WEAKNESS", options: { fontSize: 12, bold: true, color: "E11D48" } },
        { text: d.name, options: { fontSize: 12 } },
        { text: d.ratingDelta !== null ? d.ratingDelta.toFixed(3) : "—", options: { fontSize: 12, align: "right" as const, color: "E11D48" } },
      ]),
    ];
    s.addTable(rows, { x: 0.5, y: 1.1, w: 9, colW: [1.8, 5.2, 2], fontSize: 12, border: { type: "solid", color: "E4E4E7", pt: 1 } });
  }

  if (report.win || report.weakness) {
    const s = pres.addSlide();
    s.addText("Daypart Win / Weakness", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    let y = 1.2;
    if (report.win) {
      s.addText(`▲ WIN — ${report.win.daypartLabel}`, { x: 0.5, y, w: 9, h: 0.5, fontSize: 18, bold: true, color: "059669" });
      y += 0.7;
    }
    if (report.weakness) {
      s.addText(`▼ WEAKNESS — ${report.weakness.daypartLabel}`, { x: 0.5, y, w: 9, h: 0.5, fontSize: 18, bold: true, color: "E11D48" });
    }
  }

  if (report.topPrograms.length > 0 || report.competitorTopPrograms.length > 0) {
    const s = pres.addSlide();
    s.addText("Top Programs / 경쟁 비교", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    const y = 1.15;
    if (report.topPrograms.length > 0) {
      s.addText("Top Programs", { x: 0.5, y, w: 4.3, h: 0.4, fontSize: 14, bold: true, color: "059669" });
      s.addText(report.topPrograms.map((p) => `${p.name} — ${p.detail}`).join("\n"), { x: 0.5, y: y + 0.4, w: 4.3, h: 3, fontSize: 12, color: "27272A", valign: "top" });
    }
    if (report.competitorTopPrograms.length > 0) {
      s.addText("경쟁채널 Top Programs", { x: 5.1, y, w: 4.3, h: 0.4, fontSize: 14, bold: true, color: "71717A" });
      s.addText(
        report.competitorTopPrograms.map((p) => `${p.competitorName} — ${p.programName}(${p.rating?.toFixed(3) ?? "—"})`).join("\n"),
        { x: 5.1, y: y + 0.4, w: 4.3, h: 3, fontSize: 12, color: "27272A", valign: "top" }
      );
    }
  }
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

  const pres = new PptxGenJS();
  pres.defineLayout({ name: "REPORT", width: 10, height: 5.625 });
  pres.layout = "REPORT";

  const isPeriod = reportJson.mode === "period";
  if (isPeriod) buildPeriodSlides(pres, reportJson.report);
  else buildDailySlides(pres, reportJson.report);
  const dateLabel = isPeriod ? `${reportJson.report.dateFrom}_${reportJson.report.dateTo}` : reportJson.report.asOfDate;

  const data = (await pres.write({ outputType: "nodebuffer" })) as Buffer;

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${code}_${dateLabel}_report.pptx"`,
    },
  });
}
