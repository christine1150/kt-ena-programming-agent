// Phase 1(2026-08-28, Audience Intelligence Report 계획서 J절 6번) — "이 채널·이 기간에 필요한
// 원본 데이터를 다 모아온다"까지만 담당한다. 분석·판정·문장 생성은 다음 Phase(분석 엔진/오리지널
// 콘텐츠 엔진/skyUHD 교차 엔진)의 몫 — 이 파일은 새 계산을 하지 않고 이미 검증된 RPC를 그대로
// 호출해 원본 행을 모아 반환한다(CLAUDE.md: DB가 계산, 이 계층은 조합만).
import { supabase } from "@/lib/supabase";
import { resolveProgramLevelTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { groupForChannel, isSkyUhd, type AudienceGroup } from "./targetGroups";
import type { ResolvedAudiencePeriod } from "./periodResolver";
import { getChannelMasterInfo, type ChannelMasterInfo } from "./masterData";

export interface DailyTrendPoint {
  date: string; // "주별"이면 week_start, "월별"이면 month_start를 그대로 date 필드에 담는다(호출부가 granularity로 구분)
  avgRating: number | null;
}
export type TrendGranularity = "daily" | "weekly" | "monthly";

export interface ProgramMoverRow {
  canonicalName: string;
  periodAvgRating: number | null;
  periodAirCount: number | null;
  priorAvgRating: number | null;
  priorAirCount: number | null;
  ratingDelta: number | null;
}

export interface SkyUhdProgramLogRow {
  broadcastDate: string;
  startTime: string;
  canonicalName: string;
  rating: number | null;
}

export interface AudienceReportRawData {
  channelCode: string;
  group: AudienceGroup;
  period: ResolvedAudiencePeriod;
  // 타깃 라벨 — 그룹 primaryTargetLabel과 항상 같은 값이어야 하지만(§01 확정 규칙), 실제 조회에
  // 쓴 정확한 값을 그대로 남겨 다음 Phase가 재해석하지 않고 그대로 쓰게 한다.
  programTargetLabel: string; // 타깃상세 시트 표기 — 프로그램·시간대 단위 RPC용
  rankTargetLabel: string; // 랭킹 시트 표기 — 채널 순위·경쟁채널 비교 RPC용

  periodReport: {
    days_with_data: number;
    avg_rating: number | null;
    avg_share: number | null;
    avg_reach: number | null;
    avg_time_spent_seconds: number | null;
    prior_period_avg_rating: number | null;
    prior_period_change_pct: number | null;
    baseline_avg_rating: number | null;
    baseline_change_pct: number | null;
    best_date: string | null;
    best_rating: number | null;
    worst_date: string | null;
    worst_rating: number | null;
  } | null;

  trend: DailyTrendPoint[];
  trendGranularity: TrendGranularity;

  programMovers: ProgramMoverRow[];

  daypartOpportunity: { daypart: string; gap_change: number | null }[];
  hourBlockOpportunity: unknown[]; // 8구간 상세 — 다음 Phase가 필요한 필드만 골라 씀(원본 그대로 보관)
  dowHourBlockPattern: unknown[]; // 요일×3시간 히트맵 원본

  topPrograms: { program_name: string; avg_rating: number | null }[];

  demographics: { target_label: string; period_avg_rating: number | null; prior_avg_rating: number | null; delta_pct: number | null }[];

  competitorInsight: unknown[]; // get_competitor_insight_report 원본
  competitorTopPrograms: { competitor_name: string; program_name: string; program_avg_rating: number | null }[];

  masterInfo: ChannelMasterInfo;

  // skyUHD 전용(그 외 채널은 항상 null) — 수기 업로드 프로그램 로그. 두 소스 교차 계산은 다음
  // Phase(skyUHD 교차 엔진)의 몫, 여기서는 원본만 가져온다.
  skyUhdProgramLog: SkyUhdProgramLogRow[] | null;
}

// dashboard/channel/route.ts(2026-08-21, 기능 #15-3/#15-4)와 동일한 규칙 — 새로 만들지 않고
// 그대로 재사용: daypart/hourblock 트레일링 윈도우는 "최근 구간"(recentDays) + 84일 이상 여백을
// 둔 baseline(fullWindowDays)으로 분리하고, 히트맵/TOP20 윈도우(periodWindowDays)는 7일 이하면
// 84일 고정, 그보다 길면 선택 기간 전체를 쓴다.
function computeWindows(dateFrom: string, dateTo: string) {
  const rangeDays = Math.round((new Date(`${dateTo}T00:00:00`).getTime() - new Date(`${dateFrom}T00:00:00`).getTime()) / 86400000) + 1;
  const recentDays = rangeDays > 1 ? rangeDays : 7;
  const fullWindowDays = Math.max(365, recentDays + 84);
  const periodWindowDays = rangeDays > 7 ? rangeDays : 84;
  return { rangeDays, recentDays, fullWindowDays, periodWindowDays };
}

// 기간 길이에 따라 추이 차트 해상도를 고른다 — 31일 이하는 일별, 32~180일은 주별, 그 이상은
// 월별(설계서 §06 MODE B/D가 요구하는 "일자별 추이"/"누적 수렴 곡선"에 맞는 해상도). 정해진 값이
// 아니라 조정 가능한 v1 기준 — Health Score/Turning Point 때와 같은 설계 원칙.
function pickTrendGranularity(rangeDays: number): TrendGranularity {
  if (rangeDays <= 31) return "daily";
  if (rangeDays <= 180) return "weekly";
  return "monthly";
}

export async function collectAudienceReportData(channelCode: string, period: ResolvedAudiencePeriod): Promise<AudienceReportRawData> {
  const group = groupForChannel(channelCode);

  const { data: channelRow, error: channelError } = await supabase.from("channels").select("primary_target").eq("code", channelCode).maybeSingle();
  if (channelError || !channelRow) throw new Error(`채널을 찾을 수 없습니다: ${channelCode}`);
  const programTargetLabel = resolveProgramLevelTargetLabel(channelRow.primary_target);
  const rankTargetLabel = resolveRankSheetTargetLabel(channelRow.primary_target);

  const { dateFrom, dateTo, priorDateFrom, priorDateTo } = period;
  const { rangeDays, recentDays, fullWindowDays, periodWindowDays } = computeWindows(dateFrom, dateTo);
  const trendGranularity = pickTrendGranularity(rangeDays);
  const trendRpcName = trendGranularity === "daily" ? "get_channel_daily_rating_trend" : trendGranularity === "weekly" ? "get_channel_weekly_rating_trend" : "get_channel_monthly_rating_trend";

  // 실측 확인(2026-08-28): skyUHD의 nielsen_daily 데이터는 "National 유료방송가입가구"(랭킹
  // 시트 표기) 단 하나의 타깃에만 채널 단위(program_id is null) 행이 있다 — programTargetLabel
  // ("전국 유료가구", 타깃상세 표기)로는 skyUHD 행이 하나도 안 잡힌다(0건, 실측). 그리고 skyUHD는
  // nielsen_daily에 프로그램 단위(program_id is not null) 행이 애초에 0건이라(수기 업로드
  // 프로그램은 target_id가 NULL이라 이 RPC들의 타깃 조인에 전혀 걸리지 않음), daypart/hourblock/
  // dow-hourblock/top-programs 4종은 skyUHD에서 호출해도 항상 빈 결과라 아예 건너뛴다(불필요한
  // 왕복 절약 + 설계서 §05 "타깃/Share/Reach 축은 skyUHD에서 렌더링하지 않는다" 원칙과 일치).
  const skyUhd = isSkyUhd(channelCode);
  const trendTargetLabel = skyUhd ? rankTargetLabel : programTargetLabel;
  const EMPTY: Promise<{ data: never[] }> = Promise.resolve({ data: [] });

  const [periodReportRes, trendRes, moversRes, daypartRes, hourBlockRes, dowHourBlockRes, topProgramsRes, demographicsRes, competitorInsightRes, competitorTopRes, masterInfo, skyUhdLogRes] =
    await Promise.all([
      supabase.rpc("get_rating_period_report", {
        p_channel_code: channelCode,
        p_target_label: rankTargetLabel,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_baseline_days: 84,
        p_prior_date_from: priorDateFrom,
        p_prior_date_to: priorDateTo,
      }),
      supabase.rpc(trendRpcName, { p_channel_code: channelCode, p_target_label: trendTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
      skyUhd
        ? EMPTY
        : supabase.rpc("get_channel_period_program_movers", {
            p_channel_code: channelCode,
            p_program_target_label: programTargetLabel,
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_prior_date_from: priorDateFrom,
            p_prior_date_to: priorDateTo,
            p_limit: 20,
          }),
      skyUhd
        ? EMPTY
        : supabase.rpc("get_channel_daypart_opportunity", {
            p_channel_code: channelCode,
            p_program_target_label: programTargetLabel,
            p_as_of_date: dateTo,
            p_full_window_days: fullWindowDays,
            p_recent_days: recentDays,
          }),
      skyUhd
        ? EMPTY
        : supabase.rpc("get_channel_hourblock_opportunity", {
            p_channel_code: channelCode,
            p_program_target_label: programTargetLabel,
            p_as_of_date: dateTo,
            p_full_window_days: fullWindowDays,
            p_recent_days: recentDays,
          }),
      skyUhd ? EMPTY : supabase.rpc("get_channel_dow_hourblock_pattern", { p_channel_code: channelCode, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays }),
      skyUhd ? EMPTY : supabase.rpc("get_channel_top_programs", { p_channel_code: channelCode, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays, p_limit: 20 }),
      supabase.rpc("get_channel_period_demographics", {
        p_channel_code: channelCode,
        p_demographic_labels: group.code === "A" ? ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"] : ["전국 여20대", "전국 남20대", "전국 여40대", "전국 남40대"],
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_prior_date_from: priorDateFrom,
        p_prior_date_to: priorDateTo,
      }),
      supabase.rpc("get_competitor_insight_report", { p_channel_code: channelCode, p_target_label: rankTargetLabel, p_as_of_date: dateTo, p_date_from: dateFrom }),
      supabase.rpc("get_competitor_period_top_programs", { p_channel_code: channelCode, p_target_label: rankTargetLabel, p_date_from: dateFrom, p_date_to: dateTo, p_channel_limit: 5, p_program_limit: 7 }),
      getChannelMasterInfo(channelCode),
      isSkyUhd(channelCode) ? supabase.rpc("get_skyuhd_program_log", { p_date_from: dateFrom, p_date_to: dateTo }) : Promise.resolve({ data: null }),
    ]);

  const rawTrend = (trendRes.data ?? []) as { broadcast_date?: string; week_start?: string; month_start?: string; avg_rating: number | null }[];
  const trend: DailyTrendPoint[] = rawTrend.map((t) => ({ date: t.broadcast_date ?? t.week_start ?? t.month_start ?? "", avgRating: t.avg_rating }));

  const rawMovers = (moversRes.data ?? []) as {
    canonical_name: string;
    period_avg_rating: number | null;
    period_air_count: number | null;
    prior_avg_rating: number | null;
    prior_air_count: number | null;
    rating_delta: number | null;
  }[];
  // 프로그램명 정규화(2026-08-28, 사용자 지시: "띄어쓰기는 정규화하여 같은 프로그램으로 인식할
  // 것") — programNameMatch.ts의 기존 함수 재사용, 새 정규화 로직 없음. 정규화 후 같은 이름이면
  // 합산(방영횟수 합, 시청률은 방영횟수 가중평균)해 한 행으로 합친다.
  const moversByNormalizedName = new Map<string, ProgramMoverRow & { _periodWeight: number; _priorWeight: number }>();
  for (const m of rawMovers) {
    const key = normalizeProgramCanonicalName(m.canonical_name);
    const periodAir = m.period_air_count ?? 0;
    const priorAir = m.prior_air_count ?? 0;
    const existing = moversByNormalizedName.get(key);
    if (!existing) {
      moversByNormalizedName.set(key, {
        canonicalName: m.canonical_name,
        periodAvgRating: m.period_avg_rating,
        periodAirCount: m.period_air_count,
        priorAvgRating: m.prior_avg_rating,
        priorAirCount: m.prior_air_count,
        ratingDelta: m.rating_delta,
        _periodWeight: periodAir,
        _priorWeight: priorAir,
      });
      continue;
    }
    const newPeriodWeight = existing._periodWeight + periodAir;
    const newPriorWeight = existing._priorWeight + priorAir;
    existing.periodAvgRating =
      newPeriodWeight > 0 ? ((existing.periodAvgRating ?? 0) * existing._periodWeight + (m.period_avg_rating ?? 0) * periodAir) / newPeriodWeight : existing.periodAvgRating;
    existing.priorAvgRating = newPriorWeight > 0 ? ((existing.priorAvgRating ?? 0) * existing._priorWeight + (m.prior_avg_rating ?? 0) * priorAir) / newPriorWeight : existing.priorAvgRating;
    existing.periodAirCount = (existing.periodAirCount ?? 0) + periodAir;
    existing.priorAirCount = (existing.priorAirCount ?? 0) + priorAir;
    existing.ratingDelta = (existing.periodAvgRating ?? 0) - (existing.priorAvgRating ?? 0);
    existing._periodWeight = newPeriodWeight;
    existing._priorWeight = newPriorWeight;
  }
  const programMovers: ProgramMoverRow[] = Array.from(moversByNormalizedName.values()).map((m) => ({
    canonicalName: m.canonicalName,
    periodAvgRating: m.periodAvgRating,
    periodAirCount: m.periodAirCount,
    priorAvgRating: m.priorAvgRating,
    priorAirCount: m.priorAirCount,
    ratingDelta: m.ratingDelta,
  }));

  const skyUhdProgramLog: SkyUhdProgramLogRow[] | null = isSkyUhd(channelCode)
    ? ((skyUhdLogRes.data ?? []) as { broadcast_date: string; start_time: string; canonical_name: string; rating: number | null }[]).map((r) => ({
        broadcastDate: r.broadcast_date,
        startTime: r.start_time,
        canonicalName: r.canonical_name,
        rating: r.rating,
      }))
    : null;

  return {
    channelCode,
    group,
    period,
    programTargetLabel,
    rankTargetLabel,
    periodReport: periodReportRes.data?.[0] ?? null,
    trend,
    trendGranularity,
    programMovers,
    daypartOpportunity: daypartRes.data ?? [],
    hourBlockOpportunity: hourBlockRes.data ?? [],
    dowHourBlockPattern: dowHourBlockRes.data ?? [],
    topPrograms: topProgramsRes.data ?? [],
    demographics: demographicsRes.data ?? [],
    competitorInsight: competitorInsightRes.data ?? [],
    competitorTopPrograms: competitorTopRes.data ?? [],
    masterInfo,
    skyUhdProgramLog,
  };
}
