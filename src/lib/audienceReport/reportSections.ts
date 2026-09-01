// Phase 6(2026-08-28, 계획서 J절 §11-6/9) — 설계서 §06의 모드별 섹션을 만드는 순수 함수들.
// I/O 없음 — collectAudienceReportData(Phase 1) + analyzer(Phase 2) + originalContent(Phase 3,
// 이미 I/O로 가져온 결과) + skyUhdCross(Phase 4, 이미 I/O로 가져온 결과) + validate(Phase 5)의
// 산출물만 입력으로 받아 §06 순서 그대로 섹션 객체를 조립한다. 새 계산 없음 — 이미 검증된 값 중에서
// 고르고 라벨을 붙일 뿐(analyzer.ts와 같은 설계 원칙).
import type { AudienceReportRawData, HourlyPatternRow } from "./dataCollector";
import { computeDailyOutlierVerdict, computeStructuralVsTemporary, computeGrowthWeaknessMovers, computePeakHourByDemographic, summarizeCompetitorScheduleChanges, computeDaypartWinWeakness } from "./analyzer";
import { computeChannelHealthScore } from "@/lib/channelHealthScore";
import { formatRating, formatPercent } from "./format";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type {
  ModeASection,
  ModeBSection,
  ModeCSection,
  ModeDSection,
  KpiCard,
  HourlyProfilePoint,
  SlotDeviationRow,
  ChartCaptionInfo,
  CompetitorInsightRow,
  OriginalReviewSection,
  EnaLiveAiringSection,
  SkyUhdSubstituteSection,
  DailyTrendChartPoint,
  WeekdayHourCell,
  BestWorstDayDetail,
  KpiCompareRow,
  ProgramChangeRow,
  HourBlockDeltaRow,
  ComparisonMatrixRow,
  CumulativeConvergencePoint,
  BreakdownRow,
  TargetHourlyCell,
  ProgramAudienceCrossRow,
  ProgramMomentumRow,
} from "./reportModel";

function pctChange(curr: number | null, base: number | null): number | null {
  if (curr === null || base === null || base === 0) return null;
  return ((curr - base) / base) * 100;
}

function baseCaption(raw: AudienceReportRawData, measure: string): ChartCaptionInfo {
  return { periodLabel: raw.period.label, targetUniverse: raw.group.label, measure };
}

// Phase 12(2026-08-28, 계획서 J절 Phase 12) — §06 번호 순서 밖 추가 섹션 3종. 4개 모드가 전부
// 같은 모양(Maybe<T>)으로 쓰므로 공용 헬퍼로 묶는다(모드별 buildModeXSection에서 그대로 호출).
function buildTargetHourlyPatternSection(raw: AudienceReportRawData): { available: true; data: { cells: TargetHourlyCell[]; peaks: import("./analyzer").DemographicPeakHour[]; caption: ChartCaptionInfo } } | { available: false; reason: string } {
  const isSkyUhd = raw.channelCode === "SKYUHD";
  if (isSkyUhd || raw.targetHourlyPattern.length === 0) {
    return { available: false, reason: isSkyUhd ? "skyUHD는 연령대별 시간대 자료가 제한적입니다(§05)" : "타깃×시간대 자료가 없습니다" };
  }
  const cells: TargetHourlyCell[] = raw.targetHourlyPattern.map((r) => ({ demographicLabel: r.demographicLabel, hour: r.broadcastHour, avgRating: r.avgRating }));
  return { available: true, data: { cells, peaks: computePeakHourByDemographic(raw.targetHourlyPattern), caption: baseCaption(raw, "연령대×시간대 평균 시청률") } };
}

/** MODE A 전용 — 기존에 수집만 되고 화면에 안 쓰이던 raw.demographicProgramHighlights를 처음
 *  연결한다(같은 요일 8주 트레일링 baseline, 새 SQL 없음). */
function buildProgramAudienceCrossFromDaily(raw: AudienceReportRawData): { available: true; data: ProgramAudienceCrossRow[] } | { available: false; reason: string } {
  const isSkyUhd = raw.channelCode === "SKYUHD";
  if (isSkyUhd || raw.demographicProgramHighlights.length === 0) {
    return { available: false, reason: isSkyUhd ? "skyUHD는 프로그램×타깃 자료가 제한적입니다(§05)" : "프로그램×타깃 자료가 없습니다" };
  }
  const data: ProgramAudienceCrossRow[] = raw.demographicProgramHighlights.map((h) => ({
    programName: h.program_name,
    demographicLabel: h.demographic_label,
    metric: h.metric,
    value: h.today_value,
    baselineValue: h.baseline_avg,
    deltaPct: h.delta_pct,
  }));
  return { available: true, data };
}

