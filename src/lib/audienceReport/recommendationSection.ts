// Phase 9(2026-08-28, 계획서 J절 §08) — 편성 제언 섹션. 모든 리포트(MODE A~D)의 마지막에 항상
// 붙는 유일한 미래 지향 파트다. 참조 구간은 메인 분석 기간과 완전히 독립적 — 항상
// period.dateTo(latest)를 기준으로 뒤로 7일/30일을 센다(메인 기간이 30일 이상이면 30일 참조,
// 아니면 7일 참조 — 설계서 §08 표 그대로). 그래서 이 파일은 Phase 1의 collectAudienceReportData가
// 모은 메인 기간 데이터를 재사용하지 않고, 자신만의 작은 데이터 수집을 한다.
import { supabase } from "@/lib/supabase";
import { addDaysStr } from "./periodPresets";
import { computeGrowthWeaknessMovers, classifyHourBlockDiagnosis, type HourBlockOpportunityRow } from "./analyzer";
import { getUpcomingLineupTransitions } from "./originalContent";
import { isSkyUhd, isGroupA } from "./targetGroups";
import type { DailyTrendPoint, ProgramMoverRow } from "./dataCollector";
import type { RecommendationSection, WeekdayFlowPoint, SlotDiagnosisRow } from "./reportModel";

const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
function dowLabelOf(dateStr: string): string {
  const jsDow = new Date(`${dateStr}T00:00:00`).getDay(); // 0=일...6=토
  return DOW_LABELS[(jsDow + 6) % 7];
}

function computeWeekdayFlow(trend: DailyTrendPoint[]): WeekdayFlowPoint[] {
  const byDow = new Map<string, { sum: number; count: number }>();
  for (const t of trend) {
    if (t.avgRating === null) continue;
    const label = dowLabelOf(t.date);
    const bucket = byDow.get(label) ?? { sum: 0, count: 0 };
    bucket.sum += t.avgRating;
    bucket.count += 1;
    byDow.set(label, bucket);
  }
  return DOW_LABELS.map((label) => {
    const bucket = byDow.get(label);
    return { dowLabel: label, avgRating: bucket && bucket.count > 0 ? bucket.sum / bucket.count : null };
  });
}

const EMPTY: Promise<{ data: never[] }> = Promise.resolve({ data: [] });

