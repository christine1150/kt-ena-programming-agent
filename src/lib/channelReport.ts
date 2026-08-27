// Channel Intelligence Report — 리포트 다운로드(Phase 3, 2026-08-27, 사용자 지시).
// "Channel Intelligence Report" 마스터 프롬프트 §46(Report JSON) 축소판 — 새 계산은 전혀 없다.
// 이미 배포된 3개 API(/api/dashboard/channel, /api/scheduling/fit-score,
// /api/scheduling/program-momentum)가 돌려주는 값과, 2페이지(ChannelDeepDive.tsx)가 이미 하는
// "30초 요약" 조합 로직(Health Score/KPI 5카드/Biggest Win·Weakness/Top·Weak Programs/Momentum)을
// 그대로 다시 조립할 뿐이다 — 새 SQL·새 판정 규칙 없음(CLAUDE.md: 로직 중복 금지 원칙에 따라
// 계산 자체는 절대 새로 만들지 않고, 이 파일은 "이미 검증된 값을 문서용으로 재배열"만 한다).
//
// 이 파일은 서버(API 라우트)에서만 쓰인다("use client" 경계 밖) — ChannelDeepDive.tsx가 쓰는
// 포맷 함수(fmtR 등)는 그 파일이 클라이언트 전용이라 가져올 수 없어 작은 버전을 여기 따로 둔다
// (AskAssistantWidget.tsx를 뽑아낼 때와 같은 이유의 의도적 소규모 중복 — 세션 내 기존 관례).
import { computeChannelHealthScore, type ChannelHealthScore } from "@/lib/channelHealthScore";

// ChannelDeepDive.tsx의 DAYPART_LABEL과 정확히 같은 고정 구간(get_channel_daypart_opportunity가
// 쓰는 것과 동일) — 새 구간 정의 없이 그대로 재사용.
const DAYPART_LABEL: Record<string, string> = {
  새벽: "새벽(02~08시)",
  오전: "오전(09~13시)",
  오후: "오후(14~18시)",
  저녁_심야: "저녁·심야(19~25시)",
};