/** MODE B/C/D 전용 — 신규 기간 RPC(직전 동일 길이 기간 baseline). */
function buildProgramAudienceCrossFromPeriod(raw: AudienceReportRawData): { available: true; data: ProgramAudienceCrossRow[] } | { available: false; reason: string } {
  const isSkyUhd = raw.channelCode === "SKYUHD";
  if (isSkyUhd || raw.periodDemographicProgramHighlights.length === 0) {
    return { available: false, reason: isSkyUhd ? "skyUHD는 프로그램×타깃 자료가 제한적입니다(§05)" : "이 기간 동안 프로그램×타깃 자료가 없습니다" };
  }
  const data: ProgramAudienceCrossRow[] = raw.periodDemographicProgramHighlights.map((h) => ({
    programName: h.program_name,
    demographicLabel: h.demographic_label,
    metric: h.metric,
    value: h.period_value,
    baselineValue: h.prior_value,
    deltaPct: h.delta_pct,
  }));
  return { available: true, data };
}

function buildCompetitorScheduleChangesSection(raw: AudienceReportRawData): { available: true; data: import("./analyzer").CompetitorScheduleChangeGroup[] } | { available: false; reason: string } {
  if (raw.competitorScheduleChangeLog.length === 0) {
    return { available: false, reason: "이 기간 동안 편성 변화가 관찰되지 않았거나, 페어링된 경쟁채널 자료가 없습니다" };
  }
  return { available: true, data: summarizeCompetitorScheduleChanges(raw.competitorScheduleChangeLog) };
}

/** Rating·Share·Reach·시청시간·순위 5종 KPI 카드 — periodReport(+선택적 rank)만 골라 씀. */
function buildKpiCards(raw: AudienceReportRawData, rankAvg: { current: number | null; prior: number | null } | null): KpiCard[] {
  const p = raw.periodReport;
  const cards: KpiCard[] = [
    {
      label: "Rating",
      formatted: formatRating(p?.avg_rating ?? null, raw.channelCode),
      priorDeltaPct: p?.prior_period_change_pct ?? null,
      baselineDeltaPct: p?.baseline_change_pct ?? null,
    },
    { label: "Share", formatted: formatPercent(p?.avg_share ?? null), priorDeltaPct: null, baselineDeltaPct: null },
    { label: "Reach", formatted: formatPercent(p?.avg_reach ?? null), priorDeltaPct: null, baselineDeltaPct: null },
    {
      label: "시청시간(초)",
      formatted: p?.avg_time_spent_seconds != null ? Math.round(p.avg_time_spent_seconds).toString() : "—",
      priorDeltaPct: null,
      baselineDeltaPct: null,
    },
  ];
  if (rankAvg) {
    cards.push({
      label: "순위",
      formatted: rankAvg.current != null ? rankAvg.current.toFixed(1) : "—",
      priorDeltaPct: pctChange(rankAvg.current, rankAvg.prior),
      baselineDeltaPct: null,
    });
  }
  return cards;
}

// ---------------- MODE A ----------------
export interface ModeAExtra {
  hourlyBaseline: HourlyPatternRow[];
  sameWeekdayLastWeek: { date: string; avgRating: number | null } | null;
  originalReview: OriginalReviewSection | null; // Group A가 아니면 null
  enaLiveAiring: EnaLiveAiringSection | null; // ENA가 아니면 null
  skyUhd: SkyUhdSubstituteSection | null; // skyUHD가 아니면 null
  competitorInsight: CompetitorInsightRow[];
}

