// Phase 6(2026-08-28, 계획서 J절 §11-6/9) — 리포트 조립 진입점. 유일하게 새 I/O를 하는 곳:
// collectAudienceReportData(Phase 1) 위에 §06을 만족하는 데 필요한 "보강 조회"(전부 이미 있는
// RPC를 다른 파라미터로 한 번 더 부르는 것, 새 SQL 0개 — 계획서 §2 그대로)를 더한 뒤
// reportSections.ts의 순수 함수로 넘겨 모드별 섹션을 조립한다.
import { supabase } from "@/lib/supabase";
import { collectAudienceReportData, type AudienceReportRawData } from "./dataCollector";
import { resolveSingleDay, resolveRange, resolveCompare, resolveCumulative, type ResolvedAudiencePeriod } from "./periodResolver";
import type { PeriodPreset } from "./periodPresets";
import { computeComparisonRange } from "./periodPresets";
import { validateAudienceReportData } from "./validate";
import { getInSeasonFeaturedContent, getEpisodeRatingTrend, getDailyOriginalReview, type FeaturedContentWork, type EpisodePoint, type DailyOriginalReviewRow } from "./originalContent";
import { computeGenrePerformance, computeGenreHourCrossing, getSkyUhdDailyChannelTrend, computeProgramChannelContribution, computeCoverage } from "./skyUhdCross";
import type { SkyUhdProgramLogRow as SkyUhdRow } from "./dataCollector";
import { computeTurningPoints } from "./analyzer";
import { addDaysStr } from "./periodPresets";
import type { OriginalReviewSection, EnaLiveAiringSection, SkyUhdSubstituteSection, CompetitorInsightRow, ComparisonMatrixRow, AudienceReportDocument, BestWorstDayDetail } from "./reportModel";
import { buildModeASection, buildModeBSection, buildModeCSection, buildModeDSection } from "./reportSections";

export type AudienceReportRequest =
  | { mode: "single_day"; date: string }
  | { mode: "range"; dateFrom: string; dateTo: string }
  | { mode: "compare"; dateFrom: string; dateTo: string; priorDateFrom: string; priorDateTo: string }
  | { mode: "cumulative"; latest: string; preset: PeriodPreset; customFrom?: string; customTo?: string };

// Phase 8이 포트폴리오 리포트에서도 같은 기간 해석을 쓸 수 있도록 export로 승격 — 로직 변경 없음.
export function resolvePeriod(request: AudienceReportRequest): ResolvedAudiencePeriod | null {
  switch (request.mode) {
    case "single_day":
      return resolveSingleDay(request.date);
    case "range":
      return resolveRange(request.dateFrom, request.dateTo);
    case "compare":
      return resolveCompare(request.dateFrom, request.dateTo, request.priorDateFrom, request.priorDateTo);
    case "cumulative":
      return resolveCumulative(request.latest, request.preset, request.customFrom ?? "", request.customTo ?? "");
  }
}

// 오리지널 콘텐츠 회차 추이는 작품 수만큼 왕복이 늘어나므로(N+1), 리포트당 상위 8개 작품으로 제한한다
// — §09-4 "표본 부족" 원칙과 별개로, 왕복 폭주를 막기 위한 순수 성능상의 상한(정직하게 문서화).
const MAX_WORKS_FOR_EPISODE_TREND = 8;

async function collectOriginalReview(channelCode: string, period: ResolvedAudiencePeriod, isSingleDay: boolean): Promise<OriginalReviewSection | null> {
  const works: FeaturedContentWork[] = await getInSeasonFeaturedContent(channelCode, period.dateFrom, period.dateTo);
  if (works.length === 0) return { works: [], dailyReview: [], episodeTrends: [] };

  let dailyReview: DailyOriginalReviewRow[] = [];
  if (isSingleDay) {
    dailyReview = await getDailyOriginalReview(channelCode, period.dateTo);
  }

  let episodeTrends: { canonicalName: string; points: EpisodePoint[] }[] = [];
  if (!isSingleDay) {
    const rangeDays = Math.round((new Date(`${period.dateTo}T00:00:00`).getTime() - new Date(`${period.dateFrom}T00:00:00`).getTime()) / 86400000) + 1;
    const windowDays = Math.max(84, rangeDays);
    const targetWorks = works.slice(0, MAX_WORKS_FOR_EPISODE_TREND);
    episodeTrends = await Promise.all(
      targetWorks.map(async (w) => ({
        canonicalName: w.canonicalName,
        points: w.broadcastTime ? await getEpisodeRatingTrend(w.canonicalName, w.broadcastChannelCode, w.broadcastTime, period.dateTo, windowDays) : [],
      }))
    );
  }

  return { works, dailyReview, episodeTrends };
}