export async function buildRecommendationSection(
  channelCode: string,
  programTargetLabel: string,
  rankTargetLabel: string,
  mainDateFrom: string,
  mainDateTo: string
): Promise<RecommendationSection> {
  const rangeDays = Math.round((new Date(`${mainDateTo}T00:00:00`).getTime() - new Date(`${mainDateFrom}T00:00:00`).getTime()) / 86400000) + 1;
  const windowDays = rangeDays >= 30 ? 30 : 7;
  const title = windowDays === 30 ? "지난달 → 이번달 편성 제언" : "지난주 → 이번주 편성 제언";
  const dateTo = mainDateTo;
  const dateFrom = addDaysStr(dateTo, -(windowDays - 1));
  const priorDateTo = addDaysStr(dateFrom, -1);
  const priorDateFrom = addDaysStr(dateFrom, -windowDays);

  const skyUhd = isSkyUhd(channelCode);
  const groupA = isGroupA(channelCode);
  const trendTargetLabel = skyUhd ? rankTargetLabel : programTargetLabel;

  const [trendRes, moversRes, hourBlockRes, lineupTransitions] = await Promise.all([
    supabase.rpc("get_channel_daily_rating_trend", { p_channel_code: channelCode, p_target_label: trendTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
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
      : supabase.rpc("get_channel_hourblock_opportunity", { p_channel_code: channelCode, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_full_window_days: 365, p_recent_days: windowDays }),
    groupA ? getUpcomingLineupTransitions(channelCode, dateTo, 14) : Promise.resolve(null),
  ]);

  const trend: DailyTrendPoint[] = ((trendRes.data ?? []) as { broadcast_date: string; avg_rating: number | null }[]).map((r) => ({ date: r.broadcast_date, avgRating: r.avg_rating }));
  const weekdayFlow = computeWeekdayFlow(trend);

  const rawMovers = (moversRes.data ?? []) as { canonical_name: string; period_avg_rating: number | null; period_air_count: number | null; prior_avg_rating: number | null; prior_air_count: number | null; rating_delta: number | null }[];
  const programMovers: ProgramMoverRow[] = rawMovers.map((m) => ({
    canonicalName: m.canonical_name,
    periodAvgRating: m.period_avg_rating,
    periodAirCount: m.period_air_count,
    priorAvgRating: m.prior_avg_rating,
    priorAirCount: m.prior_air_count,
    ratingDelta: m.rating_delta,
  }));
  const { growth, weakness } = computeGrowthWeaknessMovers(programMovers, 3);
  const programFlow: RecommendationSection["programFlow"] = skyUhd ? { available: false, reason: "skyUHD는 프로그램 단위 자료가 제한적입니다" } : { available: true, data: { growth, weakness } };

  const hourBlockRows = (hourBlockRes.data ?? []) as HourBlockOpportunityRow[];
  const slotDiagnosis: SlotDiagnosisRow[] = hourBlockRows.map((r) => ({ hourBlock: r.hour_block, diagnosis: classifyHourBlockDiagnosis(r), gapChange: r.gap_change }));

  const lineupSection: RecommendationSection["lineupTransitions"] = groupA
    ? { available: true, data: lineupTransitions ?? [] }
    : { available: false, reason: "오리지널 라인업 전환점은 Group A(ENA·ENA Drama·ENA Play) 전용입니다" };

  // 05 제언 — 근거/제안/확인 3요소가 다 채워질 때만 생성한다(설계서 원칙). 예측 수치는 만들지 않음.
  const recommendations: RecommendationSection["recommendations"] = [];
  if (growth[0]) {
    recommendations.push({
      basis: `참조 구간(${dateFrom}~${dateTo}) 동안 ${growth[0].canonicalName}이(가) 상승했습니다(등락 ${growth[0].ratingDelta?.toFixed(skyUhd ? 5 : 3)})`,
      suggestion: "다음 구간에도 이어질 가능성이 있어 편성 유지·확대를 검토해볼 만합니다",
      verification: "다음 구간 같은 프로그램의 시청률 추이로 확인하세요",
    });
  }
  const endingSoon = (lineupTransitions ?? []).filter((t) => t.kind === "ending_soon");
  if (endingSoon[0]) {
    recommendations.push({
      basis: `${endingSoon[0].canonicalName}이(가) ${endingSoon[0].date}에 종영 예정입니다`,
      suggestion: "종영 후 편성 공백이 생기지 않도록 후속 편성을 검토해볼 만합니다",
      verification: "종영일 전후로 해당 슬롯의 편성 계획을 확인하세요",
    });
  }
  const startingSoon = (lineupTransitions ?? []).filter((t) => t.kind === "starting_soon");
  if (startingSoon[0]) {
    recommendations.push({
      basis: `${startingSoon[0].canonicalName}이(가) ${startingSoon[0].date}에 신규 시작 예정입니다`,
      suggestion: "리드인 편성(직전 시간대 프로그램)을 함께 검토해볼 만합니다",
      verification: "시작 후 첫 방영분의 시청률로 리드인 효과를 확인하세요",
    });
  }
  const opportunitySlot = slotDiagnosis.find((s) => s.diagnosis === "기회");
  if (opportunitySlot) {
    recommendations.push({
      basis: `${opportunitySlot.hourBlock}시대 슬롯이 경쟁채널 대비 격차가 좁혀지는 "기회" 슬롯으로 진단됐습니다`,
      suggestion: "이 슬롯에 강화 편성(신규 콘텐츠 또는 상승세 프로그램 배치)을 검토해볼 만합니다",
      verification: "다음 구간 같은 슬롯의 격차 변화로 확인하세요",
    });
  }
  const checkSlot = slotDiagnosis.find((s) => s.diagnosis === "점검");
  if (checkSlot) {
    recommendations.push({
      basis: `${checkSlot.hourBlock}시대 슬롯이 경쟁채널 대비 성과가 약하고 격차도 벌어지는 "점검" 슬롯으로 진단됐습니다`,
      suggestion: "이 슬롯의 편성 점검을 검토해볼 만합니다",
      verification: "다음 구간 같은 슬롯의 성과로 개선 여부를 확인하세요",
    });
  }

  return {
    title,
    referenceWindow: { dateFrom, dateTo },
    channelFlow: { trend, weekdayFlow },
    programFlow,
    lineupTransitions: lineupSection,
    slotDiagnosis,
    recommendations,
  };
}