export function buildModeASection(raw: AudienceReportRawData, extra: ModeAExtra): ModeASection {
  const p = raw.periodReport;
  const isSkyUhd = raw.channelCode === "SKYUHD";
  const isGroupA = raw.group.code === "A";

  const verdict = computeDailyOutlierVerdict(p?.avg_rating ?? null, p?.baseline_avg_rating ?? null);

  const kpiCards = buildKpiCards(raw, null).map((c) =>
    c.label === "Rating" ? { ...c, sameWeekdayDeltaPct: pctChange(p?.avg_rating ?? null, extra.sameWeekdayLastWeek?.avgRating ?? null) } : c
  );

  const baselineByHour = new Map(extra.hourlyBaseline.map((h) => [h.broadcastHour, h.avgRating]));
  const titleByHour = new Map(raw.hourlyProgramTitles.map((t) => [t.broadcastHour, t.programNames]));
  const hourlyPoints: HourlyProfilePoint[] = raw.hourlyPattern.map((h) => ({
    hour: h.broadcastHour,
    todayRating: h.avgRating,
    baselineRating: baselineByHour.get(h.broadcastHour) ?? null,
    programNames: titleByHour.get(h.broadcastHour) ?? null,
  }));
  const hourlyProfile: ModeASection["hourlyProfile"] =
    !isSkyUhd && hourlyPoints.length > 0
      ? { available: true, data: { points: hourlyPoints, caption: baseCaption(raw, "시간대별 평균 시청률(02~25시), 최근 12주 같은 시간대 평균선 포함") } }
      : { available: false, reason: isSkyUhd ? "skyUHD는 프로그램 단위 시간대 자료가 제한적입니다(§05)" : "이 채널의 시간대 자료가 없습니다" };

  const deviationRows: SlotDeviationRow[] = raw.hourlyPattern.map((h) => {
    const baseline = baselineByHour.get(h.broadcastHour) ?? null;
    return {
      hour: h.broadcastHour,
      programNames: titleByHour.get(h.broadcastHour) ?? "—",
      todayRating: h.avgRating,
      baselineRating: baseline,
      deviationPct: pctChange(h.avgRating, baseline),
    };
  });
  const validDeviation = deviationRows.filter((r) => r.deviationPct !== null);
  const sortedDeviation = [...validDeviation].sort((a, b) => (b.deviationPct ?? 0) - (a.deviationPct ?? 0));
  const programsBySlotDeviation: ModeASection["programsBySlotDeviation"] =
    !isSkyUhd && sortedDeviation.length > 0
      ? { available: true, data: { top: sortedDeviation.slice(0, 5), bottom: sortedDeviation.slice(-5).reverse() } }
      : { available: false, reason: isSkyUhd ? "skyUHD는 시간대별 슬롯 평소 수준 비교가 불가합니다" : "비교할 시간대 자료가 없습니다" };

  const originalReview: ModeASection["originalReview"] = isGroupA && extra.originalReview
    ? { available: true, data: extra.originalReview }
    : { available: false, reason: "오리지널·독점 콘텐츠 리뷰는 Group A(ENA·ENA Drama·ENA Play) 전용입니다" };

  const enaLiveAiring: ModeASection["enaLiveAiring"] = raw.channelCode === "ENA" && extra.enaLiveAiring
    ? { available: true, data: extra.enaLiveAiring }
    : { available: false, reason: "ENA 본방송 실적은 ENA 채널 리포트에서만 제공됩니다" };

  const audienceReaction: ModeASection["audienceReaction"] =
    !isSkyUhd && raw.demographics.length > 0
      ? { available: true, data: raw.demographics.map((d) => ({ targetLabel: d.target_label, value: d.period_avg_rating, deltaPct: d.delta_pct })) }
      : { available: false, reason: isSkyUhd ? "skyUHD는 연령·성별 12구간 자료가 없습니다" : "타깃 반응 자료가 없습니다" };

  const competitorSameSlot: ModeASection["competitorSameSlot"] =
    extra.competitorInsight.length > 0 ? { available: true, data: extra.competitorInsight } : { available: false, reason: "경쟁채널 비교 자료가 없습니다" };

  const thingsToVerify: string[] = [
    "이 리포트는 관찰된 수치를 근거로 하며, 인과관계를 단정하지 않습니다.",
    ...(p && p.days_with_data < 1 ? ["표본일수가 부족합니다 — 판정에 유의하세요."] : []),
  ];

  const skyUhd: ModeASection["skyUhd"] = isSkyUhd && extra.skyUhd ? { available: true, data: extra.skyUhd } : { available: false, reason: "skyUHD 전용 섹션입니다" };

  // N절 Phase 2d(2026-09-01) — Health Score/Program Momentum. computeChannelHealthScore는
  // 순수 함수(src/lib/channelHealthScore.ts) 그대로 재사용, 여기서는 입력만 raw에서 골라 넣는다.
  const health = raw.dailyHealthInputs;
  let healthScore: ModeASection["healthScore"] = { available: false, reason: isSkyUhd ? "skyUHD는 Health Score를 제공하지 않습니다" : "Health Score 계산에 필요한 자료가 없습니다" };
  let programMomentum: ModeASection["programMomentum"] = { available: false, reason: isSkyUhd ? "skyUHD는 Program Momentum을 제공하지 않습니다" : "Program Momentum 계산에 필요한 자료가 없습니다" };
  if (health) {
    const fitScoreTagCounts = { STRENGTHEN: 0, KEEP: 0, MOVE: 0, REPLACE: 0, TEST: 0 };
    for (const item of health.fitScoreItems) {
      if (item.tag) fitScoreTagCounts[item.tag] += 1;
    }
    healthScore = {
      available: true,
      data: computeChannelHealthScore({
        ratingDeltaPct: health.narrativeSignal?.ratingDeltaPct ?? null,
        todayRank: health.narrativeSignal?.todayRank ?? null,
        baselineAvgRank: health.narrativeSignal?.baselineAvgRank ?? null,
        fitScoreTagCounts,
        rootCauseTriggered: health.rootCauseTriggered,
        opportunityTriggered: health.opportunityTriggered,
        daypartGapChanges: raw.daypartOpportunity.map((d) => d.gap_change),
      }),
    };
    const momentumRows: ProgramMomentumRow[] = health.momentumItems
      .filter((m) => m.momentum !== null)
      .sort((a, b) => (b.momentum ?? 0) - (a.momentum ?? 0))
      .map((m) => ({ programId: m.programId, canonicalName: m.canonicalName, momentum: m.momentum, label: m.label }));
    programMomentum = momentumRows.length > 0 ? { available: true, data: momentumRows } : { available: false, reason: "모멘텀을 계산할 수 있는 프로그램이 없습니다(최근 편성·표본 부족)" };
  }

  return {
    verdict,
    kpiCards,
    hourlyProfile,
    programsBySlotDeviation,
    originalReview,
    enaLiveAiring,
    audienceReaction,
    competitorSameSlot,
    thingsToVerify,
    skyUhd,
    targetHourlyPattern: buildTargetHourlyPatternSection(raw),
    programAudienceCross: buildProgramAudienceCrossFromDaily(raw),
    competitorScheduleChanges: buildCompetitorScheduleChangesSection(raw),
    healthScore,
    programMomentum,
  };
}

