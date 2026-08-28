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

// Phase 2(2026-08-28, 계획서 J절 2a) — 시간대 축(AXIS 2)·시간대×프로그램 교차용.
export interface HourlyPatternRow {
  broadcastHour: number; // 2~25시(방송시간 기준, get_hourly_rating_pattern 원본 그대로)
  avgRating: number | null;
  avgShare: number | null;
  avgReach: number | null;
  avgTimeSpentSeconds: number | null;
  programCount: number | null;
}
export interface HourlyProgramTitleRow {
  broadcastHour: number;
  programNames: string; // "프로그램A / 프로그램B" 형태(원본 그대로, 여러 날짜에 걸친 방영분을 "/" 조인)
}
// Phase 12(2026-08-28, 계획서 J절 Phase 12) — 슬롯 중복 점검에 요일을 반영하기 위한 dow 포함 버전.
// 기존 hourlyProgramTitles(시간대만)와 별개 필드 — Delta-Only 원칙(get_hourly_program_titles 자체는
// 안 건드림, Page 2 그래프 등 요일 구분이 필요 없는 기존 용도에 영향 없게).
export interface HourlyProgramTitleByDowRow {
  dow: number; // ISO 요일(1=월~7=일)
  broadcastHour: number;
  programNames: string;
}
// Phase 12 — 연령대×시간대 평균 시청률("어느 연령대가 어느 시간대에 몰리는지").
export interface TargetHourlyPatternRow {
  demographicLabel: string;
  broadcastHour: number;
  avgRating: number | null;
  sampleCount: number | null;
}
// Phase 12 — 기간 프로그램×타깃(MODE B/C/D 전용). 기존 DemographicProgramHighlight(단일 일자,
// today_value/baseline_avg)와 필드명을 다르게 둬(period_value/prior_value) 두 개념을 혼동하지 않게.
export interface PeriodDemographicProgramHighlight {
  program_name: string;
  demographic_label: string;
  metric: "rating" | "share" | "reach" | "time_spent_seconds" | "time_spent_share";
  period_value: number | null;
  prior_value: number | null;
  period_days: number | null;
  delta_pct: number | null;
}
// Phase 12 — 경쟁채널 편성 변화 이력(기간 누적). get_competitor_schedule_change_log 원본을 그대로
// camelCase로만 옮긴다(집계는 analyzer.ts의 몫).
export interface CompetitorScheduleChangeRow {
  competitorName: string;
  hourBlock: number;
  changedDate: string;
  changedProgram: string;
  changedRating: number | null;
  usualProgram: string | null;
  usualWeeksSeen: number;
}
// get_channel_demographic_program_highlights 원본(실측 확인, 2026-08-28) — 단일 일자 전용(기존
// 시스템 제약 그대로 승계, 새로 기간 확장하지 않음).
export interface DemographicProgramHighlight {
  program_name: string;
  program_start_time: string;
  demographic_label: string;
  metric: "share" | "rating" | "reach";
  today_value: number | null;
  baseline_avg: number | null;
  baseline_days: number | null;
  delta_pct: number | null;
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

  // Phase 2 추가(AXIS 2 시간대별 + 교차용). skyUHD는 daypart류와 같은 이유로 항상 빈 배열.
  hourlyPattern: HourlyPatternRow[];
  hourlyProgramTitles: HourlyProgramTitleRow[];
  // 단일 일자(MODE A)이고 skyUHD가 아닐 때만 채워진다 — 그 외에는 항상 빈 배열(기존 시스템도
  // 기간 확장판이 없어 같은 제약을 승계, 지어내지 않음).
  demographicProgramHighlights: DemographicProgramHighlight[];

