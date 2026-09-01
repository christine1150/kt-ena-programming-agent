// Phase 13(2026-09-01) — ExecutiveDeckDocument 조립. deckContent.ts(signals) → narrativeLlm.ts
// (buildExecutiveDeckNarrative, 수치 대조 통과분만) → 실패 시 결정론적 템플릿(지어내지 않는다는
// 원칙 — signals를 그대로 나열만 하는 안전한 폴백, generatedByAi:false로 정직하게 표시).
import type { AudienceReportDocument } from "./reportModel";
import type { PortfolioReportDocument } from "./portfolioModel";
import type { ExecutiveDeckDocument } from "./deckModel";
import { buildChannelDeckSignals, buildPortfolioDeckSignals, type DeckSignalBundle } from "./deckContent";
import { buildExecutiveDeckNarrative, type DeckNarrative } from "./narrativeLlm";

function fallbackNarrative(signals: DeckSignalBundle): DeckNarrative {
  const take = (arr: string[], n: number) => arr.slice(0, n);
  return {
    slide2: { actionTitle: take(signals.kpiSignals, 1)[0] ?? "이번 기간 핵심 지표 요약", kpiHighlights: take(signals.kpiSignals, 3), verdict: take(signals.kpiSignals, 3) },
    slide3: { actionTitle: "채널·기간 추이 요약", chartNote: "[차트 삽입: 일자별 시청률 꺾은선 그래프]", bullets: take(signals.trendSignals, 5), soWhat: "추이 변화를 다음 편성 회의에서 검토 필요" },
    slide4: { actionTitle: "타깃·포지셔닝 요약", chartNote: "[차트 삽입: 연령대별 시청률 막대 그래프]", bullets: take(signals.demographicSignals, 5), soWhat: "타깃 반응이 큰 시간대·프로그램에 대한 후속 편성 검토 필요" },
    slide5: {
      actionTitle: "킬러 콘텐츠·시간대 요약",
      chartNote: "[차트 삽입: 시간대×프로그램 히트맵]",
      topBullets: take(signals.contentSignals, 3),
      bottomBullets: take(signals.contentSignals.slice(3), 3),
      soWhat: "성과 상·하위 콘텐츠·슬롯에 대한 편성 조정 검토 필요",
    },
    slide6: { actionTitle: "편성 전략 제언(Stop / Keep / Start)", stop: [], keep: [], start: take(signals.strategySignals, 5) },
  };
}

async function assembleDeck(scope: "channel" | "portfolio", channelCode: string | null, entityLabel: string, periodLabel: string, signals: DeckSignalBundle): Promise<ExecutiveDeckDocument> {
  const generated = await buildExecutiveDeckNarrative(scope, periodLabel, signals);
  const narrative = generated ?? fallbackNarrative(signals);
  const generatedByAi = generated !== null;

  return {
    scope,
    channelCode,
    periodLabel,
    generatedByAi,
    slides: {
      title: {
        title: `${entityLabel} 방송 편성 성과 및 종합 분석 보고서`,
        subtitle: periodLabel,
        dateLabel: periodLabel,
        author: "KT ENA 편성 AI Agent",
      },
      executiveSummary: { actionTitle: narrative.slide2.actionTitle, kpiHighlights: narrative.slide2.kpiHighlights, verdict: narrative.slide2.verdict },
      trend: { actionTitle: narrative.slide3.actionTitle, chartNote: narrative.slide3.chartNote, bullets: narrative.slide3.bullets, soWhat: narrative.slide3.soWhat },
      demographic: { actionTitle: narrative.slide4.actionTitle, chartNote: narrative.slide4.chartNote, bullets: narrative.slide4.bullets, soWhat: narrative.slide4.soWhat },
      content: {
        actionTitle: narrative.slide5.actionTitle,
        chartNote: narrative.slide5.chartNote,
        topBullets: narrative.slide5.topBullets,
        bottomBullets: narrative.slide5.bottomBullets,
        soWhat: narrative.slide5.soWhat,
      },
      strategy: { actionTitle: narrative.slide6.actionTitle, stop: narrative.slide6.stop, keep: narrative.slide6.keep, start: narrative.slide6.start },
    },
  };
}

export async function buildChannelExecutiveDeck(doc: AudienceReportDocument): Promise<ExecutiveDeckDocument> {
  const signals = buildChannelDeckSignals(doc);
  return assembleDeck("channel", doc.channelCode, doc.channelName, doc.period.label, signals);
}

export async function buildPortfolioExecutiveDeck(doc: PortfolioReportDocument): Promise<ExecutiveDeckDocument> {
  const signals = buildPortfolioDeckSignals(doc);
  return assembleDeck("portfolio", null, "KT ENA 7채널 포트폴리오", doc.period.label, signals);
}