// ---------------- MODE B ----------------
export interface ModeBExtra {
  originalReview: OriginalReviewSection | null;
  enaLiveAiring: EnaLiveAiringSection | null;
  skyUhd: SkyUhdSubstituteSection | null;
  bestDayDetail: BestWorstDayDetail | null;
  worstDayDetail: BestWorstDayDetail | null;
}

function movingAverage(points: { date: string; avgRating: number | null }[], window = 7): (number | null)[] {
  return points.map((_, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1).map((p) => p.avgRating).filter((v): v is number => v !== null);
    return slice.length > 0 ? slice.reduce((s, v) => s + v, 0) / slice.length : null;
  });
}

export function buildModeBSection(raw: AudienceReportRawData, extra: ModeBExtra): ModeBSection {
  const p = raw.periodReport;
  const isSkyUhd = raw.channelCode === "SKYUHD";
  const isGroupA = raw.group.code === "A";

  const validTrend = raw.trend.filter((t) => t.avgRating !== null);
  const shape: ModeBSection["summary"]["shape"] =
    validTrend.length < 3
      ? "변동"
      : (() => {
          const mid = Math.floor(validTrend.length / 2);
          const first = validTrend.slice(0, mid || 1);
          const second = validTrend.slice(mid || 1);
          const avg = (arr: typeof validTrend) => arr.reduce((s, v) => s + (v.avgRating ?? 0), 0) / arr.length;
          const d = avg(second) - avg(first);
          if (Math.abs(d) < (p?.avg_rating ?? 0) * 0.05) return "횡보";
          return d > 0 ? "상승" : "하락";
        })();

  const mas = movingAverage(raw.trend);
  const dailyTrendPoints: DailyTrendChartPoint[] = raw.trend.map((t, i) => ({ date: t.date, rating: t.avgRating, movingAvg: mas[i] }));

  const weekdayCells: WeekdayHourCell[] = (raw.dowHourBlockPattern as { dow: number; dow_label: string; hour_block: number; avg_rating: number | null; sample_count: number }[]).map((r) => ({
    dow: r.dow,
    dowLabel: r.dow_label,
    hourBlock: r.hour_block,
    avgRating: r.avg_rating,
    sampleCount: r.sample_count,
  }));
  const weekdayHourHeatmap: ModeBSection["weekdayHourHeatmap"] =
    !isSkyUhd && weekdayCells.length > 0
      ? { available: true, data: { cells: weekdayCells, caption: baseCaption(raw, "최근 84일 요일×시간대(3시간 단위) 평균 시청률") } }
      : { available: false, reason: isSkyUhd ? "skyUHD는 요일×시간대 자료가 제한적입니다" : "요일×시간대 자료가 없습니다" };

  const originalReview: ModeBSection["originalReview"] = isGroupA && extra.originalReview
    ? { available: true, data: extra.originalReview }
    : { available: false, reason: "오리지널·독점 콘텐츠 리뷰는 Group A 전용입니다" };
  const enaLiveAiring: ModeBSection["enaLiveAiring"] = raw.channelCode === "ENA" && extra.enaLiveAiring
    ? { available: true, data: extra.enaLiveAiring }
    : { available: false, reason: "ENA 본방송 실적은 ENA 채널 리포트에서만 제공됩니다" };

  const { growth, weakness } = computeGrowthWeaknessMovers(raw.programMovers, 5);
  const programContribution: ModeBSection["programContribution"] =
    !isSkyUhd && (growth.length > 0 || weakness.length > 0) ? { available: true, data: { growth, weakness } } : { available: false, reason: "프로그램 기여도 자료가 없습니다" };

  const audienceComposition: ModeBSection["audienceComposition"] =
    !isSkyUhd && raw.demographics.length > 0
      ? { available: true, data: raw.demographics.map((d) => ({ targetLabel: d.target_label, value: d.period_avg_rating, deltaPct: d.delta_pct })) }
      : { available: false, reason: isSkyUhd ? "skyUHD는 연령·성별 12구간 자료가 없습니다" : "타깃 구성 자료가 없습니다" };

  const bestWorstDay: ModeBSection["bestWorstDay"] =
    extra.bestDayDetail || extra.worstDayDetail
      ? { available: true, data: { best: extra.bestDayDetail, worst: extra.worstDayDetail } }
      : { available: false, reason: "최고일·최저일을 특정할 수 없습니다" };

  const structuralVerdict = computeStructuralVsTemporary(raw.trend);

  const skyUhd: ModeBSection["skyUhd"] = isSkyUhd && extra.skyUhd ? { available: true, data: extra.skyUhd } : { available: false, reason: "skyUHD 전용 섹션입니다" };

  return {
    summary: { avgRating: p?.avg_rating ?? null, shape },
    kpiCards: buildKpiCards(raw, null),
    dailyTrend: { points: dailyTrendPoints, caption: baseCaption(raw, "일별 평균 시청률 + 7일 이동평균") },
    weekdayHourHeatmap,
    originalReview,
    enaLiveAiring,
    programContribution,
    audienceComposition,
    bestWorstDay,
    structuralVerdict,
    skyUhd,
    targetHourlyPattern: buildTargetHourlyPatternSection(raw),
    programAudienceCross: buildProgramAudienceCrossFromPeriod(raw),
    competitorScheduleChanges: buildCompetitorScheduleChangesSection(raw),
  };
}

