// 단계 14 — 웹·Word·PPT·PDF 공통 보고서(ReportSnapshot) 테스트. 테스트 프레임워크 없이 tsx로 실행하며 운영 DB·네트워크에 접근하지 않는다.
// 실행: npm run test:report-snapshot
//
// 검증 방식: 합성 문서(저장소에 실데이터를 넣지 않음)로 스냅샷→모델→덱 계획→실제 .docx/.pptx 바이트를 만들고,
// 파일을 풀어(zip) 안의 글자에서 핵심값·기간·문장·판단 ID가 형식 사이에 같은지 확인한다. 실제 Word·PowerPoint 렌더(글자 잘림·쪽 나눔 등)는
// 이 테스트가 아니라 PROGRESS.md의 렌더 검증 기록(사람이 이미지로 확인)에 둔다.
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** 주석을 뺀 코드 — 주석에 함수 이름이 나오는 것은 호출이 아니다 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

type ChannelDoc = import("../src/lib/audienceReport/reportModel").AudienceReportDocument;
type PortfolioDoc = import("../src/lib/audienceReport/portfolioModel").PortfolioReportDocument;

async function zipText(buf: Buffer, files: RegExp): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts: string[] = [];
  for (const name of Object.keys(zip.files).filter((n) => files.test(n)).sort()) parts.push(await zip.files[name].async("string"));
  return parts.join("\n");
}
const decode = (x: string) => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const docxText = (xml: string) => decode(xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, ""));
const pptxText = (xml: string) => decode([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("\n"));

async function main() {
  const CAD = await import("../src/lib/reportSnapshot/cadence");
  const BUILD = await import("../src/lib/reportSnapshot/build");
  const TPL = await import("../src/lib/reportSnapshot/template");
  const DECK = await import("../src/lib/reportSnapshot/deckPlan");
  const DOCX = await import("../src/lib/reportSnapshot/renderDocx");
  const PPTX = await import("../src/lib/reportSnapshot/renderPptx");
  const STORE = await import("../src/lib/reportSnapshot/store");
  const BRIEF = await import("../src/lib/reportSnapshot/purchaseBrief");
  const COMMON = await import("../src/lib/reportSnapshot/renderCommon");
  const D = await import("../src/lib/audienceReport/portfolioDecisions");
  const PO = await import("../src/lib/audienceReport/portfolioPolicy");
  const PR = await import("../src/lib/audienceReport/periodResolver");
  const GJ = await import("../src/lib/audienceReport/gaejosik");
  const RM = await import("../src/lib/audienceReport/reportModel");
  const FL = await import("../src/lib/audienceReport/reportFlatten");

  // ───────────── 합성 문서 ─────────────
  const off = (reason = "자료 없음") => ({ available: false as const, reason });
  const caption = { periodLabel: "p", targetUniverse: "t", measure: "m" };
  const deepDive = () => ({
    notice: { primeLabel: "평일 19~23시", holidays: [], programCount: 3, airings: 12, minAiringsForRanking: 3 },
    efficiencyRanking: off(), lowSlotStandouts: off(), primeGap: off(), programProfiles: off(), scheduleCanvas: off(), originalRerun: off(), firstRunEfficiency: off(),
  });
  const rec = (from: string, to: string) => ({
    title: "지난주 → 이번주 편성 제언",
    referenceWindow: { dateFrom: from, dateTo: to },
    channelFlow: { trend: [], weekdayFlow: [{ dowLabel: "월", avgRating: 0.3 }, { dowLabel: "토", avgRating: 0.4 }] },
    programFlow: off(), lineupTransitions: off(), slotDiagnosis: [],
    recommendations: [
      { basis: "20시 시간대 격차가 벌어졌습니다", suggestion: "해당 시간대 편성을 점검하세요", verification: "다음 주 같은 시간대 격차를 확인하세요" },
      { basis: "예능A 시청률이 올랐습니다", suggestion: "현재 편성을 유지합니다", verification: "다음 방영 회차를 확인합니다" },
    ],
  });
  const ctxOf = (aggregation: string, expected: number, present: number, cutoff: string) => ({ aggregation, targetLabel: "개인2049", knowledgeCutoff: cutoff, coverage: { expectedDays: expected, presentDays: present, missingDates: [], complete: present >= expected } });
  const AI_TEXT = "이번 기간 ENA는 평균 0.512를 기록했습니다.";
  const common = {
    channelCode: "ENA", channelName: "ENA", themeColor: null, groupCode: "A" as const, groupLabel: "수도권 2049",
    masterInfo: { targetRating: 0.2, targetRank: null }, qualityIssues: [], aiSummary: AI_TEXT as string | null,
  };
  const kpis = [
    { label: "Rating", formatted: "0.512", priorDeltaPct: -12.3, baselineDeltaPct: null },
    { label: "Share", formatted: "1.20%", priorDeltaPct: 3.4, baselineDeltaPct: null },
    { label: RM.RANK_KPI_LABEL, formatted: "41위", priorDeltaPct: null, baselineDeltaPct: null },
  ];
  const slotRows = (n: number) => Array.from({ length: n }, (_, i) => ({ hour: 14 + i, programNames: `프로그램${i}`, todayRating: 0.3 + i / 100, baselineRating: 0.25, deviationPct: 10 + i }));
  const compRows = (n: number) => Array.from({ length: n }, (_, i) => ({ competitorName: `경쟁${i}`, todayRank: i + 1, todayRating: 0.4, baselineAvgRating: 0.4, deltaPct: 1, topProgramName: `대표${i}`, topProgramStartTime: "20:00", topProgramRating: 0.5 }));
  const crossOff = { skyUhd: off(), targetHourlyPattern: off(), programAudienceCross: off(), competitorScheduleChanges: off(), deepDive: deepDive() };

  const dailyDoc = {
    ...common,
    period: PR.resolveSingleDay("2026-10-04"),
    body: {
      mode: "single_day",
      sections: {
        verdict: { label: "평소 대비 낮은 편" }, kpiCards: kpis,
        hourlyProfile: { available: true, data: { points: [{ hour: 20, todayRating: 0.4, baselineRating: 0.5, programNames: "A" }, { hour: 21, todayRating: 0.6, baselineRating: 0.5, programNames: "B" }, { hour: 22, todayRating: null, baselineRating: 0.5, programNames: "C" }], caption } },
        programsBySlotDeviation: { available: true, data: { top: slotRows(5), bottom: slotRows(5) } },
        originalReview: off(), enaLiveAiring: off(), audienceReaction: off(), competitorSameSlot: { available: true, data: compRows(8) },
        thingsToVerify: ["확인할 것 1", "확인할 것 2"], ...crossOff, healthScore: off(), programMomentum: off(),
      },
    },
    recommendation: rec("2026-09-28", "2026-10-04"),
    metricContext: ctxOf("single_day", 1, 1, "2026-10-04"), dataSnapshotId: "ms-aaaaaaaa",
  } as unknown as ChannelDoc;

  const trendPts = Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${28 + (i % 3)}`.replace("2026-09-30", "2026-09-30"), rating: i === 3 ? null : 0.3 + i / 100, movingAvg: null }));
  const mover = (n: string) => ({ canonicalName: n, periodAvgRating: 0.4, priorAvgRating: 0.3, ratingDelta: 0.1, periodAirCount: 3 });
  const rangeDoc = (from: string, to: string, expected: number, present: number, aiSummary: string | null = AI_TEXT) =>
    ({
      ...common, aiSummary,
      period: PR.resolveRange(from, to),
      body: {
        mode: "range",
        sections: {
          summary: { avgRating: 0.31, shape: "횡보" }, kpiCards: kpis, dailyTrend: { points: trendPts, caption },
          weekdayHourHeatmap: off(), originalReview: off(), enaLiveAiring: off(),
          programContribution: { available: true, data: { growth: [mover("성장작")], weakness: [mover("약세작")] } },
          audienceComposition: off(), bestWorstDay: off(), structuralVerdict: { label: "일시적 변동으로 판단" }, ...crossOff,
        },
      },
      recommendation: rec(from, to),
      metricContext: ctxOf("daily_mean_provisional", expected, present, to), dataSnapshotId: "ms-bbbbbbbb",
    }) as unknown as ChannelDoc;
  const weeklyDoc = rangeDoc("2026-09-28", "2026-10-04", 7, 6);
  const monthlyDoc = rangeDoc("2026-09-01", "2026-09-30", 30, 30);

  // 포트폴리오
  const pPeriod = { ...PR.resolveRange("2026-09-28", "2026-10-04") };
  const item = (code: string, kind: NonNullable<import("../src/lib/audienceReport/portfolioModel").ChannelActionItem["kind"]>, subject: string, urgent: boolean) => ({ channelCode: code, channelName: code, kind, subject, urgent, basis: `${subject} 근거 문장입니다`, suggestion: "제안 문장", verification: "다음 기간 추이를 확인합니다" });
  const acts = (code: string, items: ReturnType<typeof item>[]) => ({ channelCode: code, channelName: code, items, priorityScore: items.filter((i) => i.urgent).length });
  const actionsByChannel = [
    acts("ENA", [item("ENA", "program_up", "예능A", false)]),
    acts("ENA_DRAMA", [item("ENA_DRAMA", "program_down", "드라마B", true), item("ENA_DRAMA", "daypart_weak", "20~23시", true)]),
    acts("ENA_PLAY", [item("ENA_PLAY", "daypart_weak", "14~17시", true)]),
    acts("OLIFE", [item("OLIFE", "program_down", "다큐C", true)]),
    acts("ONCE", []), acts("ENA_STORY", []), acts("SKYUHD", []),
  ];
  const peer = (code: string, trend: number | null) => ({ channelCode: code, channelName: code, level: 0.1, formattedLevel: "0.114", trend, reach: 1.1, targetRating: 0.18, hourlyPattern: [], trendSeries: [] });
  const edge = { canonicalName: "작품X", relation: "rerun" as const, fromChannelCode: "ENA", fromChannelName: "ENA", fromRating: 0.2, toChannelCode: "ENA_PLAY", toChannelName: "ENA Play", toRating: 0.05, retentionPct: 25 };
  const decisions = D.buildExecutiveDecisions(actionsByChannel as never, { period: { dateFrom: "2026-09-28", dateTo: "2026-10-04", label: "2026-09-28 ~ 2026-10-04" } });
  const mkPortfolio = (o: { pipeline?: boolean; decisions?: boolean; ai?: string | null; rights?: boolean } = {}) =>
    ({
      period: pPeriod,
      deepCompare: {
        primeLabel: "평일 19~23시", holidays: [], observations: ["Group A에서는 ENA가 주요시간 배율이 가장 높음"],
        rows: [
          { channelCode: "ENA", channelName: "ENA", groupCode: "A", primeAirtimePct: 40, primeAvgRating: 0.3, offPrimeAvgRating: 0.1, primeRatio: 3, weekdayAvgRating: 0.2, weekendAvgRating: 0.1, avgReach: 1, avgTimeSpentShare: 5 },
          { channelCode: "ONCE", channelName: "ONCE", groupCode: "B", primeAirtimePct: 30, primeAvgRating: 0.2, offPrimeAvgRating: 0.1, primeRatio: 2, weekdayAvgRating: 0.2, weekendAvgRating: 0.1, avgReach: 1, avgTimeSpentShare: 5 },
        ],
      },
      groupA: { code: "A", label: "수도권 2049", oneLiner: "수도권 2049 3개 채널, 평균 ▲14.4%", peers: [peer("ENA", -0.3), peer("ENA_DRAMA", 65.4), peer("ENA_PLAY", null)], commonPattern: { direction: null, channelCodes: [], label: "" }, opportunities: [], pipeline: o.pipeline === false ? [] : [edge] },
      groupB: { code: "B", label: "전국 유료가구", oneLiner: "전국 유료가구 4개 채널, 평균 ▼17.1%", peers: [peer("ONCE", -31.9), peer("OLIFE", -21.2)], commonPattern: { direction: "down", channelCodes: ["ONCE", "OLIFE"], label: "2개 채널이 함께 하락했습니다" }, opportunities: [], skyUhd: null },
      slotOverlap: D.classifySlotOverlap([{ dow: 1, dowLabel: "월", hour: 22, canonicalName: "다른작품", channelCodes: ["ENA", "ENA_DRAMA"] }], [edge]),
      actionsByChannel, isolationOk: true, aiSummary: o.ai === undefined ? "이번 주 7채널 종합은 그룹별로 다르게 움직였습니다." : o.ai,
      executiveDecisions: o.decisions === false ? [] : decisions,
      channelPolicies: PO.buildChannelPolicyViews("2026-10-04", { ENA: "ENA" }),
      rights: o.rights === false ? null : { tablesApplied: true, configured: true, asOf: "2026-10-04", windowDays: 60, expiring: [{ grantId: "g1", title: "만료 임박작", channels: "ENA", end: "2026-10-20", daysLeft: 16 }], expiringTotal: 1, endedStillListed: 0, finiteCountGrants: 0, baselineUnknown: 0, notes: [] },
      concentration: [{ channelCode: "ENA", channelName: "ENA", programCount: 4, top1Name: "A", top1SharePct: 50, top3SharePct: 87.5 }],
      skyUhdCoverage: null, groupMetrics: { A: { groupCode: "A", method: "m", avgTrendPct: 14.4, includedChannels: ["ENA"], excludedChannels: [] }, B: { groupCode: "B", method: "m", avgTrendPct: -17.1, includedChannels: ["ONCE"], excludedChannels: [] } },
      metricContext: ctxOf("daily_mean_provisional", 7, 7, "2026-10-04"), dataSnapshotId: "ms-cccccccc",
    }) as unknown as PortfolioDoc;
  const portfolioDoc = mkPortfolio();

  const T0 = "2026-10-07T05:10:00.000Z";
  const snapDaily = BUILD.buildChannelSnapshot(dailyDoc, { generatedAt: T0 });
  const snapWeekly = BUILD.buildChannelSnapshot(weeklyDoc, { generatedAt: T0 });
  const snapMonthlyBase = BUILD.buildChannelSnapshot(monthlyDoc, { generatedAt: T0 });

  // ═════════ 1. 용도와 이름(같은 날짜의 일간·주간) ═════════
  {
    const day = { mode: "single_day", dateFrom: "2026-10-04", dateTo: "2026-10-04" };
    const week = { mode: "range", dateFrom: "2026-09-28", dateTo: "2026-10-04" };
    const month = { mode: "range", dateFrom: "2026-09-01", dateTo: "2026-09-30" };
    check("하루는 일간, 7일은 주간, 28~31일은 월간, 그 밖은 기간 보고서", CAD.cadenceOf(day) === "daily" && CAD.cadenceOf(week) === "weekly" && CAD.cadenceOf(month) === "monthly" && CAD.cadenceOf({ mode: "range", dateFrom: "2026-07-01", dateTo: "2026-09-30" }) === "period");
    check("누적 프리셋은 프리셋이 말하는 용도를 따른다(WTD=주간, MTD=월간, QTD=기간)", CAD.cadenceOf({ mode: "cumulative", dateFrom: "2026-10-01", dateTo: "2026-10-01" }, "wtd") === "weekly" && CAD.cadenceOf({ mode: "cumulative", dateFrom: "2026-10-01", dateTo: "2026-10-04" }, "mtd") === "monthly" && CAD.cadenceOf({ mode: "cumulative", dateFrom: "2026-07-01", dateTo: "2026-10-04" }, "qtd") === "period");
    check("같은 날짜(10-04)의 일간과 주간은 이름·파일명·스냅샷 ID가 모두 다르다", snapDaily.name !== snapWeekly.name && snapDaily.fileStem !== snapWeekly.fileStem && snapDaily.id !== snapWeekly.id, `${snapDaily.name} | ${snapWeekly.name}`);
    check("이름에 용도와 기간(요일 포함)이 들어간다", snapDaily.name === "일간 보고서 · ENA · 2026-10-04(일)" && snapWeekly.name === "주간 보고서 · ENA · 2026-09-28(월) ~ 2026-10-04(일)", `${snapDaily.name} | ${snapWeekly.name}`);
    check("파일명 줄기는 ASCII이고 용도·기간·ID를 담는다", /^[\x20-\x7E]+$/.test(snapWeekly.fileStem) && snapWeekly.fileStem.includes("weekly") && snapWeekly.fileStem.includes("2026-09-28_2026-10-04") && snapWeekly.fileStem.endsWith(snapWeekly.id), snapWeekly.fileStem);
    check("월 전체 기간은 '2026년 9월'로 이름 붙는다", snapMonthlyBase.name === "월간 보고서 · ENA · 2026년 9월", snapMonthlyBase.name);
    check("분석일(분석 종료일)과 생성 시각이 분리돼 담긴다", snapWeekly.analysis.to === "2026-10-04" && snapWeekly.generatedAt === T0);
  }

  // ═════════ 2. 스냅샷 불변 ID·핵심값·판단 ID·전제 ═════════
  {
    const again = BUILD.buildChannelSnapshot(dailyDoc, { generatedAt: "2026-10-08T00:00:00.000Z" });
    check("같은 내용이면 생성 시각이 달라도 같은 ID(불변 ID는 내용의 지문)", again.id === snapDaily.id && /^rs-[0-9a-f]{12}$/.test(snapDaily.id));
    const changed = BUILD.buildChannelSnapshot({ ...dailyDoc, aiSummary: "다른 문장입니다." } as ChannelDoc, { generatedAt: T0 });
    check("문서(AI 문장 포함)가 바뀌면 다른 ID", changed.id !== snapDaily.id);
    check("추가 자료(권리·구매 검토)가 다르면 다른 ID", BUILD.buildChannelSnapshot(monthlyDoc, { generatedAt: T0, extras: { rights: null } }).id !== snapMonthlyBase.id);
    check("핵심 수치(facts)가 KPI 값을 그대로 옮긴다", snapDaily.facts.some((f) => f.label === "Rating" && f.value === "0.512") && snapDaily.facts.some((f) => f.value === "41위"));
    check("채널 판단 ID는 같은 입력이면 같은 값이고 channel: 접두", snapDaily.actions.length === 2 && snapDaily.actions.every((a) => /^channel:ENA:[0-9a-f]{8}$/.test(a.id)) && BUILD.buildChannelSnapshot(dailyDoc, { generatedAt: T0 }).actions[0].id === snapDaily.actions[0].id);
    const ps = BUILD.buildPortfolioSnapshot(portfolioDoc, { generatedAt: T0 });
    check("종합 판단 ID는 임원 결정과 TOP ACTIONS가 같은 신호에 같은 ID를 쓴다", ps.actions.filter((a) => a.id.startsWith("portfolio:ENA_DRAMA:program_down:")).length === 1 && decisions.every((d) => ps.actions.some((a) => a.id === d.actionId)));
    check("판단 ID가 중복되지 않는다", new Set(ps.actions.map((a) => a.id)).size === ps.actions.length);
    check("portfolioActionId가 기존 임원 결정 ID와 같은 값을 만든다(리팩터 동치)", decisions[0].actionId === D.portfolioActionId(decisions[0].channelCode, "program_down", "드라마B", { dateFrom: "2026-09-28", dateTo: "2026-10-04" }));
    const kinds = (s: typeof snapWeekly) => s.assumptions.map((a) => a.kind);
    check("잠정 평균·수신 미완료·순위 평균·권리 미확인·제언 기준 구간이 전제로 남는다", ["provisional", "coverage", "rank_average", "rights_unconfirmed", "reference_window"].every((k) => kinds(snapWeekly).includes(k as never)), kinds(snapWeekly).join());
    check("완전 수신(월간 30/30)이면 수신 미완료 전제가 없다", !kinds(snapMonthlyBase).includes("coverage" as never));
    check("AI 요약이 없으면(수치 대조 탈락) 그 사실이 전제에 남는다", kinds(BUILD.buildChannelSnapshot(rangeDoc("2026-09-28", "2026-10-04", 7, 7, null), { generatedAt: T0 })).includes("ai_absent" as never));
    check("스냅샷은 지표 스냅샷 ID·계산 버전·구조 버전을 담는다", snapWeekly.versions.metricSnapshotId === "ms-bbbbbbbb" && snapWeekly.versions.calc.startsWith("report-calc-") && snapWeekly.versions.snapshotSchema === 1);
  }

  // ═════════ 3. 템플릿: 일간·주간·월간 본문/부록 ═════════
  const mDaily = TPL.buildReportModel(snapDaily);
  const mWeekly = TPL.buildReportModel(snapWeekly);
  const brief = BRIEF.buildPurchaseBrief(
    [
      { own_channel_code: "ENA", target: "A2049", rank: 1, display_name: "후보1", prediction: 0.04, prediction_low: 0.01, prediction_high: 0.06, confidence: "MEDIUM", as_of: "2026-09-17", model_version: "purchase-v1.1" },
      { own_channel_code: "ENA", target: "A2049", rank: 2, display_name: "후보2", prediction: 0.03, prediction_low: null, prediction_high: null, confidence: null, as_of: "2026-09-17", model_version: "purchase-v1.1" },
      { own_channel_code: "ENA", target: "A2049", rank: 3, display_name: "후보3", prediction: 0.02, prediction_low: 0.0, prediction_high: 0.03, confidence: null, as_of: "2026-09-17", model_version: "purchase-v1.1" },
    ],
    { analysisTo: "2026-09-30", names: { ENA: "ENA" }, perChannel: 2 }
  );
  const snapMonthly = BUILD.buildChannelSnapshot(monthlyDoc, {
    generatedAt: T0,
    extras: {
      purchaseReview: brief,
      channelPolicy: { channelName: "ENA", coreTarget: "수도권 2049", state: "unset", role: null, goal: null, direction: null, validText: "미설정(운영정책 입력 전)" },
      rights: { tablesApplied: true, configured: true, asOf: "2026-09-30", windowDays: 60, expiring: [{ grantId: "g1", title: "임박작", channels: "ENA", end: "2026-10-20", daysLeft: 20 }], expiringTotal: 1, endedStillListed: 0, finiteCountGrants: 0, baselineUnknown: 0, notes: ["종료일 당일 포함 여부 등 계약 해석은 권리 담당자 확인 전입니다."] },
    },
  });
  const mMonthly = TPL.buildReportModel(snapMonthly);
  const keys = (m: import("../src/lib/reportSnapshot/template").ReportModel, part: "body" | "appendix") => m[part].map((s) => s.key);
  {
    check("일간 본문: 판정→숫자→제언→평소 대비→경쟁→확인할 것→전제 순서", keys(mDaily, "body").join() === "ai_summary,verdict,kpi,rec_summary,slot_dev,competitor,verify,assumptions", keys(mDaily, "body").join());
    check("자세한 통계(시간대 프로파일·심층 분석)는 일간 부록에 있다", keys(mDaily, "appendix").includes("hourly") && keys(mDaily, "appendix").includes("deep_notice") && !keys(mDaily, "body").includes("hourly"));
    check("주간 본문은 성과·기여 프로그램·흐름·결정 요청을 중심으로 한다", keys(mWeekly, "body").join() === "ai_summary,range_summary,kpi,structural,contribution,trend,rec_summary,assumptions", keys(mWeekly, "body").join());
    check("월간 본문은 역할·권리·구매 검토를 포함한다(일간·주간에는 없음)", ["channel_policy", "channel_rights", "purchase_review"].every((k) => keys(mMonthly, "body").includes(k as never)) && !["channel_policy", "channel_rights", "purchase_review"].some((k) => keys(mDaily, "body").includes(k as never) || keys(mWeekly, "body").includes(k as never)));
    check("같은 날짜의 일간·주간 본문 구성이 다르다(제목만 바꾼 복제가 아님)", keys(mDaily, "body").join() !== keys(mWeekly, "body").join());
    const slot = mDaily.body.find((s) => s.key === "slot_dev")!;
    const tables = slot.blocks.filter((b) => b.kind === "table") as { rows: string[][] }[];
    check("일간 본문 표는 3행까지만 두고 전체는 부록에 둔다", tables.every((t) => t.rows.length <= 3) && mDaily.appendix.some((s) => s.key === "slot_dev" && s.title.includes("(전체)") && (s.blocks.filter((b) => b.kind === "table") as { rows: string[][] }[]).some((t) => t.rows.length === 5)));
    check("본문 번호는 01부터, 부록 번호는 A1부터 다시 매긴다", /^01 /.test(mDaily.body[0].title) && /^A1 /.test(mDaily.appendix[0].title));
    check("본문에 데이터 없는 항목은 그리지 않고 사유를 '전제·한계'에 남긴다", (() => { const a = mDaily.body.at(-1)!; const t = JSON.stringify(a); return a.key === "assumptions" && t.includes("자료 없음") && t.includes("오리지널") ; })());
    const recText = JSON.stringify(mDaily.body.find((s) => s.key === "rec_summary"));
    check("편성 제언 줄마다 판단 ID와 '권리 미확인'이 붙는다", snapDaily.actions.every((a) => recText.includes(`ID ${a.id}`)) && (recText.match(/권리 미확인/g) ?? []).length === 2);
    const kpi = mWeekly.body.find((s) => s.key === "kpi")!.blocks[0] as { kind: "kpi"; meta?: { flags?: string[]; unit?: string; period?: string; target?: string; source?: string } };
    check("KPI 블록에 단위·기간·타깃·출처가 붙는다", !!kpi.meta?.unit && !!kpi.meta?.period && kpi.meta.target === "개인2049" && !!kpi.meta?.source);
    check("잠정값·수신 미완료가 해당 KPI 위치에 표시된다(본문 맨 끝만이 아님)", (kpi.meta?.flags ?? []).some((f) => f.includes("잠정")) && (kpi.meta?.flags ?? []).some((f) => f.includes("수신 6/7일")));
    const dailyKpi = mDaily.body.find((s) => s.key === "kpi")!.blocks[0] as { meta?: { flags?: string[] } };
    check("하루 값(잠정 평균 아님)에는 잠정 표시가 없다", !(dailyKpi.meta?.flags ?? []).some((f) => f.includes("잠정")));
    const allBlocks = [...mWeekly.body, ...mWeekly.appendix].flatMap((s) => s.blocks);
    const tablesAll = allBlocks.filter((b) => b.kind === "table") as { meta?: unknown }[];
    check("모든 표에 단위·기간·타깃·출처 메타가 있다(없는 표 0개)", tablesAll.length > 0 && tablesAll.every((t) => !!t.meta), `${tablesAll.filter((t) => !t.meta).length}개 누락`);
    const trendChart = mWeekly.body.find((s) => s.key === "trend")!.blocks.find((b) => b.kind === "chart") as { values: (number | null)[]; meta?: unknown } | undefined;
    check("주간 추이에 차트가 있고 값이 없는 날은 null(0이 아님)", !!trendChart && trendChart.values.includes(null) && !trendChart.values.includes(0) && !!trendChart.meta);
    const m2 = TPL.buildReportModel(snapWeekly);
    check("모델은 같은 스냅샷에서 항상 같다(결정적)", JSON.stringify(m2) === JSON.stringify(mWeekly));
  }

  // 월간 구매 검토·권리·역할
  {
    const pr = mMonthly.body.find((s) => s.key === "purchase_review")!;
    const t = JSON.stringify(pr);
    check("구매 검토: 모든 후보가 '보유 예정(권리 획득 가정)'이고 권리 확인·구매 요청이 없다고 밝힌다", t.includes("보유 예정(권리 획득 가정)") && t.includes("구매 요청은 구매 검토 화면에서") || t.includes("일어나지 않음"));
    check("구매 검토: 추천 기준일이 분석 종료일보다 오래되면 '오래된 추천'(13일 > 9일)", brief.lagDays === 13 && brief.stale && t.includes("오래된 추천") && snapMonthly.assumptions.some((a) => a.kind === "stale_recommendation"));
    check("구매 검토: 예측 범위가 예측값 이상으로 넓으면 '범위 넓음', 범위가 없으면 '범위 없음'", t.includes("범위 넓음") && t.includes("범위 없음") && brief.items[0].wide === true && brief.items[1].wide === false);
    check("구매 검토: 채널당 상위 2건만 싣는다", brief.items.length === 2 && BRIEF.buildPurchaseBrief([], { analysisTo: "2026-09-30", names: {} }).items.length === 0);
    check("추천 결과가 없으면 비어 있다고 밝히고 오래됨으로 오인하지 않는다", (() => { const b = BRIEF.buildPurchaseBrief([], { analysisTo: "2026-09-30", names: {} }); return b.asOf === null && !b.stale && b.note.includes("없습니다"); })());
    const pol = JSON.stringify(mMonthly.body.find((s) => s.key === "channel_policy"));
    check("역할·운영정책은 미설정이면 미설정으로 쓴다(임의 페르소나 없음)", pol.includes("미설정") && snapMonthly.assumptions.some((a) => a.kind === "policy_unset"));
    const rt = JSON.stringify(mMonthly.body.find((s) => s.key === "channel_rights"));
    check("권리: 종료 임박 권리가 표로, 계약 해석 확인 전이라는 주석이 남는다", rt.includes("임박작") && rt.includes("계약 해석"));
  }

  // ═════════ 4. 덱 구조(종합 8~10장, 중복·빈 장 없음) ═════════
  const psnap = BUILD.buildPortfolioSnapshot(portfolioDoc, { generatedAt: T0 });
  const pmodel = TPL.buildReportModel(psnap);
  const pplan = DECK.planPortfolioDeck(pmodel, portfolioDoc);
  const bodyTitles = pplan.slides.filter((s) => s.kind === "content" && !s.appendix).map((s) => (s as { title: string }).title);
  {
    const n = DECK.bodySlideCount(pplan);
    check(`종합 덱 본문은 8~10장(실제 ${n}장)`, n >= 8 && n <= DECK.PORTFOLIO_BODY_MAX, bodyTitles.join(" / "));
    check("첫 본문 장은 결론·결정 요청, 마지막 본문 장은 전제·한계", bodyTitles[0].includes("결정 요청") && bodyTitles.at(-1)!.startsWith("전제·한계"));
    check("본문 장 제목이 서로 다르다(같은 제목 반복 없음)", new Set(bodyTitles).size === bodyTitles.length);
    check("본문 장 제목에 'TOP 3'·'임원 핵심 결정 — 요약' 같은 반복 제목이 없다", !bodyTitles.some((t) => /TOP\s*3|임원 핵심 결정/.test(t)));
    const allTitles = pplan.slides.filter((s) => s.kind === "content").map((s) => (s as { title: string }).title);
    check("부록까지 포함해도 같은 제목의 장이 없다", new Set(allTitles).size === allTitles.length, allTitles.filter((t, i) => allTitles.indexOf(t) !== i).join(" | "));
    const content = pplan.slides.filter((s) => s.kind === "content") as Extract<(typeof pplan.slides)[number], { kind: "content" }>[];
    check("내용 없는 장이 없다(모든 장에 값이 있는 블록 1개 이상)", content.every((s) => s.blocks.some((b) => (b.kind === "text" ? b.text.trim() : b.kind === "bullets" ? b.items.length : b.kind === "table" ? b.rows.length : b.kind === "kpi" ? b.items.length : b.kind === "chart" ? b.values.some((v) => v !== null) : false))));
    check("본문에서 결정·근거·Avail 조건을 찾을 수 있다(결정 표 + 권리 장)", bodyTitles.some((t) => t.includes("결정 요청")) && bodyTitles.some((t) => /권리/.test(t)) && JSON.stringify(content.filter((s) => !s.appendix)).includes("Avail(권리) 미확인"));
    check("모든 장에 스냅샷 ID·분석일·생성 시각 바닥글이 있다", content.every((s) => s.footer.includes(psnap.id) && s.footer.includes("분석일 2026-10-04") && s.footer.includes("생성 2026-10-07 14:10")));
    check("결정 표와 실행 계획 표에 판단 ID가 있다", decisions.every((d) => JSON.stringify(content.filter((s) => !s.appendix)).includes(d.actionId)));
    check("그룹 성과 장은 Group A와 B를 따로 그린 차트 둘을 쓴다(두 그룹을 한 차트에 섞지 않음)", (() => { const g = content.find((s) => s.title.startsWith("Group A"))!; return g.blocks.filter((b) => b.kind === "chart").length === 2; })());
    const noPipe = DECK.planPortfolioDeck(TPL.buildReportModel(BUILD.buildPortfolioSnapshot(mkPortfolio({ pipeline: false }), { generatedAt: T0 })), mkPortfolio({ pipeline: false }));
    check("데이터가 없는 항목은 빈 장을 만들지 않는다(오리지널 유통 없음 → 그 장 없음)", !DECK.bodySlideCount(noPipe) || !noPipe.slides.some((s) => s.kind === "content" && !s.appendix && s.title.includes("오리지널")) && DECK.bodySlideCount(noPipe) === n - 1);
    const noDec = mkPortfolio({ decisions: false });
    const noDecPlan = DECK.planPortfolioDeck(TPL.buildReportModel(BUILD.buildPortfolioSnapshot(noDec, { generatedAt: T0 })), noDec);
    const noDecTitles = noDecPlan.slides.filter((s) => s.kind === "content" && !s.appendix).map((s) => (s as { title: string }).title);
    check("결정이 없으면 대안·실행 계획 장이 없고 '결정 요청 없음'을 말한다", !noDecTitles.some((t) => /대안|실행·평가/.test(t)) && noDecTitles[0].includes("결정 요청 없음"));
    const noAi = BUILD.buildPortfolioSnapshot(mkPortfolio({ ai: null }), { generatedAt: T0 });
    check("AI 요약이 없어도 덱은 만들어지고 그 사실이 전제·한계 장에 있다", JSON.stringify(DECK.planPortfolioDeck(TPL.buildReportModel(noAi), mkPortfolio({ ai: null })).slides).includes("AI 요약은 수치 대조를 통과하지 못했"));
    check("AI 요약이 있으면 첫 장에 한 번만 나온다(다른 장에 같은 요약 복제 없음)", (JSON.stringify(content.map((s) => s.blocks)).match(/그룹별로 다르게 움직였/g) ?? []).length === 1);
    check("부록은 구분 장 뒤에 있고 본문 장보다 뒤다", (() => { const idx = pplan.slides.findIndex((s) => s.kind === "divider"); const firstApp = pplan.slides.findIndex((s) => s.kind === "content" && s.appendix); return idx > 0 && firstApp === idx + 1 && pplan.slides.slice(0, idx).every((s) => s.kind !== "content" || !s.appendix); })());
    const cplan = DECK.planChannelDeck(mDaily);
    const ctitles = cplan.slides.filter((s) => s.kind === "content").map((s) => (s as { title: string }).title);
    check("채널 덱도 같은 제목의 장이 없고 한 줄 판정과 숫자가 한 장이다", new Set(ctitles).size === ctitles.length && ctitles.includes("평소 대비 낮은 편"), ctitles.join(" / "));
    check("채널 일간 덱 본문은 10장 이하(1~2쪽 브리핑 성격)", DECK.bodySlideCount(cplan) <= 10, `${DECK.bodySlideCount(cplan)}장`);
  }

  // ═════════ 5. 실제 파일: Word·PPT를 풀어 형식 간 일치 확인 ═════════
  {
    const cases: { name: string; snap: import("../src/lib/reportSnapshot/types").ReportSnapshot; model: import("../src/lib/reportSnapshot/template").ReportModel; plan: import("../src/lib/reportSnapshot/deckPlan").DeckPlan }[] = [
      { name: "채널 주간", snap: snapWeekly, model: mWeekly, plan: DECK.planChannelDeck(mWeekly) },
      { name: "채널 월간", snap: snapMonthly, model: mMonthly, plan: DECK.planChannelDeck(mMonthly) },
      { name: "종합 주간", snap: psnap, model: pmodel, plan: pplan },
    ];
    for (const c of cases) {
      const docx = await DOCX.renderModelDocx(c.model);
      const pptx = await PPTX.renderDeckPptx(c.plan);
      const dxml = await zipText(docx, /^word\/document\.xml$/);
      const dtxt = docxText(dxml);
      const ptxt = pptxText(await zipText(pptx, /^ppt\/slides\/slide\d+\.xml$/));
      const printTxt = JSON.stringify(c.model); // 문서 보기(인쇄)는 이 모델을 그대로 그린다
      const aiG = c.snap.document.aiSummary ? GJ.toGaejosik(c.snap.document.aiSummary) : null;
      const tokens: { label: string; value: string }[] = [
        { label: "스냅샷 ID", value: c.snap.id },
        { label: "분석 기간", value: c.snap.analysis.label },
        ...(aiG ? [{ label: "AI 문장", value: aiG }] : []),
        ...c.snap.actions.map((a) => ({ label: `판단 ID ${a.id}`, value: a.id })),
      ];
      for (const t of tokens) {
        const inD = dtxt.includes(t.value);
        const inP = ptxt.includes(t.value);
        const inV = printTxt.includes(t.value.replace(/"/g, '\\"'));
        check(`[${c.name}] ${t.label}가 Word·PPT·문서보기(PDF) 모두에 같다`, inD && inP && inV, `word=${inD} ppt=${inP} view=${inV}`);
      }
      // 핵심 수치(facts) — 값이 있는 형식 전부에서 같아야 한다
      const missingFacts = c.snap.facts.filter((f) => !dtxt.includes(f.value) || !ptxt.includes(f.value)).map((f) => `${f.label}=${f.value}`);
      check(`[${c.name}] 핵심 수치 ${c.snap.facts.length}건이 Word와 PPT에 같은 값으로 있다`, c.snap.facts.length > 0 && missingFacts.length === 0, missingFacts.join(", "));
      check(`[${c.name}] 생성일과 분석일이 분리돼 표기된다`, dtxt.includes("분석일") && dtxt.includes("2026-10-07 14:10") && ptxt.includes("생성 2026-10-07 14:10"));
      check(`[${c.name}] 'undefined'·'NaN'·'[object' 같은 깨진 값이 없다`, !/undefined|NaN|\[object/.test(dtxt) && !/undefined|NaN|\[object/.test(ptxt));
      check(`[${c.name}] Word 표 머리행 반복(tblHeader)과 행 쪼개짐 방지(cantSplit), 부록 새 쪽(pageBreakBefore)`, dxml.includes("<w:tblHeader") && dxml.includes("<w:cantSplit") && (c.model.appendix.length === 0 || dxml.includes("<w:pageBreakBefore")));
      check(`[${c.name}] Word 한글 글꼴을 명시한다(맑은 고딕)`, dxml.includes("Malgun Gothic"));
      const pz = await JSZip.loadAsync(pptx);
      const slideCount = Object.keys(pz.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
      check(`[${c.name}] PPT 장수가 계획과 같다(${slideCount}장)`, slideCount === c.plan.slides.length);
      const chartBlocks = c.plan.slides.flatMap((s) => (s.kind === "content" ? s.blocks.filter((b) => b.kind === "chart") : []));
      const chartParts = Object.keys(pz.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length;
      check(`[${c.name}] 차트는 PowerPoint 차트로 들어간다(계획 ${chartBlocks.length}개 = 파일 ${chartParts}개)`, chartParts === chartBlocks.length);
      const tableBlocks = c.model.body.concat(c.model.appendix).flatMap((s) => s.blocks).filter((b) => b.kind === "table") as { meta?: { unit?: string; period?: string; target?: string; source?: string } }[];
      check(`[${c.name}] Word 표마다 단위·기간·타깃·출처 캡션이 있다(표 ${tableBlocks.length}개)`, (dtxt.match(/출처: /g) ?? []).length >= tableBlocks.length);
    }
  }

  // ═════════ 6. 0/결측/빈 데이터 ═════════
  {
    const m = mWeekly;
    const chart = m.body.find((s) => s.key === "trend")!.blocks.find((b) => b.kind === "chart") as Extract<import("../src/lib/audienceReport/reportFlatten").DocBlock, { kind: "chart" }>;
    const series = COMMON.chartSeries(chart);
    check("차트는 값이 없는 범주를 그리지 않고 따로 밝힌다(0으로 그리지 않음)", series.missing.length === 1 && series.categories.length === chart.categories.length - 1 && !series.values.includes(0));
    const docx = docxText(await zipText(await DOCX.renderModelDocx(m), /^word\/document\.xml$/));
    check("Word 차트(표)에도 '값 없음(그리지 않음)'이 남는다", docx.includes("값 없음(그리지 않음)"));
    const allNull = { ...chart, values: chart.values.map(() => null) };
    check("모든 값이 없으면 차트 블록이 빈 블록으로 걸러진다", !COMMON.chartSeries(allNull).categories.length);
    check("값 0은 값으로 그린다(없음과 구분)", COMMON.chartSeries({ ...chart, categories: ["a", "b"], values: [0, null] }).values.join() === "0");
    check("숫자 셀 판별(오른쪽 맞춤)이 부호·단위 표기를 안다", ["0.512", "▲ 12.3%", "41위", "3회", "0.8배", "-0.3"].every((t) => COMMON.isNumericText(t)) && !COMMON.isNumericText("ENA Drama"));
    check("캡션에서 단위가 '—'이면 단위 항목을 생략한다", !COMMON.metaCaption({ unit: "—", period: "기간" }).includes("단위"));
  }

  // ═════════ 7. 저장소(불변)·서비스(읽기 전용·재사용) ═════════
  {
    const mem = STORE.createMemoryStore();
    await mem.put(snapWeekly);
    const mutated = { ...snapWeekly, name: "바뀐 이름" };
    await mem.put(mutated);
    const got = await mem.get(snapWeekly.id);
    check("저장된 스냅샷은 같은 ID로 다시 저장해도 덮어쓰이지 않는다(불변)", got?.name === snapWeekly.name && mem.size() === 1);
    check("없는 ID는 null(조용히 다른 내용을 만들지 않는다)", (await mem.get("rs-000000000000")) === null);
    check("스냅샷 ID 형식 검사", STORE.SNAPSHOT_ID_RE.test(snapWeekly.id) && !STORE.SNAPSHOT_ID_RE.test("rs-xyz") && !STORE.SNAPSHOT_ID_RE.test("../etc"));
    const store = read("src/lib/reportSnapshot/storeSupabase.ts");
    check("운영 저장소는 기존 캐시 테이블에 덮어쓰지 않는 upsert(ignoreDuplicates)로 저장하고 as_of_date를 비운다", store.includes("ignoreDuplicates: true") && store.includes("as_of_date: null") && store.includes("mart_llm_text_cache"));
    check("저장소가 다른 구조 버전·어긋난 ID는 쓰지 않는다", store.includes("snap.id !== id") && store.includes("snap.schema !== SNAPSHOT_SCHEMA_VERSION"));
    const svc = read("src/lib/reportSnapshot/service.ts");
    check("서비스는 DB 쓰기를 저장소 put 한 곳으로만 한다(from().insert/update/delete/upsert 없음)", !/\.from\([^)]*\)\s*\.(insert|update|delete|upsert)/.test(svc) && svc.includes("store.put("));
    check("같은 요청은 재사용 창 안에서 저장된 스냅샷을 쓰고 refresh는 건너뛴다, 동시 요청은 하나를 같이 기다린다", svc.includes("REUSE_WINDOW_MS") && svc.includes("if (!r.refresh)") && svc.includes("inflight.get(key)"));
    check("저장에 실패해도 보고서는 돌려주고 persisted=false로 알린다(재사용 등록은 저장 성공 때만)", svc.includes("persisted = false") && svc.includes("if (persisted) recent.set"));
    check("월간만 권리·구매 검토를 읽는다", svc.includes('if (cadence !== "monthly") return {}'));
    check("서비스에 권리 소진·구매 요청·편성 저장 호출이 없다", !/consume|reserve|requestPurchase|saveSchedule|savePredictions|rating_predictions/.test(svc));
    const keyA = (await import("../src/lib/reportSnapshot/requestKey")).requestKey({ subject: "channel", channelCode: "ENA", request: { mode: "single_day", date: "2026-10-04" } });
    const keyB = (await import("../src/lib/reportSnapshot/requestKey")).requestKey({ subject: "channel", channelCode: "ENA_DRAMA", request: { mode: "single_day", date: "2026-10-04" } });
    check("재사용 키는 채널이 다르면 다르다(이전 채널 보고서가 새 채널 제목 아래 나오지 않음)", keyA !== keyB);
  }

  // ═════════ 8. 라우트·AI 재생성 금지·화면 연결(정적 점검) ═════════
  {
    const D2 = "src/app/api/audience-report";
    const routes = ["[channel]/route.ts", "[channel]/docx/route.ts", "[channel]/pptx/route.ts", "[channel]/deck/route.ts", "portfolio/route.ts", "portfolio/docx/route.ts", "portfolio/pptx/route.ts", "portfolio/deck/route.ts"];
    check("웹·Word·PPT·미리보기 라우트가 모두 resolveSnapshot으로 같은 스냅샷을 얻는다", routes.every((r) => read(`${D2}/${r}`).includes("resolveSnapshot(")));
    check("라우트가 보고서 빌더·LLM을 직접 부르지 않는다(AI 문장을 형식마다 새로 만들지 않음)", routes.every((r) => !/buildAudienceReport|buildPortfolioReport|narrativeLlm|llmSynthesis|openai/i.test(read(`${D2}/${r}`))));
    const lib = ["build.ts", "template.ts", "deckPlan.ts", "renderDocx.ts", "renderPptx.ts", "renderCommon.ts", "responses.ts", "http.ts", "cadence.ts", "purchaseBrief.ts"];
    check("스냅샷 렌더·템플릿 모듈은 LLM·DB 클라이언트를 가져오지 않는다", lib.every((f) => !/narrativeLlm|llmSynthesis|@\/lib\/supabase|openai/i.test(read(`src/lib/reportSnapshot/${f}`))));
    check("보고서 빌더 호출은 서비스 한 곳뿐이다", /buildAudienceReport\(/.test(code("src/lib/reportSnapshot/service.ts")) && !fs.readdirSync(path.join(ROOT, "src/lib/reportSnapshot")).filter((f) => f !== "service.ts").some((f) => /buildAudienceReport\(|buildPortfolioReport\(/.test(code(`src/lib/reportSnapshot/${f}`))));
    const http = read("src/lib/reportSnapshot/http.ts");
    check("snapshot=ID가 있는데 원본이 없으면 404로 알린다(다른 내용을 만들지 않음)", /if \(!snap\) return jsonError\([^\n]*404\)/.test(http) && http.includes("찾지 못했습니다"));
    check("snapshot ID의 대상(채널·종합)이 요청과 다르면 거부한다", http.includes("snap.subject !== subject") && http.includes("snap.channelCode !== channelCode"));
    check("다운로드 파일명에 용도·기간·스냅샷 ID가 들어간다(Content-Disposition)", read("src/lib/audienceReport/parseRequest.ts").includes("snapshotContentDisposition") && read("src/lib/reportSnapshot/responses.ts").includes("snapshotContentDisposition("));
    const hook = read("src/components/audienceReport/useSnapshotReport.tsx");
    check("웹 보고서는 AbortController로 이전 요청을 버리고 다시 시도·다시 생성을 제공한다", hook.includes("AbortController") && hook.includes("ctrl.abort()") && hook.includes("refresh=1") && hook.includes("ReportError") && hook.includes("onRetry"));
    const ui = read("src/components/audienceReport/snapshotUi.tsx");
    check("다운로드 버튼은 진행(경과 초)·실패 사유·다시 시도를 보이고 대상이 바뀌면 진행 중 요청을 취소한다", ui.includes("만드는 중…") && ui.includes("다시 시도") && /useEffect\(\(\) => \{\s*return \(\) => \{\s*ctrl\.current\?\.abort\(\)/.test(ui) && ui.includes("[href]"));
    const chPage = read("src/app/audience-report/[channel]/page.tsx");
    const pfPage = read("src/app/audience-report/portfolio/page.tsx");
    check("채널·종합 화면이 같은 스냅샷 ID로 Word·PPT·문서 보기 링크를 만든다", [chPage, pfPage].every((p) => p.includes("snapshot=${snapshot.id}") && p.includes("/audience-report/view/${snapshot.id}") && p.includes("<SnapshotBar")));
    check("옛 방식(화면 인쇄 window.print)·형식별 새 빌드 링크가 남아 있지 않다", ![chPage, pfPage].some((p) => p.includes("window.print()") || p.includes("searchParams.toString()}`}\n            className")));
    const view = read("src/app/audience-report/view/[id]/page.tsx");
    check("문서 보기(PDF)는 A4 쪽 설정·표 머리행 반복·행 쪼개짐 방지·부록 새 쪽을 지정한다", view.includes("size: A4") && view.includes("table-header-group") && view.includes("breakInside") && view.includes('breakBefore: "page"'));
    check("전역 메뉴가 문서 보기 주소의 'view'를 채널 코드로 읽지 않는다", read("src/components/workspace/GlobalNav.tsx").includes('m[1] !== "view"') && read("src/components/workspace/ActionRibbon.tsx").includes('channelMatch[1] !== "view"'));
    check("구형 렌더러(exportRenderers)가 앱에서 쓰이지 않는다", !fs.existsSync(path.join(ROOT, "src/lib/audienceReport/exportRenderers.ts")) && !/exportRenderers/.test(read("src/lib/reportSnapshot/renderPptx.ts")));
  }

  // ═════════ 9. 모든 섹션에 키가 있다(분류 누락 방지) ═════════
  {
    const sections = [...FL.flattenAudienceReport(dailyDoc).sections, ...FL.flattenAudienceReport(weeklyDoc).sections];
    const pf = (await import("../src/lib/audienceReport/portfolioFlatten")).flattenPortfolioReport(portfolioDoc).sections;
    check("flatten이 만든 모든 섹션에 key가 있다", [...sections, ...pf].every((s) => typeof s.key === "string" && s.key.length > 0));
    const src = read("src/lib/audienceReport/reportFlatten.ts") + read("src/lib/audienceReport/portfolioFlatten.ts");
    check("섹션 키 타입이 필수라 새 섹션은 키 없이 컴파일되지 않는다", /export interface DocSection \{\s*key: SectionKey;/.test(src));
  }

  console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
  if (failures.length) {
    console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