  // Phase 12(2026-08-28) — 4개 신규 분석 축. 전부 additive(기존 필드는 그대로).
  targetHourlyPattern: TargetHourlyPatternRow[]; // skyUHD·light 모드는 항상 빈 배열
  periodDemographicProgramHighlights: PeriodDemographicProgramHighlight[]; // MODE A·skyUHD·light 모드는 항상 빈 배열(MODE A는 demographicProgramHighlights를 그대로 씀)
  competitorScheduleChangeLog: CompetitorScheduleChangeRow[]; // light 모드·페어링 없는 채널은 빈 배열
  hourlyProgramTitlesByDow: HourlyProgramTitleByDowRow[]; // skyUHD만 빈 배열 — light 모드에서도 유지(포트폴리오 슬롯 중복 점검이 필요로 함)

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

// dashboard/channel/route.ts의 fullDemographicTargets와 동일한 12구간(연령대×성별) 라벨 세트 —
// Phase 1이 실수로 4개(대표 연령대)만 썼던 것을 이번에 이 파일을 다시 만지는 김에 기존 시스템의
// 실제 관례(12구간 전체)로 맞춘다. 그룹 A는 "수도권", 그룹 B는 "전국" 접두어.
function fullDemographicLabels(groupCode: "A" | "B"): string[] {
  const prefix = groupCode === "A" ? "수도권" : "전국";
  const ages = ["10대", "20대", "30대", "40대", "50대", "60대+"];
  return ages.flatMap((age) => [`${prefix} 남${age}`, `${prefix} 여${age}`]);
}

// Phase 8(2026-08-28, 계획서 J절 §07) — 포트폴리오 리포트가 7개 채널을 동시에 모을 때 실 서버에서
// 응답이 30초를 넘기는 성능 문제를 실측으로 발견했다(원인: 채널당 15개 RPC × 7채널 = 최대 105개
// 동시 요청이 Supabase 커넥션 풀을 압박). opts.light=true면 포트폴리오가 실제로 안 쓰는 7개
// RPC(연령대·경쟁채널·TOP프로그램·8구간/요일별 세부 히트맵)를 건너뛰어 채널당 8개로 줄인다 —
// 기존 호출부(Phase 1~7, opts 생략)는 동작 변경 없음(기본값 false).
export async function collectAudienceReportData(channelCode: string, period: ResolvedAudiencePeriod, opts: { light?: boolean } = {}): Promise<AudienceReportRawData> {
  const { light = false } = opts;
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

  // Phase 2(2026-08-28): AXIS 2(시간대별)용 — daypart류와 같은 이유로 skyUHD는 건너뛴다.
  // demographicProgramHighlights는 기존 시스템도 단일 일자 전용이라(기간 확장판 없음), MODE A가
  // 아니거나 skyUHD면 호출하지 않는다.
  const wantsDemographicHighlights = period.mode === "single_day" && !skyUhd;

  const [
    periodReportRes,
    trendRes,
    moversRes,
    daypartRes,
    hourBlockRes,
    dowHourBlockRes,
    topProgramsRes,
    demographicsRes,
    competitorInsightRes,
    competitorTopRes,
    masterInfo,
    skyUhdLogRes,
    hourlyPatternRes,
    hourlyProgramTitlesRes,
    demographicHighlightsRes,
    targetHourlyPatternRes,
    periodDemographicHighlightsRes,
    competitorScheduleChangeLogRes,
    hourlyProgramTitlesByDowRes,
  ] = await Promise.all([
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
      light || skyUhd
        ? EMPTY
        : supabase.rpc("get_channel_hourblock_opportunity", {
            p_channel_code: channelCode,
            p_program_target_label: programTargetLabel,
            p_as_of_date: dateTo,
            p_full_window_days: fullWindowDays,
            p_recent_days: recentDays,
          }),
      light || skyUhd ? EMPTY : supabase.rpc("get_channel_dow_hourblock_pattern", { p_channel_code: channelCode, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays }),
      light || skyUhd ? EMPTY : supabase.rpc("get_channel_top_programs", { p_channel_code: channelCode, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays, p_limit: 20 }),
      light
        ? EMPTY
        : supabase.rpc("get_channel_period_demographics", {
            p_channel_code: channelCode,
            // Phase 1은 대표 4개 연령대만 썼는데, 기존 시스템(dashboard/channel/route.ts)의 실제 관례는
            // 12구간 전체(fullDemographicTargets)다 — 실측 확인(2026-08-28, ENA "오늘의 브리핑" 실측
            // 결과가 여50대/남50대 등 대표 4개 밖 연령대를 하이라이트로 뽑고 있었음) 후 이번에 맞춘다.
            p_demographic_labels: fullDemographicLabels(group.code),
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_prior_date_from: priorDateFrom,
            p_prior_date_to: priorDateTo,
          }),
      light ? EMPTY : supabase.rpc("get_competitor_insight_report", { p_channel_code: channelCode, p_target_label: rankTargetLabel, p_as_of_date: dateTo, p_date_from: dateFrom }),
      light ? EMPTY : supabase.rpc("get_competitor_period_top_programs", { p_channel_code: channelCode, p_target_label: rankTargetLabel, p_date_from: dateFrom, p_date_to: dateTo, p_channel_limit: 5, p_program_limit: 7 }),
      getChannelMasterInfo(channelCode),
      skyUhd ? supabase.rpc("get_skyuhd_program_log", { p_date_from: dateFrom, p_date_to: dateTo }) : Promise.resolve({ data: null }),
      skyUhd ? EMPTY : supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channelCode, p_target_label: programTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
      skyUhd ? EMPTY : supabase.rpc("get_hourly_program_titles", { p_channel_code: channelCode, p_target_label: programTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
      !light && wantsDemographicHighlights
        ? supabase.rpc("get_channel_demographic_program_highlights", {
            p_channel_code: channelCode,
            p_kpi_target_label: programTargetLabel,
            p_demographic_labels: fullDemographicLabels(group.code),
            p_as_of_date: dateTo,
            p_top_n_programs: 3,
            p_program_baseline_weeks: 8,
          })
        : EMPTY,
      // Phase 12 — 타깃×시간대(연령대별 시간대 프로파일). skyUHD는 program_id not null 행이 없어
      // 항상 빈 결과(daypart류와 같은 이유), light 모드(포트폴리오)는 채널별 리포트 전용 축이라 건너뜀.
      light || skyUhd
        ? EMPTY
        : supabase.rpc("get_channel_demographic_hourblock_pattern", {
            p_channel_code: channelCode,
            p_demographic_labels: fullDemographicLabels(group.code),
            p_date_from: dateFrom,
            p_date_to: dateTo,
          }),
      // Phase 12 — 기간 프로그램×타깃. MODE A는 demographicProgramHighlights(같은 요일 트레일링
      // baseline)를 그대로 쓰므로 여기서는 MODE B/C/D(period.mode !== "single_day")에서만 호출.
      light || skyUhd || period.mode === "single_day"
        ? EMPTY
        : supabase.rpc("get_channel_period_demographic_program_highlights", {
            p_channel_code: channelCode,
            p_kpi_target_label: programTargetLabel,
            p_demographic_labels: fullDemographicLabels(group.code),
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_prior_date_from: priorDateFrom,
            p_prior_date_to: priorDateTo,
            p_top_n_programs: 5,
          }),
      // Phase 12 — 경쟁채널 편성 변화 이력(기간 누적). 페어링 없는 채널은 RPC가 자연히 빈 배열을
      // 반환한다(competitor_program_ratings 자체가 채널당 경쟁채널 1개뿐이라는 기존 한계 그대로).
      light
        ? EMPTY
        : supabase.rpc("get_competitor_schedule_change_log", {
            p_channel_code: channelCode,
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_lookback_weeks: 4,
          }),
      // Phase 12 — 슬롯 중복 점검용 요일 인식 시간대별 프로그램명. light 모드에서도 유지(포트폴리오가
      // 반드시 필요로 함, 기존 hourlyProgramTitles와 동일한 취급).
      skyUhd
        ? EMPTY
        : supabase.rpc("get_hourly_program_titles_by_dow", { p_channel_code: channelCode, p_target_label: programTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
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

  const hourlyPattern: HourlyPatternRow[] = ((hourlyPatternRes.data ?? []) as {
    broadcast_hour: number;
    avg_rating: number | null;
    avg_share: number | null;
    avg_reach: number | null;
    avg_time_spent_seconds: number | null;
    program_count: number | null;
  }[]).map((r) => ({
    broadcastHour: r.broadcast_hour,
    avgRating: r.avg_rating,
    avgShare: r.avg_share,
    avgReach: r.avg_reach,
    avgTimeSpentSeconds: r.avg_time_spent_seconds,
    programCount: r.program_count,
  }));
  const hourlyProgramTitles: HourlyProgramTitleRow[] = ((hourlyProgramTitlesRes.data ?? []) as { broadcast_hour: number; program_names: string }[]).map((r) => ({
    broadcastHour: r.broadcast_hour,
    programNames: r.program_names,
  }));
  const demographicProgramHighlights: DemographicProgramHighlight[] = (demographicHighlightsRes.data ?? []) as DemographicProgramHighlight[];

  const targetHourlyPattern: TargetHourlyPatternRow[] = ((targetHourlyPatternRes.data ?? []) as {
    demographic_label: string;
    broadcast_hour: number;
    avg_rating: number | null;
    sample_count: number | null;
  }[]).map((r) => ({ demographicLabel: r.demographic_label, broadcastHour: r.broadcast_hour, avgRating: r.avg_rating, sampleCount: r.sample_count }));
  const periodDemographicProgramHighlights: PeriodDemographicProgramHighlight[] = (periodDemographicHighlightsRes.data ?? []) as PeriodDemographicProgramHighlight[];
  const competitorScheduleChangeLog: CompetitorScheduleChangeRow[] = ((competitorScheduleChangeLogRes.data ?? []) as {
    competitor_name: string;
    hour_block: number;
    changed_date: string;
    changed_program: string;
    changed_rating: number | null;
    usual_program: string | null;
    usual_weeks_seen: number;
  }[]).map((r) => ({
    competitorName: r.competitor_name,
    hourBlock: r.hour_block,
    changedDate: r.changed_date,
    changedProgram: r.changed_program,
    changedRating: r.changed_rating,
    usualProgram: r.usual_program,
    usualWeeksSeen: r.usual_weeks_seen,
  }));
  const hourlyProgramTitlesByDow: HourlyProgramTitleByDowRow[] = ((hourlyProgramTitlesByDowRes.data ?? []) as { dow: number; broadcast_hour: number; program_names: string }[]).map((r) => ({
    dow: r.dow,
    broadcastHour: r.broadcast_hour,
    programNames: r.program_names,
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
    hourlyPattern,
    hourlyProgramTitles,
    demographicProgramHighlights,
    hourBlockOpportunity: hourBlockRes.data ?? [],
    dowHourBlockPattern: dowHourBlockRes.data ?? [],
    topPrograms: topProgramsRes.data ?? [],
    demographics: demographicsRes.data ?? [],
    competitorInsight: competitorInsightRes.data ?? [],
    competitorTopPrograms: competitorTopRes.data ?? [],
    masterInfo,
    skyUhdProgramLog,
    targetHourlyPattern,
    periodDemographicProgramHighlights,
    competitorScheduleChangeLog,
    hourlyProgramTitlesByDow,
  };
}