// ---------------- MODE C ----------------
export interface ModeCExtra {
  periodBKpi: { avgShare: number | null; avgReach: number | null; avgTimeSpentSeconds: number | null };
  rankPeriodA: { avgRank: number | null } | null;
  rankPeriodB: { avgRank: number | null } | null;
  originalReviewA: OriginalReviewSection | null;
  originalReviewB: OriginalReviewSection | null;
  skyUhdA: SkyUhdSubstituteSection | null;
  skyUhdB: SkyUhdSubstituteSection | null;
}

export function buildModeCSection(raw: AudienceReportRawData, extra: ModeCExtra): ModeCSection {
  const p = raw.periodReport;
  const isGroupA = raw.group.code === "A";
  const lengthA = Math.round((new Date(`${raw.period.dateTo}T00:00:00`).getTime() - new Date(`${raw.period.dateFrom}T00:00:00`).getTime()) / 86400000) + 1;
  const lengthB = Math.round((new Date(`${raw.period.priorDateTo}T00:00:00`).getTime() - new Date(`${raw.period.priorDateFrom}T00:00:00`).getTime()) / 86400000) + 1;

  const ratingA = p?.avg_rating ?? null;
  const ratingB = p?.prior_period_avg_rating ?? null;
  const changePct = p?.prior_period_change_pct ?? null;

  const growth = raw.programMovers.filter((m) => m.ratingDelta !== null).sort((a, b) => (b.ratingDelta ?? 0) - (a.ratingDelta ?? 0));
  const topContributor = growth[0]?.canonicalName ?? null;

  const kpiRows: KpiCompareRow[] = [
    { label: "Rating", periodA: ratingA, periodB: ratingB, absoluteChange: ratingA !== null && ratingB !== null ? ratingA - ratingB : null, pctChange: changePct, formattedA: formatRating(ratingA, raw.channelCode), formattedB: formatRating(ratingB, raw.channelCode) },
    { label: "Share", periodA: p?.avg_share ?? null, periodB: extra.periodBKpi.avgShare, absoluteChange: p?.avg_share != null && extra.periodBKpi.avgShare != null ? p.avg_share - extra.periodBKpi.avgShare : null, pctChange: pctChange(p?.avg_share ?? null, extra.periodBKpi.avgShare), formattedA: formatPercent(p?.avg_share ?? null), formattedB: formatPercent(extra.periodBKpi.avgShare) },
    { label: "Reach", periodA: p?.avg_reach ?? null, periodB: extra.periodBKpi.avgReach, absoluteChange: p?.avg_reach != null && extra.periodBKpi.avgReach != null ? p.avg_reach - extra.periodBKpi.avgReach : null, pctChange: pctChange(p?.avg_reach ?? null, extra.periodBKpi.avgReach), formattedA: formatPercent(p?.avg_reach ?? null), formattedB: formatPercent(extra.periodBKpi.avgReach) },
    {
      label: "시청시간(초)",
      periodA: p?.avg_time_spent_seconds ?? null,
      periodB: extra.periodBKpi.avgTimeSpentSeconds,
      absoluteChange: p?.avg_time_spent_seconds != null && extra.periodBKpi.avgTimeSpentSeconds != null ? p.avg_time_spent_seconds - extra.periodBKpi.avgTimeSpentSeconds : null,
      pctChange: pctChange(p?.avg_time_spent_seconds ?? null, extra.periodBKpi.avgTimeSpentSeconds),
      formattedA: p?.avg_time_spent_seconds != null ? Math.round(p.avg_time_spent_seconds).toString() : "—",
      formattedB: extra.periodBKpi.avgTimeSpentSeconds != null ? Math.round(extra.periodBKpi.avgTimeSpentSeconds).toString() : "—",
    },
    {
      label: "순위",
      periodA: extra.rankPeriodA?.avgRank ?? null,
      periodB: extra.rankPeriodB?.avgRank ?? null,
      absoluteChange: extra.rankPeriodA?.avgRank != null && extra.rankPeriodB?.avgRank != null ? extra.rankPeriodA.avgRank - extra.rankPeriodB.avgRank : null,
      pctChange: pctChange(extra.rankPeriodA?.avgRank ?? null, extra.rankPeriodB?.avgRank ?? null),
      formattedA: extra.rankPeriodA?.avgRank != null ? extra.rankPeriodA.avgRank.toFixed(1) : "확인 불가",
      formattedB: extra.rankPeriodB?.avgRank != null ? extra.rankPeriodB.avgRank.toFixed(1) : "확인 불가",
    },
  ];

  const byName = new Map<string, ProgramChangeRow>();
  for (const m of raw.programMovers) {
    const isNew = (m.priorAirCount ?? 0) === 0 && (m.periodAirCount ?? 0) > 0;
    const isEnded = (m.periodAirCount ?? 0) === 0 && (m.priorAirCount ?? 0) > 0;
    byName.set(normalizeProgramCanonicalName(m.canonicalName), {
      canonicalName: m.canonicalName,
      kind: isNew ? "신규" : isEnded ? "종영" : "유지",
      periodAvgRating: m.periodAvgRating,
      priorAvgRating: m.priorAvgRating,
      ratingDelta: m.ratingDelta,
    });
  }
  const changeBreakdown = Array.from(byName.values()).sort((a, b) => Math.abs(b.ratingDelta ?? 0) - Math.abs(a.ratingDelta ?? 0));

  const originalReviewCompare: ModeCSection["originalReviewCompare"] =
    isGroupA && extra.originalReviewA && extra.originalReviewB
      ? { available: true, data: { periodA: extra.originalReviewA, periodB: extra.originalReviewB } }
      : { available: false, reason: "오리지널·독점 콘텐츠 대조는 Group A 전용입니다" };

  const hb = raw.hourBlockOpportunity as { hour_block: number; our_full_avg: number | null; our_recent_avg: number | null }[];
  const hourBlockShift: HourBlockDeltaRow[] = hb.map((r) => ({
    hourBlock: r.hour_block,
    periodA: r.our_recent_avg,
    periodB: r.our_full_avg,
    delta: r.our_recent_avg !== null && r.our_full_avg !== null ? r.our_recent_avg - r.our_full_avg : null,
  }));

  const audienceShift: ModeCSection["audienceShift"] =
    raw.demographics.length > 0
      ? { available: true, data: raw.demographics.map((d) => ({ label: d.target_label, periodA: d.period_avg_rating, periodB: d.prior_avg_rating, delta: d.period_avg_rating !== null && d.prior_avg_rating !== null ? d.period_avg_rating - d.prior_avg_rating : null })) }
      : { available: false, reason: "타깃 이동 자료가 없습니다" };

  const newPrograms = changeBreakdown.filter((r) => r.kind === "신규").map((r) => r.canonicalName);
  const endedPrograms = changeBreakdown.filter((r) => r.kind === "종영").map((r) => r.canonicalName);

  const shareA = p?.avg_share ?? null;
  const shareB = extra.periodBKpi.avgShare;
  const ratingDirection = ratingA === null || ratingB === null || ratingA === ratingB ? "flat" : ratingA > ratingB ? "up" : "down";
  const shareDirection = shareA === null || shareB === null || shareA === shareB ? "flat" : shareA > shareB ? "up" : "down";
  const ratingShareSplit: ModeCSection["ratingShareSplit"] = {
    ratingDirection,
    shareDirection,
    note:
      ratingDirection !== shareDirection && ratingDirection !== "flat" && shareDirection !== "flat"
        ? "시청률과 점유율의 방향이 다릅니다 — 전체 TV 이용량(HUT/PUT) 데이터가 없어 시장 전체가 줄었다고 단정하지 않습니다. 관찰된 사실만 기록합니다."
        : null,
  };

  return {
    changeSummary: { direction: ratingDirection, magnitude: changePct, topContributor, lengthMismatchNote: lengthA !== lengthB ? `두 기간의 길이가 다릅니다(기간A ${lengthA}일 vs 기간B ${lengthB}일).` : null },
    kpiCompareTable: { rows: kpiRows, caption: baseCaption(raw, "기간A vs 기간B 절대 변화량 및 % 변화") },
    changeBreakdown,
    originalReviewCompare,
    hourBlockShift: { rows: hourBlockShift, caption: baseCaption(raw, "8구간(3시간 단위) 시간대별 시청률 이동") },
    audienceShift,
    schedulingDifference: { newPrograms, endedPrograms },
    ratingShareSplit,
    skyUhd: raw.channelCode === "SKYUHD" && extra.skyUhdA && extra.skyUhdB ? { available: true, data: { periodA: extra.skyUhdA, periodB: extra.skyUhdB } } : { available: false, reason: "skyUHD 전용 섹션입니다" },
    targetHourlyPattern: buildTargetHourlyPatternSection(raw),
    programAudienceCross: buildProgramAudienceCrossFromPeriod(raw),
    competitorScheduleChanges: buildCompetitorScheduleChangesSection(raw),
  };
}

