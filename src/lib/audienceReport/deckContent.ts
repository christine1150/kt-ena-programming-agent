// Phase 13(2026-09-01, 사용자 지시 — "각 채널 보고서"/"종합 보고서" 버튼에 Word/PPT 아이콘 추가) —
// "6-슬라이드 임원 보고용 PPT" 콘텐츠의 재료(signals)를 이미 계산된 리포트 값에서만 뽑는다.
// 새 계산 없음 — 전부 AudienceReportDocument.recommendation(§08, 4개 모드 공통 필드)과
// kpiCards/programAudienceCross/targetHourlyPattern(Phase 12, 4개 모드 공통 필드)에서 값을 그대로
// 가져와 이미 검증된 한국어 문장(숫자는 formatRating/포맷된 값만) 배열로 묶는다.
//
// 설계: LLM에게 "필드별로 계산해서 채워라"가 아니라 "이미 사실인 문장들을 5대 작성 원칙대로
// 재구성해라"만 시킨다 — 그래서 여기 만드는 signals는 전부 완결된 한국어 절이고, LLM은 이
// 문장들을 인용·요약·재배열만 한다(새 숫자 발명 금지, narrativeLlm.ts의 기존 수치 대조를 그대로
// 적용할 수 있도록 숫자는 항상 formatRating 자릿수 규칙을 거친 문자열로만 들어간다).
import type { AudienceReportDocument } from "./reportModel";
import type { PortfolioReportDocument } from "./portfolioModel";
import { formatRating } from "./format";

function pctText(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined) return null;
  return `${pct >= 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(1)}%`;
}

export interface DeckSignalBundle {
  kpiSignals: string[]; // Slide 2(Executive Summary)
  trendSignals: string[]; // Slide 3(채널/기간 추이)
  demographicSignals: string[]; // Slide 4(타깃/포지셔닝)
  contentSignals: string[]; // Slide 5(킬러 콘텐츠·시간대)
  strategySignals: string[]; // Slide 6(Stop/Keep/Start 근거)
}

export function buildChannelDeckSignals(doc: AudienceReportDocument): DeckSignalBundle {
  const code = doc.channelCode;
  const kpiSignals: string[] = [];
  // MODE C(기간 A vs 기간 B)는 kpiCards가 아니라 kpiCompareTable을 쓴다(reportModel.ts 참고) —
  // 모드별로 필드 이름이 다른 유일한 지점이라 여기서만 분기한다.
  if (doc.body.mode === "compare") {
    for (const r of doc.body.sections.kpiCompareTable.rows.slice(0, 5)) {
      kpiSignals.push(`${r.label} 기간A ${r.formattedA} → 기간B ${r.formattedB}${r.pctChange !== null ? ` (${pctText(r.pctChange)})` : ""}`);
    }
  } else {
    for (const c of doc.body.sections.kpiCards.slice(0, 5)) {
      const parts = [`${c.label} ${c.formatted}`];
      const prior = pctText(c.priorDeltaPct);
      if (prior) parts.push(`전기간 대비 ${prior}`);
      const baseline = pctText(c.baselineDeltaPct);
      if (baseline) parts.push(`12주 평균 대비 ${baseline}`);
      kpiSignals.push(parts.join(", "));
    }
  }

  const trendSignals: string[] = [];
  const flow = doc.recommendation.channelFlow.weekdayFlow.filter((w) => w.avgRating !== null);
  if (flow.length > 0) {
    const sorted = [...flow].sort((a, b) => b.avgRating! - a.avgRating!);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best) trendSignals.push(`${best.dowLabel}요일 평균 ${formatRating(best.avgRating, code)}로 요일 중 가장 높음`);
    if (worst && worst.dowLabel !== best?.dowLabel) trendSignals.push(`${worst.dowLabel}요일 평균 ${formatRating(worst.avgRating, code)}로 요일 중 가장 낮음`);
  }
  trendSignals.push(...kpiSignals.slice(0, 2)); // 추이 슬라이드도 핵심 KPI 등락을 근거로 참조

  const demographicSignals: string[] = [];
  const cross = doc.body.sections.programAudienceCross;
  if (cross.available) {
    const ranked = [...cross.data].filter((r) => r.value !== null).sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
    for (const row of ranked.slice(0, 3)) {
      const delta = pctText(row.deltaPct);
      demographicSignals.push(`${row.programName} × ${row.demographicLabel} ${row.metric} ${formatRating(row.value, code)}${delta ? ` (등락 ${delta})` : ""}`);
    }
  }
  const hourly = doc.body.sections.targetHourlyPattern;
  if (hourly.available && hourly.data.peaks.length > 0) {
    const p = hourly.data.peaks[0];
    demographicSignals.push(`${p.demographicLabel} 시청 피크 시간대는 ${p.broadcastHour}시(${formatRating(p.avgRating, code)})`);
  }

  const contentSignals: string[] = [];
  if (doc.recommendation.programFlow.available) {
    const g = doc.recommendation.programFlow.data.growth[0];
    const w = doc.recommendation.programFlow.data.weakness[0];
    if (g) contentSignals.push(`성장 프로그램 "${g.canonicalName}" 등락 ${formatRating(g.ratingDelta, code)}(편성 ${g.periodAirCount ?? 0}회)`);
    if (w) contentSignals.push(`약세 프로그램 "${w.canonicalName}" 등락 ${formatRating(w.ratingDelta, code)}(편성 ${w.periodAirCount ?? 0}회)`);
  }
  const opp = doc.recommendation.slotDiagnosis.find((s) => s.diagnosis === "기회");
  const chk = doc.recommendation.slotDiagnosis.find((s) => s.diagnosis === "점검");
  if (opp) contentSignals.push(`${opp.hourBlock}시대 슬롯은 "기회"로 진단됨(경쟁 대비 격차 축소 중)`);
  if (chk) contentSignals.push(`${chk.hourBlock}시대 슬롯은 "점검"으로 진단됨(경쟁 대비 약세, 격차 확대 중)`);

  const strategySignals = doc.recommendation.recommendations.map((r) => `${r.basis} → ${r.suggestion}(확인 방법: ${r.verification})`);

  return { kpiSignals, trendSignals, demographicSignals, contentSignals, strategySignals };
}

