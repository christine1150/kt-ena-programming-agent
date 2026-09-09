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
import type { DailyTrendPoint, ProgramMoverRow, AudienceReportRawData } from "./dataCollector";
import {
  computeEfficiencyRanking,
  computePrimeGap,
  computeDowHourCells,
  computeMoveCandidates,
  computeSlotRelativePerformance,
  MIN_AIRINGS_FOR_RANKING,
} from "./deepDiveAnalyzer";
import type { RecommendationSection, WeekdayFlowPoint, SlotDiagnosisRow } from "./reportModel";
import { formatRating } from "./format";

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
  mainDateTo: string,
  // W절(2026-09-10) — 심층 분석 원자료. reportBuilder가 이미 수집해 둔 것을 그대로 넘겨받아
  // 순수 함수로 신호만 뽑는다(여기서 추가 조회를 하지 않기 위함). 없으면 심층 제언만 빠진다.
  deepRaw?: AudienceReportRawData
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
  // 편성 3회 미만은 제언 근거에서 제외한다. 사용자가 여러 차례 지적한 함정으로(2026-09-01
  // "한두 번 편성해서 잘나온 것은 말이 안 된다"), 실측에서도 1회 편성 특집
  // ("내아이의사생활추사랑스페셜", 등락 0.246)이 상승 요인 1위로 올라와 제언을 지배했다.
  // 등락값 자체가 그 회차 시청률과 같아져 항상 최상위가 되기 때문이다.
  const rankableMovers = programMovers.filter(
    (m) => Math.max(m.periodAirCount ?? 0, m.priorAirCount ?? 0) >= MIN_AIRINGS_FOR_RANKING
  );
  const { growth, weakness } = computeGrowthWeaknessMovers(rankableMovers, 3);
  const programFlow: RecommendationSection["programFlow"] = skyUhd ? { available: false, reason: "skyUHD는 프로그램 단위 자료가 제한적입니다" } : { available: true, data: { growth, weakness } };

  const hourBlockRows = (hourBlockRes.data ?? []) as HourBlockOpportunityRow[];
  // 사용자 지시(2026-09-01): "슬롯 진단 근거 내용도 애매함" — gapChange 하나만 남기지 않고,
  // 판정에 실제로 쓰인 자사·경쟁 전체/최근 평균과 격차를 그대로 들고 다녀 화면에서 "왜 이
  // 진단이 나왔는지" 숫자로 확인할 수 있게 한다.
  const slotDiagnosis: SlotDiagnosisRow[] = hourBlockRows.map((r) => ({
    hourBlock: r.hour_block,
    diagnosis: classifyHourBlockDiagnosis(r),
    gapChange: r.gap_change,
    ourFullAvg: r.our_full_avg,
    ourRecentAvg: r.our_recent_avg,
    competitorFullAvg: r.competitor_full_avg,
    competitorRecentAvg: r.competitor_recent_avg,
    gapFull: r.gap_full,
    gapRecent: r.gap_recent,
  }));

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
  // 사용자 지시(2026-09-01): "슬롯 진단 근거 내용도 애매함. 구체적이고 최대한 정확한 정보로
  // 수정" — "격차가 좁혀지는/벌어지는"이라는 말만으로는 실제 수치를 알 수 없었다. gap_change의
  // 원본 부호를 그대로 노출하면(자사−경쟁 격차라 채널마다 부호 기준이 달라) 오독 위험이 있어,
  // 이 프로젝트가 이미 쓰는 안전한 표기 관례(ChannelDeepDive.tsx의 WinWeaknessCard —
  // "격차 ▲/▼ 절댓값(좁혀짐/벌어짐)")를 그대로 재사용한다. 자사 평균의 실제 등락(전체→최근)도
  // 함께 인용해 "왜 이 슬롯이 이 진단을 받았는지" 두 축(자사 성과/경쟁 격차)을 모두 보여준다.
  const opportunitySlot = slotDiagnosis.find((s) => s.diagnosis === "기회");
  if (opportunitySlot) {
    recommendations.push({
      basis: `${opportunitySlot.hourBlock}시대는 자사 평균이 ${formatRating(opportunitySlot.ourFullAvg, channelCode)}→${formatRating(opportunitySlot.ourRecentAvg, channelCode)}로 하락했지만, 경쟁채널 대비 격차는 ▲${formatRating(opportunitySlot.gapChange !== null ? Math.abs(opportunitySlot.gapChange) : null, channelCode)}(좁혀짐)로 진단돼 "기회" 슬롯입니다(경쟁채널도 함께 약해진 구간으로 추정)`,
      suggestion: "이 슬롯에 강화 편성(신규 콘텐츠 또는 상승세 프로그램 배치)을 검토해볼 만합니다",
      verification: "다음 구간 같은 슬롯의 격차 변화로 확인하세요",
    });
  }
  const checkSlot = slotDiagnosis.find((s) => s.diagnosis === "점검");
  if (checkSlot) {
    recommendations.push({
      basis: `${checkSlot.hourBlock}시대는 자사 평균이 ${formatRating(checkSlot.ourFullAvg, channelCode)}→${formatRating(checkSlot.ourRecentAvg, channelCode)}로 하락했고, 경쟁채널 대비 격차도 ▼${formatRating(checkSlot.gapChange !== null ? Math.abs(checkSlot.gapChange) : null, channelCode)}(벌어짐)로 진단돼 "점검" 슬롯입니다`,
      suggestion: "이 슬롯의 편성 점검을 검토해볼 만합니다",
      verification: "다음 구간 같은 슬롯의 성과로 개선 여부를 확인하세요",
    });
  }

  // W절(2026-09-10) — 심층 분석에서만 나올 수 있는 제언 4종. 여기서 새 조회를 하지 않고
  // 이미 수집된 원자료(deepRaw)를 순수 함수에 통과시켜 얻은 신호만 쓴다.
  // 예측 수치("기대 효과 +N%")는 기존 규율 그대로 절대 만들지 않는다.
  if (deepRaw && deepRaw.programSlotProfile.length > 0) {
    const slot = deepRaw.programSlotProfile;

    // (1) 효율형인데 편성이 주로 비주요시간에 몰린 프로그램 → 주요시간 이동 검토.
    const efficient = computeEfficiencyRanking(slot).filter((r) => r.programType === "효율형");
    const primeRows = computePrimeGap(slot);
    for (const e of efficient.slice(0, 1)) {
      const g = primeRows.find((p) => p.canonicalName === e.canonicalName);
      if (g && !g.sampleSkewed && g.primeAirings < g.offPrimeAirings && g.primeRatio !== null) {
        recommendations.push({
          basis: `${e.canonicalName}은(는) 회당 평균 ${formatRating(e.avgRating, channelCode)}로 채널 평균의 ${e.vsChannelAvgPct}%이지만, 편성 ${e.airings}회 중 주요시간은 ${g.primeAirings}회뿐입니다(주요시간 ${formatRating(g.primeAvgRating, channelCode)} / 그 외 ${formatRating(g.offPrimeAvgRating, channelCode)}, ${g.primeRatio}배)`,
          suggestion: "비주요시간 편성분 일부를 주요시간대로 옮기는 안을 검토해볼 만합니다. 옮길 슬롯의 현재 편성물을 무엇으로 대체할지 함께 정해야 합니다",
          verification: `다음 구간에서 이 프로그램의 주요시간 편성 횟수와 회당 평균(이번 ${formatRating(g.primeAvgRating, channelCode)})이 어떻게 움직이는지로 확인하세요`,
        });
      }
    }

    // (2)(3) 요일×시간대 이동 후보 — 편성 대비 성과가 어긋나는 구간.
    const cells = computeDowHourCells(deepRaw.dowHourProfile);
    const moves = computeMoveCandidates(cells);
    const overInvested = moves.find((m) => m.kind === "편성 대비 성과 낮음");
    if (overInvested) {
      recommendations.push({
        basis: `${overInvested.dowLabel} ${overInvested.hour}시대는 이 기간 ${overInvested.airings}회로 편성 상위 구간인데 회당 평균은 ${formatRating(overInvested.avgRating, channelCode)}로 하위 구간입니다`,
        suggestion: "이 구간의 편성 물량을 줄이거나 다른 콘텐츠로 교체하는 안을 검토해볼 만합니다",
        verification: "다음 구간 같은 요일·시간대의 편성 횟수와 회당 평균을 함께 확인하세요",
      });
    }
    const underInvested = moves.find((m) => m.kind === "성과 대비 편성 적음");
    if (underInvested) {
      recommendations.push({
        basis: `${underInvested.dowLabel} ${underInvested.hour}시대는 회당 평균 ${formatRating(underInvested.avgRating, channelCode)}로 상위 구간인데 편성은 ${underInvested.airings}회에 그칩니다`,
        suggestion: "이 구간의 편성을 늘리는 안을 검토해볼 만합니다",
        verification: "편성을 늘린 뒤에도 회당 평균이 유지되는지 다음 구간에서 확인하세요",
      });
    }

    // (4) 저시청 시간대에서 그 시간대 평균을 넘은 콘텐츠 — 채널 평균으로만 보면 묻히는 자리.
    const lowStandout = computeSlotRelativePerformance(slot, { lowSlotOnly: true, limit: 1 })[0];
    if (lowStandout) {
      recommendations.push({
        basis: `${lowStandout.canonicalName}은(는) 편성의 ${lowStandout.lowSlotAirtimePct}%가 02~08시에 있어 채널 평균으로는 낮게 보이지만, 같은 시간대 채널 평균 대비 ${lowStandout.standoutMetrics.join("·")}이(가) 상회합니다(시청률 ${lowStandout.slotRatingPct ?? "—"}% / 점유율 ${lowStandout.slotSharePct ?? "—"}% / 시청시간 비율 ${lowStandout.slotTimeSpentPct ?? "—"}%)`,
        suggestion: "이 콘텐츠를 더 좋은 시간대에 시험 편성해보는 안을 검토해볼 만합니다",
        verification: "시험 편성 구간에서 회당 평균이 새벽 편성 때와 어떻게 달라지는지 확인하세요",
      });
    }
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
