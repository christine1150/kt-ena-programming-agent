// RESPONSE TEMPLATE — 스펙 26번(Evidence-First Rule): 결론→핵심 수치→비교 기준→Evidence→해석→
// Programming Action→Confidence 순서를 모든 답변에 강제한다. 존재하지 않는 숫자를 만들지 않고,
// NULL은 "데이터 없음"으로 표시한다(0과 구분 — 스펙 28번).
import type { ConfidenceLevel, EvidenceAnswer, MacroIntentId, TimeContext, VisualizationSpec } from "./types";
import { josaEulReul } from "@/lib/josa";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";
import { detectPortfolioAnomaly } from "@/lib/portfolioAnomaly";

function fmt(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined ? "데이터 없음" : v.toFixed(digits);
}
function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "데이터 없음" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`;
}
// 사용자 지시(2026-08-25, 감사 후속: 원 명세 30번) — SQL이 이미 계산한 목록을 막대그래프용
// series로 그대로 옮긴다(새 수치 계산 없음). 항목이 2개 미만이면 그래프 의미가 없어 만들지 않는다.
function bar(title: string, series: { label: string; value: number | null }[]): VisualizationSpec | undefined {
  return series.length >= 2 ? { type: "bar", title, series } : undefined;
}
// Tier 2 확장(2026-08-26): 순위·TOP N처럼 항목당 값이 여러 개(순위/이름/시청률/등락 등)라
// 막대 하나로는 다 못 담는 목록용 — SQL이 이미 계산한 값을 표 행으로 그대로 옮긴다(새 계산 없음).
function table(title: string, columns: string[], rows: (string | number | null)[][]): VisualizationSpec | undefined {
  return rows.length >= 2 ? { type: "table", title, series: [], columns, rows } : undefined;
}
// Tier 2 확장(2026-08-26, 원 제안 8번 "시각화 타입 확장" 나머지) — 기간 질문("최근 7일 추이는?")의
// 일별 시청률을 그대로 line 포인트로 옮긴다(새 계산 없음). 표본 없는 날(결측)은 값을 null로 채워
// x축 간격이 어긋나지 않게 한다.
function line(title: string, points: { label: string; value: number | null }[]): VisualizationSpec | undefined {
  return points.length >= 2 ? { type: "line", title, series: [], points } : undefined;
}
// Tier 2 확장(2026-08-26, 원 제안 8번) — 요일×daypart 격자를 그대로 heatmap 칸으로 옮긴다(이미
// SQL이 계산한 avg_rating/sample_count, 새 계산 없음). rowLabels/colLabels 순서를 고정해 항상
// 같은 모양의 격자를 돌려준다.
function heatmap(
  title: string,
  rowLabels: string[],
  colLabels: string[],
  cellLookup: (row: string, col: string) => { avg_rating: number | null; sample_count: number } | undefined
): VisualizationSpec | undefined {
  if (rowLabels.length === 0 || colLabels.length === 0) return undefined;
  const cells = rowLabels.map((r) => colLabels.map((c) => cellLookup(r, c)?.avg_rating ?? null));
  const sampleCounts = rowLabels.map((r) => colLabels.map((c) => cellLookup(r, c)?.sample_count ?? 0));
  return { type: "heatmap", title, series: [], heatmapRowLabels: rowLabels, heatmapColLabels: colLabels, heatmapCells: cells, heatmapSampleCounts: sampleCounts };
}

// 스펙 20번 Confidence 기준(표본 일수). 이 엔진에서 다루는 대부분의 SQL 함수는 이미 최근
// 12주(84일) 윈도우로 계산되므로, 실제로 관측된 표본 일수(days_with_data 등)를 기준으로 삼는다.
export function confidenceFromSampleDays(days: number | null | undefined): ConfidenceLevel {
  if (days === null || days === undefined) return "INSUFFICIENT_SAMPLE";
  if (days >= 56) return "HIGH"; // 8주 이상
  if (days >= 28) return "MEDIUM"; // 4~7주
  if (days >= 14) return "LOW"; // 2~3주
  return "INSUFFICIENT_SAMPLE";
}
// 단일 일자 조회(예: "어제 ENA는 어땠어?")는 통계적 추정이 아니라 실측 사실 하나를 그대로
// 보여주는 것이므로, 표본 일수 기준 Confidence 규칙(스펙 20번, 원래 여러 날 걸친 추세/추천용)을
// 적용하면 "1일이라 표본 부족"이라는 오해를 준다 — 항상 HIGH로 처리하고, 여러 날에 걸친
// 기간(롤링/캘린더 범위) 조회에만 실제 관측 일수 기준 Confidence를 적용한다.
function confidenceForPeriodReport(daysWithData: number | null | undefined, isSingleDay: boolean): ConfidenceLevel {
  if (isSingleDay) return "HIGH";
  return confidenceFromSampleDays(daysWithData);
}

const CONFIDENCE_NOTE: Record<ConfidenceLevel, string> = {
  HIGH: "표본 8주 이상 — 신뢰도 높음",
  MEDIUM: "표본 4~7주 — 참고용, 추가 관찰 권장",
  LOW: "표본 2~3주 — 표본이 적어 단정하기 이릅니다",
  INSUFFICIENT_SAMPLE: "표본 2주 미만 — 결론을 내리기엔 데이터가 부족합니다",
};

function base(intentId: string, macro: MacroIntentId, raw: unknown): Omit<EvidenceAnswer, "conclusion" | "keyNumbers" | "comparisonBasis" | "evidence" | "interpretation" | "programmingAction" | "confidence" | "confidenceNote"> {
  return { intent_id: intentId, macro_intent: macro, raw };
}

interface PeriodReportLike {
  days_with_data: number;
  avg_rating: number | null;
  prior_period_avg_rating: number | null;
  prior_period_change_pct: number | null;
  baseline_avg_rating: number | null;
  baseline_change_pct: number | null;
}
interface RankingRow {
  channel: { code: string; name: string };
  matchedTargetLabel: string | null;
  report: PeriodReportLike | null;
}

export function buildPortfolioRankingAnswer(
  rows: RankingRow[],
  timeContext: TimeContext,
  direction: "top" | "bottom" | null,
  rankByChange: boolean
): EvidenceAnswer {
  const valid = rows.filter((r) => r.report && r.report.avg_rating !== null);
  if (valid.length === 0) {
    return {
      ...base("PORTFOLIO_RANKING", "PORTFOLIO_HEALTH", rows),
      conclusion: "비교할 수 있는 채널 데이터가 없습니다.",
      keyNumbers: "—",
      comparisonBasis: timeContext.label,
      evidence: "해당 기간에 조회된 시청률 데이터가 없습니다.",
      interpretation: "—",
      programmingAction: "데이터가 쌓인 뒤 다시 질의해 주세요.",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const sortKey = (r: RankingRow) => (rankByChange ? (r.report!.prior_period_change_pct ?? -Infinity) : (r.report!.avg_rating ?? -Infinity));
  const asc = direction === "bottom";
  const sorted = [...valid].sort((a, b) => (asc ? sortKey(a) - sortKey(b) : sortKey(b) - sortKey(a)));
  const winner = sorted[0];
  const list = sorted
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.channel.name} — 시청률 ${fmt(r.report!.avg_rating)}${rankByChange ? `, ${r.report!.days_with_data > 1 ? "직전 기간" : "전일"} 대비 ${pct(r.report!.prior_period_change_pct)}` : ""}`)
    .join(" / ");
  const minDays = Math.min(...valid.map((r) => r.report!.days_with_data));
  const isSingleDay = timeContext.dateFrom === timeContext.dateTo;
  const confidence = confidenceForPeriodReport(minDays, isSingleDay);
  return {
    ...base("PORTFOLIO_RANKING", "PORTFOLIO_HEALTH", rows),
    conclusion: `${timeContext.label} 기준 ${rankByChange ? (asc ? "가장 많이 하락한" : "가장 많이 상승한") : asc ? "가장 부진한" : "가장 잘한"} 채널은 '${winner.channel.name}'입니다.`,
    keyNumbers: `${winner.channel.name} 시청률 ${fmt(winner.report!.avg_rating)}${rankByChange ? ` (직전 기간 대비 ${pct(winner.report!.prior_period_change_pct)})` : ""}`,
    comparisonBasis: `${timeContext.label} · 7개 채널 중 매칭 데이터가 있는 ${valid.length}개 채널`,
    evidence: `전체 순위: ${list}`,
    interpretation: rankByChange
      ? `이 채널은 같은 기간 대비 시청률 변화폭이 가장 컸습니다(${pct(winner.report!.prior_period_change_pct)}).${isSingleDay ? " 다만 하루 변동은 노이즈일 수 있어, 여러 날 지속되는지 함께 확인하세요." : ""}`
      : `이 채널은 해당 기간 평균 시청률이 7개 채널 중 가장 ${asc ? "낮았습니다" : "높았습니다"}.`,
    programmingAction: asc ? "부진 원인(편성/경쟁채널)을 Page 2 WHY?에서 추가로 확인해 보세요." : "강세 요인을 STRENGTHEN 후보로 검토해 보세요.",
    confidence,
    confidenceNote: isSingleDay ? "실측 데이터 1일 기준(사실 조회, 추세 추정 아님)." : CONFIDENCE_NOTE[confidence],
    visualization: table(
      rankByChange ? "채널별 등락률(%)" : "채널별 시청률",
      ["순위", "채널", "시청률", "직전 기간 대비"],
      sorted.slice(0, 7).map((r, i) => [i + 1, r.channel.name, fmt(r.report!.avg_rating), r.report!.prior_period_change_pct !== null ? pct(r.report!.prior_period_change_pct) : "데이터 없음"])
    ),
    followups: [`${winner.channel.name} 최근 12주 시간대별로는 어때?`, `${winner.channel.name}의 경쟁채널 대비 위치는?`],
  };
}