export function buildPortfolioDeckSignals(doc: PortfolioReportDocument): DeckSignalBundle {
  const kpiSignals: string[] = [doc.groupA.oneLiner, doc.groupB.oneLiner];
  const allPeers = [...doc.groupA.peers, ...doc.groupB.peers].filter((p) => p.trend !== null);
  const rankedByTrend = [...allPeers].sort((a, b) => Math.abs(b.trend!) - Math.abs(a.trend!));
  for (const p of rankedByTrend.slice(0, 3)) {
    kpiSignals.push(`${p.channelName} 시청률 ${p.formattedLevel}, 추세 ${pctText(p.trend) ?? "—"}`);
  }

  const trendSignals: string[] = [];
  if (doc.groupA.commonPattern.direction) trendSignals.push(`Group A 공통 패턴: ${doc.groupA.commonPattern.label}(${doc.groupA.commonPattern.channelCodes.join("·")})`);
  if (doc.groupB.commonPattern.direction) trendSignals.push(`Group B 공통 패턴: ${doc.groupB.commonPattern.label}(${doc.groupB.commonPattern.channelCodes.join("·")})`);
  trendSignals.push(...kpiSignals.slice(2));

  const demographicSignals: string[] = [
    ...doc.groupA.opportunities.map((o) => `${o.channelName} 채널 고유 기회: ${o.label}`),
    ...doc.groupB.opportunities.map((o) => `${o.channelName} 채널 고유 기회: ${o.label}`),
  ];

  const contentSignals: string[] = doc.groupA.pipeline.slice(0, 3).map(
    (e) => `"${e.canonicalName}" ${e.fromChannelName}→${e.toChannelName} ${e.relation === "simulcast" ? "동시방송" : "재방"}, 유지율 ${e.retentionPct !== null ? `${e.retentionPct.toFixed(1)}%` : "—"}`
  );
  if (doc.slotOverlap.length > 0) {
    contentSignals.push(`요일·시간대 편성 중복 관찰 ${doc.slotOverlap.length}건(예: ${doc.slotOverlap[0].dowLabel}요일 ${doc.slotOverlap[0].hour}시 "${doc.slotOverlap[0].canonicalName}" — ${doc.slotOverlap[0].channelCodes.join("·")})`);
  }

  const strategySignals: string[] = doc.actionsByChannel
    .flatMap((a) => a.items.map((it) => `[${a.channelName}] ${it.basis} → ${it.suggestion}(확인: ${it.verification})`))
    .slice(0, 12);

  return { kpiSignals, trendSignals, demographicSignals, contentSignals, strategySignals };
}
