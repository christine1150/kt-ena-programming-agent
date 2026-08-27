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