function fmtR(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined ? "—" : v.toFixed(digits);
}
function fmtSeconds(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}분 ${s}초`;
}
function pctDelta(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

export interface ReportKpiCard {
  label: string;
  value: string;
  deltaLabel: string | null;
  deltaDirection: "up" | "down" | null;
}
export interface ReportProgramRow {
  name: string;
  detail: string;
}
export interface ReportMomentumRow {
  name: string;
  momentum: number;
  label: "RISING" | "STABLE" | "DECLINING";
}
export interface ChannelReportData {
  channel: { code: string; name: string; primaryTarget: string | null; market: string | null };
  asOfDate: string;
  health: ChannelHealthScore | null;
  kpis: ReportKpiCard[];
  win: { daypartLabel: string; gapChange: number } | null;
  weakness: { daypartLabel: string; gapChange: number } | null;
  topPrograms: ReportProgramRow[];
  weakPrograms: ReportProgramRow[];
  momentum: ReportMomentumRow[];
  aiSummary: string | null;
}

// 이 3개 인자는 각각 /api/dashboard/channel, /api/scheduling/fit-score,
// /api/scheduling/program-momentum이 돌려주는 JSON 그대로다(호출부에서 이미 fetch해 넘겨준다) —
// 타입은 실제로 쓰는 필드만 최소로 선언(전체 응답 셰이프를 다시 정의하지 않는다).
export function buildChannelReportData(
  channel: { code: string; name: string; primaryTarget: string | null; market: string | null },
  asOfDate: string,
  dashboard: {
    trend: { period: string; rating: number | null; share: number | null; reach: number | null; time_spent_seconds: number | null }[];
    narrativeSignal: { today_rank: number | null; baseline_avg_rank: number | null; rating_delta_pct: number | null } | null;
    rootCauseAlert: { triggered: boolean } | null;
    opportunityAlert: { triggered: boolean } | null;
    daypartOpportunity: { daypart: string; gap_change: number | null }[];
    topPrograms: { program_name: string; avg_rating: number | null }[];
    briefingLlm: string | null;
  },
  fitScoreItems: { program_id: string; fit_score: number | null; tag: "STRENGTHEN" | "KEEP" | "MOVE" | "REPLACE" | "TEST" | null; programs: { canonical_name: string } | null }[],
  momentumItems: { program_id: string; momentum: number | null; label: "RISING" | "STABLE" | "DECLINING" | null }[]
): ChannelReportData {
  const current = dashboard.trend.find((t) => t.period === "current") ?? null;
  const dod = dashboard.trend.find((t) => t.period === "DoD") ?? null;

  const fitScoreTagCounts = { STRENGTHEN: 0, KEEP: 0, MOVE: 0, REPLACE: 0, TEST: 0 };
  for (const item of fitScoreItems) {
    if (item.tag) fitScoreTagCounts[item.tag] += 1;
  }
  const health = computeChannelHealthScore({
    ratingDeltaPct: dashboard.narrativeSignal?.rating_delta_pct ?? null,
    todayRank: dashboard.narrativeSignal?.today_rank ?? null,
    baselineAvgRank: dashboard.narrativeSignal?.baseline_avg_rank ?? null,
    fitScoreTagCounts,
    rootCauseTriggered: dashboard.rootCauseAlert?.triggered ?? false,
    opportunityTriggered: dashboard.opportunityAlert?.triggered ?? false,
    daypartGapChanges: dashboard.daypartOpportunity.map((d) => d.gap_change),
  });

  const kpis: ReportKpiCard[] = current
    ? [
        {
          label: "시청률",
          value: fmtR(current.rating),
          deltaLabel: dod && current.rating !== null && dod.rating !== null ? `${Math.abs(pctDelta(current.rating, dod.rating) ?? 0).toFixed(1)}% (전일 대비)` : null,
          deltaDirection: (() => {
            const d = pctDelta(current.rating, dod?.rating);
            return d === null ? null : d >= 0 ? "up" : "down";
          })(),
        },
        {
          label: "점유율",
          value: current.share !== null ? `${current.share.toFixed(2)}%` : "—",
          deltaLabel: (() => {
            const d = pctDelta(current.share, dod?.share);
            return d !== null ? `${Math.abs(d).toFixed(1)}% (전일 대비)` : null;
          })(),
          deltaDirection: (() => {
            const d = pctDelta(current.share, dod?.share);
            return d === null ? null : d >= 0 ? "up" : "down";
          })(),
        },
        {
          label: "도달율",
          value: current.reach !== null ? `${current.reach.toFixed(2)}%` : "—",
          deltaLabel: (() => {
            const d = pctDelta(current.reach, dod?.reach);
            return d !== null ? `${Math.abs(d).toFixed(1)}% (전일 대비)` : null;
          })(),
          deltaDirection: (() => {
            const d = pctDelta(current.reach, dod?.reach);
            return d === null ? null : d >= 0 ? "up" : "down";
          })(),
        },
        {
          label: "시청시간",
          value: fmtSeconds(current.time_spent_seconds),
          deltaLabel: (() => {
            const d = pctDelta(current.time_spent_seconds, dod?.time_spent_seconds);
            return d !== null ? `${Math.abs(d).toFixed(1)}% (전일 대비)` : null;
          })(),
          deltaDirection: (() => {
            const d = pctDelta(current.time_spent_seconds, dod?.time_spent_seconds);
            return d === null ? null : d >= 0 ? "up" : "down";
          })(),
        },
        {
          label: "순위",
          value: dashboard.narrativeSignal?.today_rank != null ? `${dashboard.narrativeSignal.today_rank}위` : "—",
          deltaLabel: dashboard.narrativeSignal?.baseline_avg_rank != null ? `평소 ${dashboard.narrativeSignal.baseline_avg_rank.toFixed(1)}위 (4주 평균)` : null,
          deltaDirection:
            dashboard.narrativeSignal?.today_rank != null && dashboard.narrativeSignal?.baseline_avg_rank != null
              ? dashboard.narrativeSignal.baseline_avg_rank - dashboard.narrativeSignal.today_rank >= 0
                ? "up"
                : "down"
              : null,
        },
      ]
    : [];

  const validDayparts = dashboard.daypartOpportunity.filter((d) => d.gap_change !== null);
  const winRow = validDayparts.length > 0 ? validDayparts.reduce((a, b) => ((b.gap_change ?? -Infinity) > (a.gap_change ?? -Infinity) ? b : a)) : null;
  const weaknessRow = validDayparts.length > 0 ? validDayparts.reduce((a, b) => ((b.gap_change ?? Infinity) < (a.gap_change ?? Infinity) ? b : a)) : null;

  const topPrograms: ReportProgramRow[] = dashboard.topPrograms.slice(0, 3).map((p) => ({ name: p.program_name, detail: fmtR(p.avg_rating) }));
  const weakPrograms: ReportProgramRow[] = fitScoreItems
    .filter((f) => f.tag === "REPLACE" && f.programs?.canonical_name)
    .sort((a, b) => (a.fit_score ?? 0) - (b.fit_score ?? 0))
    .slice(0, 3)
    .map((f) => ({ name: f.programs!.canonical_name, detail: `Fit ${f.fit_score !== null ? f.fit_score.toFixed(0) : "—"}` }));

  const momentum: ReportMomentumRow[] = momentumItems
    .filter((m): m is typeof m & { momentum: number; label: "RISING" | "STABLE" | "DECLINING" } => m.momentum !== null && m.label !== null)
    .sort((a, b) => b.momentum - a.momentum)
    .map((m) => {
      const program = fitScoreItems.find((f) => f.program_id === m.program_id);
      return { name: program?.programs?.canonical_name ?? "이름 없음", momentum: m.momentum, label: m.label };
    });

  return {
    channel,
    asOfDate,
    health,
    kpis,
    win: winRow && winRow.gap_change !== null ? { daypartLabel: DAYPART_LABEL[winRow.daypart] ?? winRow.daypart, gapChange: winRow.gap_change } : null,
    weakness: weaknessRow && weaknessRow.gap_change !== null ? { daypartLabel: DAYPART_LABEL[weaknessRow.daypart] ?? weaknessRow.daypart, gapChange: weaknessRow.gap_change } : null,
    topPrograms,
    weakPrograms,
    momentum,
    aiSummary: dashboard.briefingLlm,
  };
}

// ── Phase 4(2026-08-27, 사용자 지시: "어떤 기간을 선택하더라도 그 기간에 맞는 별도의 보고서를
// 작성할 수 있도록") — 위 buildChannelReportData()는 "오늘" 단일 일자 전용이다. 기간(WTD/MTD/
// QTD/YTD/지난 7일·1달/DoD~YoY 비교 분석/직접 선택) 리포트는 이 함수가 담당한다. 새 SQL 없음
// — /api/dashboard/channel이 기간 모드(dateFrom≠dateTo 또는 비교 분석 프리셋)일 때 이미
// 돌려주는 periodReport(get_rating_period_report)/periodProgramMovers
// (get_channel_period_program_movers)/daypartOpportunity/topPrograms/
// competitorPeriodTopPrograms를 재조립할 뿐이다. Health Score/Program Momentum은 "오늘 하루"
// 개념(오늘 순위·최근 7일 대 4주 모멘텀)이라 기간 리포트에는 포함하지 않는다(계획서 G절).
function computeWinWeakness(daypartOpportunity: { daypart: string; gap_change: number | null }[]) {
  const valid = daypartOpportunity.filter((d) => d.gap_change !== null);
  const winRow = valid.length > 0 ? valid.reduce((a, b) => ((b.gap_change ?? -Infinity) > (a.gap_change ?? -Infinity) ? b : a)) : null;
  const weaknessRow = valid.length > 0 ? valid.reduce((a, b) => ((b.gap_change ?? Infinity) < (a.gap_change ?? Infinity) ? b : a)) : null;
  return {
    win: winRow && winRow.gap_change !== null ? { daypartLabel: DAYPART_LABEL[winRow.daypart] ?? winRow.daypart, gapChange: winRow.gap_change } : null,
    weakness: weaknessRow && weaknessRow.gap_change !== null ? { daypartLabel: DAYPART_LABEL[weaknessRow.daypart] ?? weaknessRow.daypart, gapChange: weaknessRow.gap_change } : null,
  };
}

export interface PeriodKpiCard {
  label: string;
  value: string;
  // "직전 동일 기간"(비교 분석 프리셋이면 전일/전주/전월/전분기/전년 동기, 아니면 직전 동일 길이
  // 기간) 대비와, "최근 12주 평균" 대비 — get_rating_period_report가 이미 계산해 돌려주는 두 축
  // 그대로(마스터 프롬프트가 요구한 "Current vs Previous vs Baseline" 3중 비교를 충족).
  priorDeltaPct: number | null;
  baselineDeltaPct: number | null;
}
export interface PeriodMoverCard {
  name: string;
  periodAvgRating: number | null;
  priorAvgRating: number | null;
  ratingDelta: number | null;
}
export interface ChannelPeriodReportData {
  channel: { code: string; name: string; primaryTarget: string | null; market: string | null };
  dateFrom: string;
  dateTo: string;
  daysWithData: number;
  periodLabel: string; // "이번 분기 누적(QTD)" 등 — 프리셋 라벨을 호출부가 그대로 넘겨줌
  comparisonLabel: string | null; // "전분기" 등, 없으면 "직전 동일 길이 기간"
  kpis: PeriodKpiCard[];
  bestDay: { date: string; rating: number | null } | null;
  worstDay: { date: string; rating: number | null } | null;
  win: { daypartLabel: string; gapChange: number } | null;
  weakness: { daypartLabel: string; gapChange: number } | null;
  growthDrivers: PeriodMoverCard[]; // rating_delta > 0, 상위 2개
  weaknessDrivers: PeriodMoverCard[]; // rating_delta < 0, 하위 2개
  topPrograms: ReportProgramRow[];
  competitorTopPrograms: { competitorName: string; programName: string; rating: number | null }[];
  aiSummary: string | null;
}

export function buildChannelPeriodReportData(
  channel: { code: string; name: string; primaryTarget: string | null; market: string | null },
  dateFrom: string,
  dateTo: string,
  periodLabel: string,
  comparisonLabel: string | null,
  dashboard: {
    periodReport: {
      avg_rating: number | null;
      avg_share: number | null;
      avg_reach: number | null;
      avg_time_spent_seconds: number | null;
      prior_period_change_pct: number | null;
      baseline_change_pct: number | null;
      best_date: string | null;
      best_rating: number | null;
      worst_date: string | null;
      worst_rating: number | null;
      days_with_data: number;
    } | null;
    periodProgramMovers: { canonical_name: string; period_avg_rating: number | null; prior_avg_rating: number | null; rating_delta: number | null }[];
    daypartOpportunity: { daypart: string; gap_change: number | null }[];
    topPrograms: { program_name: string; avg_rating: number | null }[];
    competitorPeriodTopPrograms: { competitor_name: string; program_name: string; rating: number | null }[];
    aiSummary: string | null;
  }
): ChannelPeriodReportData {
  const pr = dashboard.periodReport;
  // get_rating_period_report는 시청률에만 두 비교값(직전 동일 기간 대비/최근 12주 평균 대비)을
  // 계산해 돌려준다 — 점유율/도달율/시청시간은 현재 값만 준다(그 두 축 비교는 이 RPC가 하지
  // 않아 억지로 만들지 않는다, CLAUDE.md 원칙).
  const kpis: PeriodKpiCard[] = pr
    ? [
        { label: "시청률", value: fmtR(pr.avg_rating), priorDeltaPct: pr.prior_period_change_pct, baselineDeltaPct: pr.baseline_change_pct },
        { label: "점유율", value: pr.avg_share !== null ? `${pr.avg_share.toFixed(2)}%` : "—", priorDeltaPct: null, baselineDeltaPct: null },
        { label: "도달율", value: pr.avg_reach !== null ? `${pr.avg_reach.toFixed(2)}%` : "—", priorDeltaPct: null, baselineDeltaPct: null },
        { label: "시청시간", value: fmtSeconds(pr.avg_time_spent_seconds), priorDeltaPct: null, baselineDeltaPct: null },
      ]
    : [];

  const { win, weakness } = computeWinWeakness(dashboard.daypartOpportunity);
  const movers = dashboard.periodProgramMovers.filter((m) => m.rating_delta !== null);
  const growthDrivers: PeriodMoverCard[] = movers
    .filter((m) => (m.rating_delta ?? 0) > 0)
    .sort((a, b) => (b.rating_delta ?? 0) - (a.rating_delta ?? 0))
    .slice(0, 2)
    .map((m) => ({ name: m.canonical_name, periodAvgRating: m.period_avg_rating, priorAvgRating: m.prior_avg_rating, ratingDelta: m.rating_delta }));
  const weaknessDrivers: PeriodMoverCard[] = movers
    .filter((m) => (m.rating_delta ?? 0) < 0)
    .sort((a, b) => (a.rating_delta ?? 0) - (b.rating_delta ?? 0))
    .slice(0, 2)
    .map((m) => ({ name: m.canonical_name, periodAvgRating: m.period_avg_rating, priorAvgRating: m.prior_avg_rating, ratingDelta: m.rating_delta }));

  return {
    channel,
    dateFrom,
    dateTo,
    daysWithData: pr?.days_with_data ?? 0,
    periodLabel,
    comparisonLabel,
    kpis,
    bestDay: pr?.best_date ? { date: pr.best_date, rating: pr.best_rating } : null,
    worstDay: pr?.worst_date ? { date: pr.worst_date, rating: pr.worst_rating } : null,
    win,
    weakness,
    growthDrivers,
    weaknessDrivers,
    topPrograms: dashboard.topPrograms.slice(0, 5).map((p) => ({ name: p.program_name, detail: fmtR(p.avg_rating) })),
    competitorTopPrograms: dashboard.competitorPeriodTopPrograms.slice(0, 5).map((p) => ({ competitorName: p.competitor_name, programName: p.program_name, rating: p.rating })),
    aiSummary: dashboard.aiSummary,
  };
}
