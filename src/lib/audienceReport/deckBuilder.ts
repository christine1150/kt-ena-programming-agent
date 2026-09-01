// Phase 13(2026-09-01) — ExecutiveDeckDocument 조립. deckContent.ts(signals) → narrativeLlm.ts
// (buildExecutiveDeckNarrative, 수치 대조 통과분만) → 실패 시 결정론적 템플릿(지어내지 않는다는
// 원칙 — signals를 그대로 나열만 하는 안전한 폴백, generatedByAi:false로 정직하게 표시).
//
// Phase 14(2026-09-01, 사용자 재지시 — "그래프나 인포그래픽도 다 빠져있음", "주중·주말 등
// 종합적인 분석") — 차트 데이터(deckContent.ts의 buildChannelDeckChartData/
// buildPortfolioDeckChartData)를 함께 조립하고, 요일별(주중/주말)·시간대별 2개 슬라이드를
// 추가한다. 이 2개는 차트가 본문이라 LLM 없이 숫자에서 결정론적으로 캡션만 만든다.
import type { AudienceReportDocument } from "./reportModel";
import type { PortfolioReportDocument } from "./portfolioModel";
import type { ExecutiveDeckDocument, DeckAutoInsightSlide, DeckChartData } from "./deckModel";
import { buildChannelDeckSignals, buildPortfolioDeckSignals, buildChannelDeckChartData, buildPortfolioDeckChartData, type DeckSignalBundle } from "./deckContent";
import { buildExecutiveDeckNarrative, type DeckNarrative } from "./narrativeLlm";
import { formatRating } from "./format";

// 폴백은 signals를 그대로 나열만 한다(지어내지 않음) — 대신 표시분 외에 더 있는 신호는
// note(작은 글씨)로 몇 건이 생략됐는지 정직하게 밝힌다("no silent caps" 원칙, 이 프로젝트
// 전반에서 반복돼 온 관례를 그대로 따름).
function fallbackNarrative(signals: DeckSignalBundle): DeckNarrative {
  const take = (arr: string[], n: number) => arr.slice(0, n);
  const omitted = (arr: string[], shown: number) => (arr.length > shown ? `이 외 ${arr.length - shown}건의 근거 신호는 지면상 생략` : "");
  return {
    slide2: { actionTitle: take(signals.kpiSignals, 1)[0] ?? "이번 기간 핵심 지표 요약", kpiHighlights: take(signals.kpiSignals, 3), verdict: take(signals.kpiSignals, 3), note: omitted(signals.kpiSignals, 3) },
    slide3: { actionTitle: "채널·기간 추이 요약", chartNote: "[차트 삽입: 일자별 시청률 꺾은선 그래프]", bullets: take(signals.trendSignals, 5), soWhat: "추이 변화를 다음 편성 회의에서 검토 필요", note: omitted(signals.trendSignals, 5) },
    slide4: { actionTitle: "타깃·포지셔닝 요약", chartNote: "[차트 삽입: 연령대별 시청률 막대 그래프]", bullets: take(signals.demographicSignals, 5), soWhat: "타깃 반응이 큰 시간대·프로그램에 대한 후속 편성 검토 필요", note: omitted(signals.demographicSignals, 5) },
    slide5: {
      actionTitle: "킬러 콘텐츠·시간대 요약",
      chartNote: "[차트 삽입: 시간대×프로그램 히트맵]",
      topBullets: take(signals.contentSignals, 3),
      bottomBullets: take(signals.contentSignals.slice(3), 3),
      soWhat: "성과 상·하위 콘텐츠·슬롯에 대한 편성 조정 검토 필요",
      note: omitted(signals.contentSignals, 6),
    },
    slide6: { actionTitle: "편성 전략 제언(Stop / Keep / Start)", stop: [], keep: [], start: take(signals.strategySignals, 5), note: omitted(signals.strategySignals, 5) },
  };
}

// 요일별(주중/주말) 슬라이드 캡션 — 숫자 비교만(원인 단정 없음), charts.weekdayBars가 비어
// 있으면(포트폴리오 스코프 등) available:false로 슬라이드 자체를 생략한다.
function buildWeekdayAutoSlide(charts: DeckChartData, channelCode: string): DeckAutoInsightSlide {
  if (charts.weekdayBars.length === 0 || charts.weekdayAvg === null || charts.weekendAvg === null) {
    return { available: false, actionTitle: "", caption: "" };
  }
  const diffPct = charts.weekdayAvg > 0 ? ((charts.weekendAvg - charts.weekdayAvg) / charts.weekdayAvg) * 100 : null;
  const higher = charts.weekendAvg >= charts.weekdayAvg ? "주말" : "주중";
  const sorted = [...charts.weekdayBars].filter((b) => b.value !== null).sort((a, b) => b.value! - a.value!);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const actionTitle = diffPct !== null ? `${higher} 시청률이 ${Math.abs(diffPct).toFixed(1)}% 더 높음` : "주중·주말 요일별 시청률 분포";
  const captionParts = [`주중 평균 ${formatRating(charts.weekdayAvg, channelCode)}, 주말 평균 ${formatRating(charts.weekendAvg, channelCode)}`];
  if (best) captionParts.push(`최고 요일 ${best.label}(${formatRating(best.value, channelCode)})`);
  if (worst && worst.label !== best?.label) captionParts.push(`최저 요일 ${worst.label}(${formatRating(worst.value, channelCode)})`);
  return { available: true, actionTitle, caption: captionParts.join(" · ") };
}

