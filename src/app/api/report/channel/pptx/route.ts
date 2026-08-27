// Channel Intelligence Report — PPT(.pptx) 다운로드(Phase 3, 2026-08-27, 사용자 지시).
// docx 라우트와 마찬가지로 buildChannelReportData 결과만 슬라이드로 배치할 뿐 숫자를 다시
// 계산하지 않는다(값 계산은 channelReport.ts 단 한 곳).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildChannelReportData, type ChannelReportData } from "@/lib/channelReport";
import PptxGenJS from "pptxgenjs";

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

const NAVY = "1E293B";
const ACCENT = "3A30DF";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const date = searchParams.get("date");
  if (!code || !date) return NextResponse.json({ ok: false, message: "code, date 파라미터가 필요합니다." }, { status: 400 });

  const report = await fetchReportData(origin, code, date, request.headers.get("cookie") ?? "");
  if (!report) return NextResponse.json({ ok: false, message: "리포트 데이터를 불러오지 못했습니다." }, { status: 404 });

  const pres = new PptxGenJS();
  pres.defineLayout({ name: "REPORT", width: 10, height: 5.625 });
  pres.layout = "REPORT";

  // 표지 슬라이드 — 채널명·기준일·Health Score.
  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  cover.addText(report.channel.name, { x: 0.6, y: 1.4, w: 8.8, h: 0.9, fontSize: 36, bold: true, color: "FFFFFF" });
  cover.addText(`Channel Intelligence Report · 기준일 ${report.asOfDate}`, { x: 0.6, y: 2.2, w: 8.8, h: 0.5, fontSize: 16, color: "CBD5E1" });
  if (report.health) {
    cover.addText(`${report.health.score}점 · ${report.health.label}`, { x: 0.6, y: 3.0, w: 8.8, h: 0.7, fontSize: 24, bold: true, color: "A5F3FC" });
  }
  cover.addText("KT ENA 편성 AI Agent", { x: 0.6, y: 4.9, w: 8.8, h: 0.4, fontSize: 12, italic: true, color: "94A3B8" });

  // AI Executive Summary
  if (report.aiSummary) {
    const s = pres.addSlide();
    s.addText("AI Executive Summary", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    s.addText(report.aiSummary, { x: 0.5, y: 1.1, w: 9, h: 4, fontSize: 16, color: "27272A", valign: "top" });
  }

  // KPI 스코어카드
  if (report.kpis.length > 0) {
    const s = pres.addSlide();
    s.addText("KPI 스코어카드", { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
    const header = report.kpis.map((k) => ({ text: k.label, options: { bold: true, fill: { color: "F4F4F5" }, color: "27272A" } }));
    const values = report.kpis.map((k) => ({
      text: `${k.value}${k.deltaLabel ? `\n${k.deltaDirection === "up" ? "▲" : "▼"} ${k.deltaLabel}` : ""}`,
      options: { color: k.deltaDirection === "up" ? "059669" : k.deltaDirection === "down" ? "E11D48" : "27272A", fontSize: 12 },
    }));
    s.addTable([header, values], { x: 0.5, y: 1.1, w: 9, colW: Array(report.kpis.length).fill(9 / report.kpis.length), fontSize: 14, border: { type: "solid", color: "E4E4E7", pt: 1 } });
  }

  // Biggest Win / Weakness
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

  // Top / Weak Programs
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

  // Program Momentum
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

  const data = (await pres.write({ outputType: "nodebuffer" })) as Buffer;

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${report.channel.code}_${report.asOfDate}_report.pptx"`,
    },
  });
}