function buildEnaLiveAiring(isSingleDay: boolean, dailyReview: DailyOriginalReviewRow[], episodeTrends: { canonicalName: string; points: EpisodePoint[] }[]): EnaLiveAiringSection | null {
  if (isSingleDay) {
    const row = dailyReview.find((r) => r.matched_rating !== null);
    if (!row) return null;
    return { matchedRating: row.matched_rating, matchedShare: row.matched_share, matchedHouseholdRating: row.matched_household_rating, ageBreakdown: row.age_breakdown, programName: row.matched_program_name };
  }
  const allPoints = episodeTrends.flatMap((t) => t.points).filter((p) => p.rating2049 !== null);
  if (allPoints.length === 0) return null;
  const avgRating = allPoints.reduce((s, p) => s + (p.rating2049 ?? 0), 0) / allPoints.length;
  const householdPoints = allPoints.filter((p) => p.ratingHousehold !== null);
  const avgHousehold = householdPoints.length > 0 ? householdPoints.reduce((s, p) => s + (p.ratingHousehold ?? 0), 0) / householdPoints.length : null;
  return { matchedRating: avgRating, matchedShare: null, matchedHouseholdRating: avgHousehold, ageBreakdown: null, programName: null };
}

// Phase 8(2026-08-28, 계획서 J절 §07 "08 skyUHD 섹션")이 포트폴리오 리포트에서도 그대로 재사용
// 할 수 있도록 export로 승격 — 로직 변경 없음.
export async function collectSkyUhdSubstitute(dateFrom: string, dateTo: string, programLog: SkyUhdRow[] | null): Promise<SkyUhdSubstituteSection> {
  const log = programLog ?? [];
  const [genrePerformance, genreHourCrossing, dailyChannelTrend, coverage] = await Promise.all([
    Promise.resolve(computeGenrePerformance(log)),
    Promise.resolve(computeGenreHourCrossing(log)),
    getSkyUhdDailyChannelTrend(dateFrom, dateTo),
    Promise.resolve(computeCoverage(log, dateFrom, dateTo)),
  ]);
  const programContribution = computeProgramChannelContribution(log, dailyChannelTrend);
  return { genrePerformance, genreHourCrossing, programContribution, coverage };
}

function mapCompetitorInsight(rows: unknown[]): CompetitorInsightRow[] {
  return (rows as { competitor_name: string; today_rank: number | null; today_rating: number | null; baseline_avg_rating: number | null; delta_pct: number | null; top_program_name: string | null; top_program_start_time: string | null; top_program_rating: number | null }[]).map((r) => ({
    competitorName: r.competitor_name,
    todayRank: r.today_rank,
    todayRating: r.today_rating,
    baselineAvgRating: r.baseline_avg_rating,
    deltaPct: r.delta_pct,
    topProgramName: r.top_program_name,
    topProgramStartTime: r.top_program_start_time,
    topProgramRating: r.top_program_rating,
  }));
}

async function resolveTargetId(label: string): Promise<string | null> {
  const { data } = await supabase.from("targets").select("id").eq("label", label).maybeSingle();
  return data?.id ?? null;
}

async function fetchRankAvg(channelId: string, targetId: string | null, dateFrom: string, dateTo: string): Promise<{ avgRank: number | null } | null> {
  if (!targetId) return null;
  const { data } = await supabase.rpc("get_channel_period_rank_and_rating", { p_channel_id: channelId, p_target_id: targetId, p_date_from: dateFrom, p_date_to: dateTo });
  const row = (data ?? [])[0] as { avg_rank: number | null } | undefined;
  return row ? { avgRank: row.avg_rank } : null;
}