// 시간대별 슬라이드 캡션 — 프라임(기본 20~24시) 평균과 전체 최고 시간대를 함께 밝힌다.
function buildHourlyAutoSlide(charts: DeckChartData, channelCode: string): DeckAutoInsightSlide {
  if (charts.hourlyBars.length === 0) return { available: false, actionTitle: "", caption: "" };
  const withValues = charts.hourlyBars.filter((b) => b.value !== null);
  if (withValues.length === 0) return { available: false, actionTitle: "", caption: "" };
  const sorted = [...withValues].sort((a, b) => b.value! - a.value!);
  const peak = sorted[0];
  const primeBars = charts.hourlyBars.filter((b) => {
    const h = parseInt(b.label, 10);
    return !isNaN(h) && h >= charts.primeHourFrom && h < charts.primeHourTo && b.value !== null;
  });
  const primeAvg = primeBars.length > 0 ? primeBars.reduce((a, b) => a + b.value!, 0) / primeBars.length : null;
  const actionTitle = peak ? `시청률 최고 시간대는 ${peak.label}(${formatRating(peak.value, channelCode)})` : "시간대별 시청률 분포";
  const captionParts: string[] = [];
  if (primeAvg !== null) captionParts.push(`프라임(${charts.primeHourFrom}~${charts.primeHourTo}시) 평균 ${formatRating(primeAvg, channelCode)}`);
  return { available: true, actionTitle, caption: captionParts.join(" · ") };
}

async function assembleDeck(
  scope: "channel" | "portfolio",
  channelCode: string | null,
  themeColor: string | null,
  entityLabel: string,
  periodLabel: string,
  signals: DeckSignalBundle,
  charts: DeckChartData
): Promise<ExecutiveDeckDocument> {
  const generated = await buildExecutiveDeckNarrative(scope, periodLabel, signals);
  const narrative = generated ?? fallbackNarrative(signals);
  const generatedByAi = generated !== null;

  return {
    scope,
    channelCode,
    themeColor,
    periodLabel,
    generatedByAi,
    charts,
    slides: {
      title: {
        title: `${entityLabel} 방송 편성 성과 및 종합 분석 보고서`,
        subtitle: periodLabel,
        dateLabel: periodLabel,
        author: "KT ENA 편성 AI Agent",
      },
      executiveSummary: { actionTitle: narrative.slide2.actionTitle, kpiHighlights: narrative.slide2.kpiHighlights, verdict: narrative.slide2.verdict, note: narrative.slide2.note },
      trend: { actionTitle: narrative.slide3.actionTitle, chartNote: narrative.slide3.chartNote, bullets: narrative.slide3.bullets, soWhat: narrative.slide3.soWhat, note: narrative.slide3.note },
      weekday: buildWeekdayAutoSlide(charts, channelCode ?? ""),
      hourly: buildHourlyAutoSlide(charts, channelCode ?? ""),
      demographic: { actionTitle: narrative.slide4.actionTitle, chartNote: narrative.slide4.chartNote, bullets: narrative.slide4.bullets, soWhat: narrative.slide4.soWhat, note: narrative.slide4.note },
      content: {
        actionTitle: narrative.slide5.actionTitle,
        chartNote: narrative.slide5.chartNote,
        topBullets: narrative.slide5.topBullets,
        bottomBullets: narrative.slide5.bottomBullets,
        soWhat: narrative.slide5.soWhat,
        note: narrative.slide5.note,
      },
      strategy: { actionTitle: narrative.slide6.actionTitle, stop: narrative.slide6.stop, keep: narrative.slide6.keep, start: narrative.slide6.start, note: narrative.slide6.note },
    },
  };
}

export async function buildChannelExecutiveDeck(doc: AudienceReportDocument): Promise<ExecutiveDeckDocument> {
  const signals = buildChannelDeckSignals(doc);
  const charts = buildChannelDeckChartData(doc);
  return assembleDeck("channel", doc.channelCode, doc.themeColor, doc.channelName, doc.period.label, signals, charts);
}

export async function buildPortfolioExecutiveDeck(doc: PortfolioReportDocument): Promise<ExecutiveDeckDocument> {
  const signals = buildPortfolioDeckSignals(doc);
  const charts = buildPortfolioDeckChartData(doc);
  return assembleDeck("portfolio", null, null, "KT ENA 7채널 포트폴리오", doc.period.label, signals, charts);
}