// ---------------- MODE D ----------------
export interface ModeDExtra {
  comparisonMatrix: ComparisonMatrixRow[];
  turningPoints: import("./analyzer").TurningPoint[];
  originalLineup: OriginalReviewSection | null;
  skyUhd: SkyUhdSubstituteSection | null;
  rankAvg: { current: number | null; prior: number | null } | null;
}

export function buildModeDSection(raw: AudienceReportRawData, extra: ModeDExtra): ModeDSection {
  const p = raw.periodReport;
  const isGroupA = raw.group.code === "A";
  const isSkyUhd = raw.channelCode === "SKYUHD";

  const daysRemaining = (() => {
    // 프리셋에 따라 남은 기간을 정확히 계산하려면 상위 컨텍스트(월/분기/연 경계)가 필요하다 — 이번
    // Phase는 dateTo가 "오늘"일 때만 의미가 있으므로, dateTo 기준 정보가 없으면 null로 정직하게 둔다.
    return null;
  })();

  const convergencePoints: CumulativeConvergencePoint[] = (() => {
    let sum = 0;
    let count = 0;
    return raw.trend.map((t, i) => {
      if (t.avgRating !== null) {
        sum += t.avgRating;
        count += 1;
      }
      const recentSlice = raw.trend.slice(Math.max(0, i - 6), i + 1).map((x) => x.avgRating).filter((v): v is number => v !== null);
      const recentAvg = recentSlice.length > 0 ? recentSlice.reduce((s, v) => s + v, 0) / recentSlice.length : null;
      return { date: t.date, cumulativeAvg: count > 0 ? sum / count : null, recentAvg };
    });
  })();

  const breakdown: BreakdownRow[] =
    raw.trendGranularity === "daily"
      ? []
      : raw.trend.map((t) => ({ label: t.date, avgRating: t.avgRating, daysWithData: 1 }));

  const originalLineup: ModeDSection["originalLineup"] = isGroupA && extra.originalLineup
    ? { available: true, data: extra.originalLineup }
    : { available: false, reason: "오리지널 라인업 성과는 Group A 전용입니다" };

  const topContributors = [...raw.programMovers].filter((m) => m.periodAvgRating !== null).sort((a, b) => (b.periodAvgRating ?? 0) - (a.periodAvgRating ?? 0)).slice(0, 10);

  const skyUhd: ModeDSection["skyUhd"] = isSkyUhd && extra.skyUhd ? { available: true, data: extra.skyUhd } : { available: false, reason: "skyUHD 전용 섹션입니다" };

  // N절 Phase 2b(2026-09-01) — daypart Win/Weakness(이미 계산되던 값을 처음 연결), Program
  // Portfolio(Fit Score Top/Weak, MODE A와 같은 조회를 raw.fitScoreItems로 공유).
  const daypartWinWeakness = computeDaypartWinWeakness(raw.daypartOpportunity);
  const strongPrograms = raw.fitScoreItems.filter((f) => f.tag === "STRENGTHEN" || f.tag === "KEEP").sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)).slice(0, 5);
  const weakPrograms = raw.fitScoreItems.filter((f) => f.tag === "REPLACE").sort((a, b) => (a.fitScore ?? 0) - (b.fitScore ?? 0)).slice(0, 5);
  const programPortfolio: ModeDSection["programPortfolio"] =
    isSkyUhd
      ? { available: false, reason: "skyUHD는 Program Portfolio(Fit Score)를 제공하지 않습니다" }
      : strongPrograms.length > 0 || weakPrograms.length > 0
        ? { available: true, data: { strong: strongPrograms, weak: weakPrograms } }
        : { available: false, reason: "Fit Score 계산 대상 프로그램이 없습니다" };

  return {
    currentPosition: {
      cumulativeAvg: p?.avg_rating ?? null,
      targetRating: raw.masterInfo.targetRating,
      gapToTarget: p?.avg_rating != null && raw.masterInfo.targetRating != null ? p.avg_rating - raw.masterInfo.targetRating : null,
      daysRemaining,
    },
    kpiCards: buildKpiCards(raw, extra.rankAvg),
    convergence: { points: convergencePoints, caption: baseCaption(raw, "누적 평균 수렴선 + 최근 7일 평균") },
    comparisonMatrix: { rows: extra.comparisonMatrix, caption: baseCaption(raw, "DoD·WoW·MoM·QoQ·YoY 각 프리셋의 기간 평균 대비 변화") },
    breakdown: { granularity: raw.trendGranularity === "weekly" ? "week" : raw.trendGranularity === "monthly" ? "month" : "week", rows: breakdown },
    originalLineup,
    turningPoints: extra.turningPoints,
    topContributors,
    skyUhd,
    targetHourlyPattern: buildTargetHourlyPatternSection(raw),
    programAudienceCross: buildProgramAudienceCrossFromPeriod(raw),
    competitorScheduleChanges: buildCompetitorScheduleChangesSection(raw),
    daypartWinWeakness,
    programPortfolio,
  };
}