export async function buildAudienceReport(channelCode: string, request: AudienceReportRequest): Promise<AudienceReportDocument> {
  const period = resolvePeriod(request);
  if (!period) throw new Error("기간을 해석할 수 없습니다(직접 선택 모드에 날짜가 없는 등).");

  const raw: AudienceReportRawData = await collectAudienceReportData(channelCode, period);
  const qualityIssues = validateAudienceReportData(raw);

  const { data: channelRow } = await supabase.from("channels").select("id, name").eq("code", channelCode).maybeSingle();
  if (!channelRow) throw new Error(`채널을 찾을 수 없습니다: ${channelCode}`);

  const isGroupA = raw.group.code === "A";
  const isSkyUhd = channelCode === "SKYUHD";

  if (period.mode === "single_day") {
    const [hourlyBaselineRes, sameWeekdayRes, originalReview, competitorInsight] = await Promise.all([
      isSkyUhd ? Promise.resolve({ data: [] as unknown[] }) : supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channelCode, p_target_label: raw.programTargetLabel, p_date_from: addDaysStr(period.dateTo, -84), p_date_to: addDaysStr(period.dateTo, -1) }),
      supabase.rpc("get_channel_daily_rating_trend", { p_channel_code: channelCode, p_target_label: raw.rankTargetLabel, p_date_from: addDaysStr(period.dateTo, -7), p_date_to: period.dateTo }),
      isGroupA ? collectOriginalReview(channelCode, period, true) : Promise.resolve(null),
      Promise.resolve(mapCompetitorInsight(raw.competitorInsight)),
    ]);
    const hourlyBaseline = (hourlyBaselineRes.data ?? []) as { broadcast_hour: number; avg_rating: number | null; avg_share: number | null; avg_reach: number | null; avg_time_spent_seconds: number | null; program_count: number | null }[];
    const sameWeekdayRows = (sameWeekdayRes.data ?? []) as { broadcast_date: string; avg_rating: number | null }[];
    const sameWeekdayLastWeek = sameWeekdayRows.find((r) => r.broadcast_date === addDaysStr(period.dateTo, -7)) ?? null;
    const skyUhd = isSkyUhd ? await collectSkyUhdSubstitute(period.dateFrom, period.dateTo, raw.skyUhdProgramLog) : null;
    const enaLiveAiring = channelCode === "ENA" && originalReview ? buildEnaLiveAiring(true, originalReview.dailyReview, []) : null;

    const sections = buildModeASection(raw, {
      hourlyBaseline: hourlyBaseline.map((h) => ({ broadcastHour: h.broadcast_hour, avgRating: h.avg_rating, avgShare: h.avg_share, avgReach: h.avg_reach, avgTimeSpentSeconds: h.avg_time_spent_seconds, programCount: h.program_count })),
      sameWeekdayLastWeek: sameWeekdayLastWeek ? { date: sameWeekdayLastWeek.broadcast_date, avgRating: sameWeekdayLastWeek.avg_rating } : null,
      originalReview,
      enaLiveAiring,
      skyUhd,
      competitorInsight,
    });
    return { channelCode, channelName: channelRow.name, groupCode: raw.group.code, groupLabel: raw.group.label, period, masterInfo: raw.masterInfo, qualityIssues, body: { mode: "single_day", sections } };
  }

  if (period.mode === "range") {
    const p = raw.periodReport;
    const [originalReview, skyUhd, bestDayDetail, worstDayDetail] = await Promise.all([
      isGroupA ? collectOriginalReview(channelCode, period, false) : Promise.resolve(null),
      isSkyUhd ? collectSkyUhdSubstitute(period.dateFrom, period.dateTo, raw.skyUhdProgramLog) : Promise.resolve(null),
      !isSkyUhd && p?.best_date ? fetchDayDetail(channelCode, raw.programTargetLabel, p.best_date, p.best_rating) : Promise.resolve(null),
      !isSkyUhd && p?.worst_date ? fetchDayDetail(channelCode, raw.programTargetLabel, p.worst_date, p.worst_rating) : Promise.resolve(null),
    ]);
    const enaLiveAiring = channelCode === "ENA" && originalReview ? buildEnaLiveAiring(false, [], originalReview.episodeTrends) : null;

    const sections = buildModeBSection(raw, { originalReview, enaLiveAiring, skyUhd, bestDayDetail, worstDayDetail });
    return { channelCode, channelName: channelRow.name, groupCode: raw.group.code, groupLabel: raw.group.label, period, masterInfo: raw.masterInfo, qualityIssues, body: { mode: "range", sections } };
  }

  if (period.mode === "compare") {
    const targetId = await resolveTargetId(raw.rankTargetLabel);
    const [periodBReportRes, rankPeriodA, rankPeriodB, originalReviewA, originalReviewB, skyUhdBLogRes] = await Promise.all([
      supabase.rpc("get_rating_period_report", { p_channel_code: channelCode, p_target_label: raw.rankTargetLabel, p_date_from: period.priorDateFrom, p_date_to: period.priorDateTo, p_baseline_days: 84, p_prior_date_from: period.priorDateFrom, p_prior_date_to: period.priorDateTo }),
      fetchRankAvg(channelRow.id, targetId, period.dateFrom, period.dateTo),
      fetchRankAvg(channelRow.id, targetId, period.priorDateFrom, period.priorDateTo),
      isGroupA ? collectOriginalReview(channelCode, period, false) : Promise.resolve(null),
      isGroupA ? collectOriginalReview(channelCode, { ...period, dateFrom: period.priorDateFrom, dateTo: period.priorDateTo }, false) : Promise.resolve(null),
      isSkyUhd ? supabase.rpc("get_skyuhd_program_log", { p_date_from: period.priorDateFrom, p_date_to: period.priorDateTo }) : Promise.resolve({ data: null }),
    ]);
    const periodBReport = periodBReportRes.data?.[0] as { avg_share: number | null; avg_reach: number | null; avg_time_spent_seconds: number | null } | undefined;
    const skyUhdA = isSkyUhd ? await collectSkyUhdSubstitute(period.dateFrom, period.dateTo, raw.skyUhdProgramLog) : null;
    const skyUhdBLog = isSkyUhd
      ? ((skyUhdBLogRes.data ?? []) as { broadcast_date: string; start_time: string; canonical_name: string; rating: number | null }[]).map((r) => ({ broadcastDate: r.broadcast_date, startTime: r.start_time, canonicalName: r.canonical_name, rating: r.rating }))
      : [];
    const skyUhdB = isSkyUhd ? await collectSkyUhdSubstitute(period.priorDateFrom, period.priorDateTo, skyUhdBLog) : null;

    const sections = buildModeCSection(raw, {
      periodBKpi: { avgShare: periodBReport?.avg_share ?? null, avgReach: periodBReport?.avg_reach ?? null, avgTimeSpentSeconds: periodBReport?.avg_time_spent_seconds ?? null },
      rankPeriodA,
      rankPeriodB,
      originalReviewA,
      originalReviewB,
      skyUhdA,
      skyUhdB,
    });
    return { channelCode, channelName: channelRow.name, groupCode: raw.group.code, groupLabel: raw.group.label, period, masterInfo: raw.masterInfo, qualityIssues, body: { mode: "compare", sections } };
  }

  // MODE D(cumulative)
  const targetId = await resolveTargetId(raw.rankTargetLabel);
  const latest = period.dateTo;
  const matrixPresets: ("dod" | "wow" | "mom" | "qoq" | "yoy")[] = ["dod", "wow", "mom", "qoq", "yoy"];
  const [matrixResults, rankAvg, originalLineup, skyUhd] = await Promise.all([
    Promise.all(
      matrixPresets.map(async (preset) => {
        const range = computeComparisonRange(latest, preset);
        const { data } = await supabase.rpc("get_rating_period_report", { p_channel_code: channelCode, p_target_label: raw.rankTargetLabel, p_date_from: range.from, p_date_to: range.to, p_baseline_days: 84, p_prior_date_from: range.priorFrom, p_prior_date_to: range.priorTo });
        const row = data?.[0] as { avg_rating: number | null; prior_period_avg_rating: number | null; prior_period_change_pct: number | null } | undefined;
        const matrixRow: ComparisonMatrixRow = { preset, label: preset.toUpperCase(), currentAvg: row?.avg_rating ?? null, priorAvg: row?.prior_period_avg_rating ?? null, changePct: row?.prior_period_change_pct ?? null };
        return matrixRow;
      })
    ),
    fetchRankAvg(channelRow.id, targetId, period.dateFrom, period.dateTo),
    isGroupA ? collectOriginalReview(channelCode, period, false) : Promise.resolve(null),
    isSkyUhd ? collectSkyUhdSubstitute(period.dateFrom, period.dateTo, raw.skyUhdProgramLog) : Promise.resolve(null),
  ]);
  const turningPoints = computeTurningPoints(raw.trend);

  const sections = buildModeDSection(raw, {
    comparisonMatrix: matrixResults,
    turningPoints,
    originalLineup,
    skyUhd,
    rankAvg: rankAvg ? { current: rankAvg.avgRank, prior: null } : null,
  });
  return { channelCode, channelName: channelRow.name, groupCode: raw.group.code, groupLabel: raw.group.label, period, masterInfo: raw.masterInfo, qualityIssues, body: { mode: "cumulative", sections } };
}

async function fetchDayDetail(channelCode: string, programTargetLabel: string, date: string, rating: number | null): Promise<BestWorstDayDetail> {
  const [hourlyRes, titlesRes] = await Promise.all([
    supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channelCode, p_target_label: programTargetLabel, p_date_from: date, p_date_to: date }),
    supabase.rpc("get_hourly_program_titles", { p_channel_code: channelCode, p_target_label: programTargetLabel, p_date_from: date, p_date_to: date }),
  ]);
  const hourlyPoints = ((hourlyRes.data ?? []) as { broadcast_hour: number; avg_rating: number | null }[]).map((r) => ({ hour: r.broadcast_hour, rating: r.avg_rating }));
  const programNames = Array.from(
    new Set(((titlesRes.data ?? []) as { program_names: string }[]).flatMap((r) => r.program_names.split("/").map((s) => s.trim()).filter(Boolean)))
  );
  return { date, rating, hourlyPoints, programNames };
}