interface AchievementRow {
  channel: { code: string; name: string };
  achievement: { achievement_pct: number | null; gap: number | null; target_rating: number | null; matched_target_label: string | null } | null;
}
export function buildPortfolioKpiGapAnswer(rows: AchievementRow[], timeContext: TimeContext): EvidenceAnswer {
  const valid = rows.filter((r) => r.achievement && r.achievement.achievement_pct !== null);
  if (valid.length === 0) {
    return {
      ...base("PORTFOLIO_KPI_GAP", "PORTFOLIO_HEALTH", rows),
      conclusion: "목표 시청률이 설정된 채널이 없거나 데이터가 없습니다.",
      keyNumbers: "—",
      comparisonBasis: timeContext.label,
      evidence: "—",
      interpretation: "—",
      programmingAction: "관리자 화면에서 목표 시청률을 먼저 등록해 주세요.",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const sorted = [...valid].sort((a, b) => (a.achievement!.achievement_pct ?? 0) - (b.achievement!.achievement_pct ?? 0));
  const worst = sorted[0];
  const list = sorted.map((r) => `${r.channel.name} ${r.achievement!.achievement_pct?.toFixed(1) ?? "—"}%`).join(" / ");
  return {
    ...base("PORTFOLIO_KPI_GAP", "PORTFOLIO_HEALTH", rows),
    conclusion: `${timeContext.label} 기준 목표(KPI) 달성률이 가장 낮은 채널은 '${worst.channel.name}'입니다.`,
    keyNumbers: `달성률 ${worst.achievement!.achievement_pct?.toFixed(1) ?? "—"}% (Gap ${fmt(worst.achievement!.gap)}, 목표 ${fmt(worst.achievement!.target_rating)})`,
    comparisonBasis: `${timeContext.label} · 목표 대 실제 평균 시청률`,
    evidence: `전체 채널 달성률: ${list}`,
    interpretation: (worst.achievement!.achievement_pct ?? 0) < 70 ? "목표 대비 뚜렷하게 부진합니다(RISK 구간)." : "목표에 다소 못 미치지만 관찰이 필요한 수준입니다(WATCH 구간).",
    programmingAction: "이 채널의 Page 2 CONTENT FITS?/OPPORTUNITY?를 확인해 편성 조정을 검토하세요.",
    confidence: "HIGH",
    confidenceNote: "목표 달성률은 SQL 함수로 직접 계산되어 항상 확정값입니다.",
    visualization: bar("채널별 목표 달성률(%)", sorted.map((r) => ({ label: r.channel.name, value: r.achievement!.achievement_pct }))),
    followups: [`${worst.channel.name}의 최근 시간대별 성과는?`],
  };
}

interface AlertRow {
  channel: { code: string; name: string };
  rootCause: { triggered: boolean; streak_days: number } | null;
  opportunity: { triggered: boolean; our_change_pct: number | null } | null;
  // Tier 2 확장(2026-08-26, 원 제안 10번 "이상치/외부요인 플래그") — 이미 SQL이 계산한 당일
  // 등락률(최근 평균 대비). 새 계산 없이 detectPortfolioAnomaly의 판단 입력으로만 쓴다.
  ratingDeltaPct: number | null;
}
export function buildPortfolioAlertAnswer(rows: AlertRow[], timeContext: TimeContext): EvidenceAnswer {
  const risky = rows.filter((r) => r.rootCause?.triggered);
  const opportunities = rows.filter((r) => r.opportunity?.triggered);
  const anomaly = detectPortfolioAnomaly(rows.map((r) => ({ channelCode: r.channel.code, channelName: r.channel.name, ratingDeltaPct: r.ratingDeltaPct })));
  const conclusion =
    risky.length > 0
      ? `현재 즉시 편성 검토가 필요한 채널: ${risky.map((r) => r.channel.name).join(", ")}`
      : opportunities.length > 0
        ? `현재 즉시 위험 신호는 없고, 기회 신호가 있는 채널: ${opportunities.map((r) => r.channel.name).join(", ")}`
        : "현재 위험(3일 연속 하락)·기회 신호가 감지된 채널이 없습니다.";
  const anomalyNote = anomaly.triggered
    ? ` ※ 오늘 ${anomaly.movedChannels.length}개 채널이 동시에 큰 폭(±${anomaly.thresholdPct}%p 이상)으로 움직였습니다(${anomaly.movedChannels.map((c) => `${c.channelName} ${pct(c.ratingDeltaPct)}`).join(", ")}) — 특정 원인을 단정할 수 없으나 공휴일·사회적 이슈 등 외부 요인 검토가 필요합니다.`
    : "";
  return {
    ...base("PORTFOLIO_ALERT", "PORTFOLIO_HEALTH", rows),
    conclusion: conclusion + anomalyNote,
    keyNumbers: risky.length > 0 ? risky.map((r) => `${r.channel.name} ${r.rootCause!.streak_days}일 연속 하락`).join(", ") : "—",
    comparisonBasis: `${timeContext.label} 기준 · 채널 평균(최근 28일) 대비 -10%p 이상 하락 3일 연속`,
    evidence: `위험: ${risky.map((r) => r.channel.name).join(", ") || "없음"} / 기회: ${opportunities.map((r) => r.channel.name).join(", ") || "없음"}`,
    interpretation: "동시에 관찰된 신호일 뿐, 원인을 단정하지 않습니다(상관관계 참고 정보).",
    programmingAction: risky.length > 0 ? "해당 채널의 Page 2 WHY?에서 상세 원인 후보를 확인하세요." : "특별한 조치가 필요하지 않습니다.",
    confidence: "HIGH",
    confidenceNote: "3일 연속/전주 대비 등 확정 규칙으로 판단됩니다.",
    followups: risky.length > 0 ? [`${risky[0].channel.name}은 왜 하락했어?`] : opportunities.length > 0 ? [`${opportunities[0].channel.name}의 기회 시간대는 어디야?`] : undefined,
  };
}

interface NarrativeLike {
  today_rating: number | null;
  baseline_avg_rating: number | null;
  rating_delta_pct: number | null;
  today_rank: number | null;
}
export function buildChannelPerformanceAnswer(
  data: {
    channel: { code: string; name: string };
    matchedTargetLabel: string | null;
    report: PeriodReportLike | null;
    narrative: NarrativeLike | null;
    dailyTrend?: { broadcast_date: string; avg_rating: number | null }[];
  } | null,
  timeContext: TimeContext,
  channelName: string | null
): EvidenceAnswer {
  if (!data || !data.report) {
    return {
      ...base("CHANNEL_PERFORMANCE", "CHANNEL_PERFORMANCE", data),
      conclusion: `'${channelName}'의 ${timeContext.label} 데이터를 찾지 못했습니다.`,
      keyNumbers: "—",
      comparisonBasis: timeContext.label,
      evidence: "—",
      interpretation: "—",
      programmingAction: "—",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const r = data.report;
  const isSingleDay = timeContext.dateFrom === timeContext.dateTo;
  const confidence = confidenceForPeriodReport(r.days_with_data, isSingleDay);
  return {
    ...base("CHANNEL_PERFORMANCE", "CHANNEL_PERFORMANCE", data),
    conclusion: `${timeContext.label} '${data.channel.name}' 평균 시청률은 ${fmt(r.avg_rating)}입니다.`,
    keyNumbers: `시청률 ${fmt(r.avg_rating)} · 최근 12주 평균 대비 ${pct(r.baseline_change_pct)}${data.narrative?.today_rank !== undefined && data.narrative?.today_rank !== null ? ` · 오늘 순위 ${data.narrative.today_rank}위` : ""}`,
    comparisonBasis: `직전 동일 길이 기간(${timeContext.compareLabel ?? "직전 기간"}) 및 최근 12주(84일) 평균`,
    evidence: `직전 기간 평균 ${fmt(r.prior_period_avg_rating)}(${pct(r.prior_period_change_pct)}) · 최근 12주 평균 ${fmt(r.baseline_avg_rating)}`,
    interpretation:
      r.baseline_change_pct !== null && r.baseline_change_pct >= 15
        ? "평소보다 뚜렷하게 강세입니다."
        : r.baseline_change_pct !== null && r.baseline_change_pct <= -15
          ? "평소보다 뚜렷하게 약세입니다."
          : "평소와 비슷한 수준입니다.",
    programmingAction: "자세한 원인/시간대/경쟁채널 비교는 Page 2에서 확인하세요.",
    confidence,
    confidenceNote: isSingleDay ? "실측 데이터 1일 기준(사실 조회, 추세 추정 아님)." : CONFIDENCE_NOTE[confidence],
    // Tier 2 확장(2026-08-26, 원 제안 8번) — 기간 질문("최근 7일 추이는?")이면 하루하루의 흐름이
    // 궁금한 것이므로, 3개 값 막대 비교보다 일별 line 차트가 더 알맞다(비교 기준 3개 값은
    // keyNumbers/evidence 문장에 이미 그대로 남아있어 정보 손실 없음). 단일 일자 질문은 "추이"
    // 개념이 없어 기존 3-막대 비교를 그대로 유지한다.
    visualization: isSingleDay
      ? bar(`${data.channel.name} 시청률 비교`, [
          { label: "오늘", value: r.avg_rating },
          { label: "직전 기간", value: r.prior_period_avg_rating },
          { label: "최근 12주 평균", value: r.baseline_avg_rating },
        ])
      : (line(
          `${data.channel.name} 일별 시청률 추이(${timeContext.label})`,
          (data.dailyTrend ?? []).map((d) => ({ label: d.broadcast_date.slice(5), value: d.avg_rating }))
        ) ??
        bar(`${data.channel.name} 시청률 비교`, [
          { label: timeContext.label, value: r.avg_rating },
          { label: "직전 기간", value: r.prior_period_avg_rating },
          { label: "최근 12주 평균", value: r.baseline_avg_rating },
        ])),
    followups: [`${data.channel.name} 시간대별 성과는?`, `${data.channel.name}의 경쟁채널 대비 위치는?`],
  };
}

export function buildChannelDaypartAnswer(
  data: { channel: { code: string; name: string }; rows: { dow: number; dow_label: string; daypart: string; avg_rating: number | null; sample_count: number }[] } | null,
  timeContext: TimeContext,
  direction: "top" | "bottom" | null
): EvidenceAnswer {
  const DAYPART_LABEL: Record<string, string> = { 새벽: "새벽(02~08시)", 오전: "오전(09~13시)", 오후: "오후(14~18시)", 저녁_심야: "저녁·심야(19~25시)" };
  if (!data || data.rows.length === 0) {
    return {
      ...base("CHANNEL_DAYPART", "CHANNEL_PERFORMANCE", data),
      conclusion: "시간대 데이터를 찾지 못했습니다.",
      keyNumbers: "—",
      comparisonBasis: "최근 12주(84일)",
      evidence: "—",
      interpretation: "—",
      programmingAction: "—",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const totals = new Map<string, { sum: number; count: number }>();
  for (const r of data.rows) {
    if (r.avg_rating === null || r.sample_count === 0) continue;
    const acc = totals.get(r.daypart) ?? { sum: 0, count: 0 };
    acc.sum += r.avg_rating * r.sample_count;
    acc.count += r.sample_count;
    totals.set(r.daypart, acc);
  }
  const avgs = [...totals.entries()].map(([daypart, { sum, count }]) => ({ daypart, avg: count > 0 ? sum / count : 0, count }));
  const wantBottom = direction === "bottom";
  const sorted = [...avgs].sort((a, b) => (wantBottom ? a.avg - b.avg : b.avg - a.avg));
  const best = sorted[0];
  const totalSample = avgs.reduce((s, a) => s + a.count, 0);
  return {
    ...base("CHANNEL_DAYPART", "CHANNEL_PERFORMANCE", data),
    conclusion: `'${data.channel.name}'의 최근 12주 ${wantBottom ? "최약" : "최강"} 시간대는 ${DAYPART_LABEL[best.daypart] ?? best.daypart}입니다.`,
    keyNumbers: `평균 시청률 ${fmt(best.avg)}`,
    comparisonBasis: "최근 12주(84일) 누적, daypart(새벽/오전/오후/저녁·심야) 표본수 가중 평균",
    evidence: sorted.map((a) => `${DAYPART_LABEL[a.daypart] ?? a.daypart} ${fmt(a.avg)}`).join(" / "),
    interpretation: `4개 daypart 중 ${wantBottom ? "가장 시청률이 낮은" : "가장 시청률이 높은"} 구간입니다.`,
    programmingAction: wantBottom ? "이 시간대 편성을 재검토하거나 OPPORTUNITY? 분석을 참고하세요." : "이 시간대에 STRENGTHEN 후보 콘텐츠 배치를 검토하세요.",
    confidence: confidenceFromSampleDays(totalSample >= 84 ? 84 : totalSample),
    confidenceNote: CONFIDENCE_NOTE[confidenceFromSampleDays(totalSample >= 84 ? 84 : totalSample)],
    // Tier 2 확장(2026-08-26, 원 제안 8번) — daypart 4개 합계 막대보다, RPC가 이미 돌려주는
    // 요일×daypart 전체 격자를 heatmap으로 보여주면 "무슨 요일에 강한지"까지 한 번에 보인다.
    visualization:
      heatmap(
        `${data.channel.name} 요일×시간대 평균 시청률`,
        ["월", "화", "수", "목", "금", "토", "일"],
        Object.values(DAYPART_LABEL),
        (rowDowLabel, colFriendlyLabel) => {
          const rawDaypart = (Object.keys(DAYPART_LABEL) as (keyof typeof DAYPART_LABEL)[]).find((k) => DAYPART_LABEL[k] === colFriendlyLabel);
          return data.rows.find((r) => r.dow_label === rowDowLabel && r.daypart === rawDaypart);
        }
      ) ?? bar(`${data.channel.name} 시간대별 평균 시청률`, sorted.map((a) => ({ label: DAYPART_LABEL[a.daypart] ?? a.daypart, value: a.avg }))),
    followups: [`${data.channel.name}의 최근 12주 프로그램 TOP은?`],
  };
}

interface TopProgramRow {
  program_name: string;
  avg_rating: number | null;
  air_count: number;
  top_daypart: string | null;
}
export function buildProgramTopAnswer(
  data: { channel: { code: string; name: string }; rows: TopProgramRow[] } | null,
  timeContext: TimeContext,
  limit: number
): EvidenceAnswer {
  if (!data || data.rows.length === 0) {
    return {
      ...base("PROGRAM_TOP", "PROGRAM_PERFORMANCE", data),
      conclusion: "프로그램 데이터를 찾지 못했습니다.",
      keyNumbers: "—",
      comparisonBasis: "최근 12주(84일)",
      evidence: "—",
      interpretation: "—",
      programmingAction: "—",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const top = data.rows.slice(0, limit);
  return {
    ...base("PROGRAM_TOP", "PROGRAM_PERFORMANCE", data),
    conclusion: `'${data.channel.name}' 최근 12주 시청률 TOP ${top.length} 프로그램입니다.`,
    keyNumbers: `1위: ${top[0].program_name} (${fmt(top[0].avg_rating)})`,
    comparisonBasis: "최근 12주(84일) 평균 시청률 순",
    evidence: top.map((p, i) => `${i + 1}. ${p.program_name} ${fmt(p.avg_rating)}(${p.air_count}회)`).join(" / "),
    interpretation: "이 목록은 최근 12주 누적 기준이며, 최신 편성이 아닌 프로그램도 포함될 수 있습니다.",
    programmingAction: "상위 프로그램은 STRENGTHEN, 하위 프로그램은 WHAT TO SCHEDULE?에서 REPLACE/TEST 여부를 확인하세요.",
    confidence: "HIGH",
    confidenceNote: "최근 12주 누적 집계 기준입니다.",
    visualization: table(
      `${data.channel.name} 프로그램 TOP ${top.length}`,
      ["순위", "프로그램", "평균 시청률", "방영 횟수"],
      top.map((p, i) => [i + 1, p.program_name, fmt(p.avg_rating), p.air_count])
    ),
    followups: [`${data.channel.name}의 시간대별 성과는?`],
  };
}

interface AffinityResult {
  channel_composition: number | null;
  compare_composition: number | null;
  affinity_index: number | null;
  sample_days_channel: number;
  insufficient_sample: boolean;
}
interface AffinityData {
  channel: { code: string; name: string };
  compareChannel: { code: string; name: string };
  items: { targetLabel: string; result: AffinityResult | null }[];
  isSingleTarget: boolean;
}
export function buildTargetAffinityAnswer(data: AffinityData | null, timeContext: TimeContext): EvidenceAnswer {
  const valid = (data?.items ?? []).filter((i) => i.result && !i.result.insufficient_sample && i.result.affinity_index !== null);
  if (!data || valid.length === 0) {
    return {
      ...base("TARGET_AFFINITY", "AUDIENCE_INTELLIGENCE", data),
      conclusion: "표본이 부족해 Affinity를 계산할 수 없습니다(INSUFFICIENT SAMPLE).",
      keyNumbers: "—",
      comparisonBasis: timeContext.label,
      evidence: "—",
      interpretation: "—",
      programmingAction: "데이터가 더 쌓인 뒤 다시 질의해 주세요.",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const sorted = [...valid].sort((a, b) => (b.result!.affinity_index ?? 0) - (a.result!.affinity_index ?? 0));
  const best = sorted[0];
  const idx = best.result!.affinity_index!;
  const level = idx >= 150 ? "Very Strong" : idx >= 120 ? "Strong" : idx >= 80 ? "Neutral" : "Weak";
  const list = sorted.map((i) => `${i.targetLabel} ${i.result!.affinity_index!.toFixed(1)}`).join(" / ");
  const minSampleDays = Math.min(...valid.map((i) => i.result!.sample_days_channel));
  return {
    ...base("TARGET_AFFINITY", "AUDIENCE_INTELLIGENCE", data),
    conclusion: data.isSingleTarget
      ? `'${data.channel.name}'의 ${best.targetLabel} Affinity는 ${idx.toFixed(1)}(${level})입니다.`
      : `'${data.channel.name}'에서 가장 강한 연령대는 ${best.targetLabel}입니다(Affinity ${idx.toFixed(1)}, ${level}).`,
    keyNumbers: `Affinity ${idx.toFixed(1)} (100=동일 비중)`,
    comparisonBasis: `비교 채널 '${data.compareChannel.name}' 대비, ${timeContext.label}. ※ 채널 단위 계산(프로그램 단위 아님, 대표 연령대 4개만)`,
    evidence: data.isSingleTarget
      ? `이 채널 구성비 ${fmt(best.result!.channel_composition, 1)}% / 비교 채널 구성비 ${fmt(best.result!.compare_composition, 1)}%`
      : `대표 연령대별 Affinity: ${list}`,
    interpretation: idx >= 120 ? "비교 채널 대비 이 연령대 비중이 뚜렷하게 높습니다." : idx < 80 ? "비교 채널 대비 이 연령대 비중이 낮습니다." : "비교 채널과 비슷한 수준입니다.",
    programmingAction: idx >= 120 ? "이 연령대를 겨냥한 콘텐츠 편성을 강화해볼 만합니다." : "—",
    confidence: confidenceFromSampleDays(minSampleDays),
    confidenceNote: CONFIDENCE_NOTE[confidenceFromSampleDays(minSampleDays)],
    visualization: data.isSingleTarget
      ? bar(`${data.channel.name} vs ${data.compareChannel.name} 구성비(%)`, [
          { label: data.channel.name, value: best.result!.channel_composition },
          { label: data.compareChannel.name, value: best.result!.compare_composition },
        ])
      : bar(`${data.channel.name} 연령대별 Affinity`, sorted.map((i) => ({ label: i.targetLabel, value: i.result!.affinity_index }))),
    followups: [`${data.channel.name}의 프로그램 TOP은?`],
  };
}

interface CompetitorInsightRow {
  competitor_name: string;
  today_rank: number | null;
  today_rating: number | null;
  delta_pct: number | null;
  // 사용자 지시(2026-08-25, 감사 후속): 등록 경쟁채널에 KPI 타깃 데이터가 없으면 SQL이 조용히
  // 다른 타깃으로 대체해왔다(버그 수정) — 실제 비교 타깃을 항상 함께 받는다.
  resolved_target_label: string | null;
}
export function buildCompetitivePositionAnswer(
  data: { channel: { code: string; name: string; primaryTarget: string }; rows: CompetitorInsightRow[] } | null,
  timeContext: TimeContext
): EvidenceAnswer {
  if (!data || data.rows.length === 0) {
    return {
      ...base("COMPETITIVE_POSITION", "COMPETITIVE_INTELLIGENCE", data),
      conclusion: "등록된 경쟁채널 데이터가 없습니다.",
      keyNumbers: "—",
      comparisonBasis: timeContext.label,
      evidence: "—",
      interpretation: "—",
      programmingAction: "관리자 화면에서 경쟁채널(Competitor Master)을 확인하세요.",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const sorted = [...data.rows].sort((a, b) => (a.today_rank ?? 999) - (b.today_rank ?? 999));
  const list = sorted.map((r) => `${r.competitor_name}(${r.today_rank ?? "—"}위, ${fmt(r.today_rating)}, 12주 평균 대비 ${pct(r.delta_pct)})`).join(" / ");
  // 등록 경쟁채널에 이 채널 KPI 타깃 데이터가 없어 SQL이 다른 타깃으로 대체했으면(버그 수정,
  // 2026-08-25) 이 목록이 무슨 타깃 기준인지 명시한다 — 조용히 다른 타깃으로 비교되던 걸 숨기지 않는다.
  const kpiLabel = resolveProgramLevelTargetLabel(data.channel.primaryTarget);
  const resolvedLabel = sorted[0].resolved_target_label;
  const targetMismatch = resolvedLabel !== null && resolvedLabel !== kpiLabel;
  return {
    ...base("COMPETITIVE_POSITION", "COMPETITIVE_INTELLIGENCE", data),
    conclusion: `'${data.channel.name}'의 등록 경쟁채널 ${sorted.length}개를 ${timeContext.label} 순위 순으로 비교했습니다.`,
    keyNumbers: `가장 순위 높은 경쟁채널: ${sorted[0].competitor_name}(${sorted[0].today_rank ?? "—"}위)`,
    comparisonBasis: `${timeContext.label} · 최근 12주(84일) 평균 대비 등락${targetMismatch ? ` · ⚠ 등록 경쟁채널에 KPI 타깃(${kpiLabel}) 데이터가 없어 '${resolvedLabel}' 타깃 기준으로 대체 비교` : ""}`,
    evidence: list,
    interpretation: "이 목록은 채널 단위 순위이며, 프로그램 단위 동시간대 비교는 별도 질문(동시간대 경쟁 프로그램)으로 확인하세요.",
    programmingAction: "12주 평균 대비 뚜렷하게 강세인 경쟁채널이 있으면 Page 2 COMPARED WITH?에서 상세 내용을 확인하세요.",
    confidence: "HIGH",
    confidenceNote: "등록된 경쟁채널(Competitor Master) 기준 확정 조회입니다.",
    visualization: table(
      "등록 경쟁채널 시청률",
      ["순위", "경쟁채널", "시청률", "12주 평균 대비"],
      sorted.slice(0, 8).map((r) => [r.today_rank ?? "—", r.competitor_name, fmt(r.today_rating), r.delta_pct !== null ? pct(r.delta_pct) : "데이터 없음"])
    ),
    followups: [`${data.channel.name}과 ${sorted[0].competitor_name}의 동시간대 프로그램 비교는?`],
  };
}

interface OverlapRow {
  our_program_name: string;
  our_start_time: string;
  our_rating: number | null;
  competitor_name: string;
  competitor_program_name: string;
  competitor_rating: number | null;
}
export function buildCompetitiveHeadToHeadAnswer(data: { channel: { code: string; name: string }; rows: OverlapRow[] } | null, timeContext: TimeContext): EvidenceAnswer {
  if (!data || data.rows.length === 0) {
    return {
      ...base("COMPETITIVE_HEAD_TO_HEAD", "COMPETITIVE_INTELLIGENCE", data),
      conclusion: `${timeContext.label} 방영 시간이 겹치는 등록 경쟁채널 프로그램을 찾지 못했습니다.`,
      keyNumbers: "—",
      comparisonBasis: timeContext.label,
      evidence: "—",
      interpretation: "—",
      programmingAction: "—",
      confidence: "INSUFFICIENT_SAMPLE",
      confidenceNote: CONFIDENCE_NOTE.INSUFFICIENT_SAMPLE,
    };
  }
  const byOurProgram = new Map<string, OverlapRow[]>();
  for (const r of data.rows) {
    const key = `${r.our_start_time} ${r.our_program_name}`;
    byOurProgram.set(key, [...(byOurProgram.get(key) ?? []), r]);
  }
  const summary = [...byOurProgram.entries()]
    .slice(0, 5)
    .map(([key, rows]) => `${key}(${fmt(rows[0].our_rating)}) vs ${rows.map((r) => `${r.competitor_name} '${r.competitor_program_name}'(${fmt(r.competitor_rating)})`).join(", ")}`)
    .join(" / ");
  return {
    ...base("COMPETITIVE_HEAD_TO_HEAD", "COMPETITIVE_INTELLIGENCE", data),
    conclusion: `'${data.channel.name}'의 ${timeContext.label} 방영 프로그램과 동시간대 등록 경쟁채널 프로그램을 비교했습니다.`,
    keyNumbers: `총 ${byOurProgram.size}개 시간대 겹침 확인`,
    comparisonBasis: `${timeContext.label} 하루 기준 · 방영 시간이 겹치는 등록 경쟁채널 프로그램 상위 3개`,
    evidence: summary,
    interpretation: "동시간대 시청률 차이만 보여줄 뿐, 원인(편성/콘텐츠)까지 단정하지 않습니다.",
    programmingAction: "격차가 큰 시간대는 Page 2 COMPARED WITH?에서 상세히 확인하세요.",
    confidence: "HIGH",
    confidenceNote: "당일 실측 데이터 기준입니다.",
    followups: [`${data.channel.name}의 등록 경쟁채널 전체 순위는?`],
  };
}

export function buildUnsupportedAnswer(missing?: string[]): EvidenceAnswer {
  const paramLabel: Record<string, string> = { channelCode: "채널", targetLabel: "타깃(연령대 등)", competitorName: "경쟁채널" };
  const missingNames = missing && missing.length > 0 ? missing.map((m) => paramLabel[m] ?? m).join(", ") : "";
  const missingText = missingNames ? `${missingNames}${josaEulReul(missingNames)} 질문에 포함해 주세요.` : "";
  return {
    intent_id: "UNSUPPORTED",
    macro_intent: "PORTFOLIO_HEALTH",
    conclusion: missingText
      ? `질문을 이해했지만 ${missingText}`
      : "현재 버전에서는 해당 질문을 직접 분석할 수 없습니다.",
    keyNumbers: "—",
    comparisonBasis: "—",
    evidence: "—",
    interpretation: missingText
      ? ""
      : "현재 지원 범위: 채널 성과, 프로그램 TOP, 시간대 분석, Target Affinity, 경쟁채널 비교, 포트폴리오 랭킹/KPI/알림.",
    programmingAction: "향후 LLM API 연동 시 자연어 질문 범위를 확장할 수 있습니다.",
    confidence: "INSUFFICIENT_SAMPLE",
    confidenceNote: "질문을 규칙 기반 Intent로 매칭하지 못했습니다.",
    raw: null,
  };
}
