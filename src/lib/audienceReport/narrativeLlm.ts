// Phase 10(2026-08-28, Audience Intelligence Report 계획서 J절 §12) — AI 문장 연결 + 수치 대조.
// 재사용: callOpenAiJsonSynthesis + LLM_SYNTHESIS_GUARDRAIL(src/lib/llmSynthesis.ts, 구
// periodReportLlm.ts와 정확히 같은 패턴 — gpt-4o-mini, JSON Schema strict, 실패 시 항상 null).
// 새로 만든 것(이 코드베이스에 선례 없음): 생성 문장의 숫자를 근거 값과 대조하는 검증 로직과
// 실패 시 1회 재생성 후 폐기하는 정책.
//
// 설계: LLM에게는 "이미 채널/skyUHD 반올림 규칙으로 포맷된 문자열"만 사실로 준다(원값 float가
// 아니라 formatted string) — 그러면 검증도 단순해진다. 생성 문장에서 소수점 있는 숫자만 추출해
// (정수는 시각·순위·회차 등일 수 있어 검증 대상에서 뺀다 — 오탐 방지, v1 단순화) 근거로 준
// formatted 문자열들에서 같은 방식으로 추출한 숫자 집합에 있는지 대조한다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "@/lib/llmSynthesis";
import { formatRating } from "./format";
import type { KpiCard, AudienceReportBody, ModeDSection } from "./reportModel";
import type { PortfolioReportDocument } from "./portfolioModel";
import type { AudienceReportRawData } from "./dataCollector";

export interface NarrativeFact {
  label: string;
  formatted: string;
}

function pctText(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined) return null;
  return `${pct >= 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(1)}%`;
}

function kpiFacts(cards: KpiCard[]): NarrativeFact[] {
  const facts: NarrativeFact[] = [];
  for (const c of cards) {
    facts.push({ label: c.label, formatted: c.formatted });
    const prior = pctText(c.priorDeltaPct);
    if (prior) facts.push({ label: `${c.label} 전기간 대비`, formatted: prior });
    const baseline = pctText(c.baselineDeltaPct);
    if (baseline) facts.push({ label: `${c.label} 12주 평균 대비`, formatted: baseline });
  }
  return facts;
}

// 모드별 kpiCards + 대표 시그널 1~2개만 뽑는다(이미 조립된 섹션 값만 고름, 새 계산 없음).
export function buildFactsForChannelReport(body: AudienceReportBody, channelCode: string): { facts: NarrativeFact[]; contextLabel: string } {
  if (body.mode === "single_day") {
    const s = body.sections;
    const facts = kpiFacts(s.kpiCards);
    if (s.programsBySlotDeviation.available && s.programsBySlotDeviation.data.top[0]) {
      const top = s.programsBySlotDeviation.data.top[0];
      facts.push({ label: `${top.hour}시 ${top.programNames}`, formatted: formatRating(top.todayRating, channelCode) });
    }
    return { facts, contextLabel: s.verdict.label };
  }
  if (body.mode === "range") {
    const s = body.sections;
    const facts = kpiFacts(s.kpiCards);
    if (s.programContribution.available && s.programContribution.data.growth[0]) {
      const top = s.programContribution.data.growth[0];
      facts.push({ label: top.canonicalName, formatted: formatRating(top.periodAvgRating, channelCode) });
    }
    return { facts, contextLabel: `${s.summary.shape} 흐름, ${s.structuralVerdict.label}` };
  }
  if (body.mode === "compare") {
    const s = body.sections;
    const facts: NarrativeFact[] = s.kpiCompareTable.rows.flatMap((r) => [
      { label: `${r.label} 기간A`, formatted: r.formattedA },
      { label: `${r.label} 기간B`, formatted: r.formattedB },
    ]);
    return { facts, contextLabel: `${s.changeSummary.direction === "up" ? "상승" : s.changeSummary.direction === "down" ? "하락" : "변화 없음"}${s.changeSummary.topContributor ? `, 주된 기여: ${s.changeSummary.topContributor}` : ""}` };
  }
  const s = body.sections;
  const facts = kpiFacts(s.kpiCards);
  if (s.currentPosition.cumulativeAvg !== null) facts.push({ label: "누적 평균", formatted: formatRating(s.currentPosition.cumulativeAvg, channelCode) });
  const topContributor = s.topContributors[0];
  if (topContributor) facts.push({ label: topContributor.canonicalName, formatted: formatRating(topContributor.periodAvgRating, channelCode) });
  return { facts, contextLabel: `누적 관점` };
}

export function buildFactsForPortfolio(doc: PortfolioReportDocument): { facts: NarrativeFact[]; contextLabel: string } {
  const facts: NarrativeFact[] = [];
  for (const p of [...doc.groupA.peers, ...doc.groupB.peers]) {
    facts.push({ label: p.channelName, formatted: p.formattedLevel });
    const trend = pctText(p.trend);
    if (trend) facts.push({ label: `${p.channelName} 추세`, formatted: trend });
  }
  const contextLabel = `${doc.groupA.oneLiner} / ${doc.groupB.oneLiner}`;
  return { facts, contextLabel };
}

// ---------------- 생성 ----------------
const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };

function buildSystemPrompt(scope: "channel" | "portfolio"): string {
  const scopeLine =
    scope === "channel"
      ? "너는 KT ENA 편성 PD를 위한 채널 리포트의 'AI Executive Summary' 작성기다."
      : "너는 KT ENA 편성 PD를 위한 7채널 포트폴리오 리포트의 'AI Executive Summary' 작성기다.";
  return [
    scopeLine,
    "아래 JSON의 facts 배열(label과 이미 반올림·포맷된 formatted 문자열 쌍)과 contextLabel(참고 문맥)을 근거로 3~5문장의 한국어 문단을 써라.",
    "숫자를 언급할 때는 반드시 facts에 있는 formatted 문자열을 그대로 인용해라(자릿수를 바꾸거나 재계산하지 마라).",
    "facts에 없는 항목은 언급하지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

async function callSummary(scope: "channel" | "portfolio", channelName: string, periodLabel: string, contextLabel: string, facts: NarrativeFact[]): Promise<string | null> {
  if (facts.length === 0) return null; // 의미 있게 종합할 사실이 없으면 아예 호출하지 않는다.
  const result = await callOpenAiJsonSynthesis<{ summary: string }>(buildSystemPrompt(scope), { channelName, periodLabel, contextLabel, facts }, `audience_report_${scope}_summary`, SCHEMA);
  const summary = result?.summary?.trim();
  return summary && summary.length > 0 ? summary : null;
}

// 생성 문장에서 소수점 있는 숫자만 추출한다(정수는 시각·순위·회차 등일 수 있어 오탐 방지 —
// v1 단순화, 정직하게 밝히는 한계).
function extractDecimalNumbers(text: string): number[] {
  return Array.from(text.matchAll(/\d+\.\d+/g)).map((m) => parseFloat(m[0]));
}

function factCheckNarrative(text: string, facts: NarrativeFact[]): boolean {
  const allowed = new Set(facts.flatMap((f) => extractDecimalNumbers(f.formatted)));
  const found = extractDecimalNumbers(text);
  return found.every((n) => Array.from(allowed).some((a) => Math.abs(a - n) < 1e-6));
}

/** 생성 → 검증 → 실패하면 1회만 같은 입력으로 재시도 → 그래도 실패하면 null(지어내는 것보다
 *  안 보여주는 게 낫다는 원칙). */
async function verifyAndBuildSummary(scope: "channel" | "portfolio", channelName: string, periodLabel: string, contextLabel: string, facts: NarrativeFact[]): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callSummary(scope, channelName, periodLabel, contextLabel, facts);
    if (text && factCheckNarrative(text, facts)) return text;
  }
  return null;
}

export async function buildChannelExecutiveSummary(channelName: string, periodLabel: string, body: AudienceReportBody, channelCode: string): Promise<string | null> {
  const { facts, contextLabel } = buildFactsForChannelReport(body, channelCode);
  return verifyAndBuildSummary("channel", channelName, periodLabel, contextLabel, facts);
}

export async function buildPortfolioExecutiveSummary(periodLabel: string, doc: PortfolioReportDocument): Promise<string | null> {
  const { facts, contextLabel } = buildFactsForPortfolio(doc);
  return verifyAndBuildSummary("portfolio", "KT ENA 7채널 포트폴리오", periodLabel, contextLabel, facts);
}

// N절 Phase 2c(2026-09-01, 구 시스템 periodReportLlm.ts의 buildStrategicImplicationsViaLlm 이식) —
// MODE D(누적, QTD/YTD 등) 전용 별도 종합 문단. "AI Executive Summary"(위, 3~5문장)와는 별개로
// 더 긴(6~10문장) 문단을 만든다 — 변곡점·성장/약세 동력·daypart 강약·경쟁 구도까지 근거로 준다.
// 구 시스템엔 수치 대조(fact-check)가 없었다 — 이식하면서 Phase 10의 factCheckNarrative를
// 그대로 적용해 오히려 더 안전해졌다(같은 재시도 정책: 실패 시 1회만 재생성, 그래도 실패하면 null).
function pctFact(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined) return null;
  return `${pct >= 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(1)}%`;
}

export function buildFactsForStrategicImplications(raw: AudienceReportRawData, sections: ModeDSection): { facts: NarrativeFact[]; contextLabel: string } {
  const facts = kpiFacts(sections.kpiCards);

  for (const t of sections.turningPoints.slice(0, 3)) {
    const p = pctFact(t.changePct);
    if (p) facts.push({ label: `변곡점 ${t.periodStart}`, formatted: p });
  }

  const moversWithDelta = raw.programMovers.filter((m) => m.ratingDelta !== null);
  const growth = [...moversWithDelta].filter((m) => m.ratingDelta! > 0).sort((a, b) => b.ratingDelta! - a.ratingDelta!).slice(0, 2);
  const weakness = [...moversWithDelta].filter((m) => m.ratingDelta! < 0).sort((a, b) => a.ratingDelta! - b.ratingDelta!).slice(0, 2);
  for (const m of growth) facts.push({ label: `성장 동력 ${m.canonicalName}`, formatted: formatRating(m.ratingDelta, raw.channelCode) });
  for (const m of weakness) facts.push({ label: `약세 동력 ${m.canonicalName}`, formatted: formatRating(m.ratingDelta, raw.channelCode) });

  if (sections.daypartWinWeakness.win) facts.push({ label: `강세 시간대 ${sections.daypartWinWeakness.win.daypartLabel}`, formatted: pctFact(sections.daypartWinWeakness.win.gapChange) ?? "" });
  if (sections.daypartWinWeakness.weakness) facts.push({ label: `약세 시간대 ${sections.daypartWinWeakness.weakness.daypartLabel}`, formatted: pctFact(sections.daypartWinWeakness.weakness.gapChange) ?? "" });

  const topCompetitor = raw.competitorTopPrograms[0];
  if (topCompetitor) facts.push({ label: `최상위 경쟁 ${topCompetitor.competitor_name} ${topCompetitor.program_name}`, formatted: formatRating(topCompetitor.program_avg_rating, raw.channelCode) });

  const turningPointCount = sections.turningPoints.length;
  return { facts: facts.filter((f) => f.formatted.length > 0), contextLabel: turningPointCount > 0 ? `변곡점 ${turningPointCount}건` : "변곡점 없음(변동성 낮음)" };
}

function buildStrategicImplicationsSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 Quarterly/Annual 리포트의 'Strategic Implications' 섹션 작성기다.",
    "아래 JSON의 facts 배열(label과 이미 반올림·포맷된 formatted 문자열 쌍)과 contextLabel(참고 문맥)을 근거로 6~10문장의 한국어 종합 문단을 써라.",
    "숫자를 언급할 때는 반드시 facts에 있는 formatted 문자열을 그대로 인용해라(자릿수를 바꾸거나 재계산하지 마라).",
    "단순 수치 재나열이 아니라 '이 기간의 패턴이 다음 편성 의사결정에 어떤 함의를 갖는지'를 짚어라 — 단, 이는 참고 의견이며 확정된 예측이 아니라는 점을 문단 안에서 자연스럽게 드러내라(예: '~검토해볼 만하다', '~참고할 수 있다' 같은 헤지 표현).",
    "contextLabel이 '변곡점 없음'이면 급변점이 없었다는 사실 자체를 변동성이 낮았다는 뜻으로 짧게 언급해라.",
    "facts에 없는 항목은 언급하지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

export async function buildStrategicImplications(channelName: string, periodLabel: string, raw: AudienceReportRawData, sections: ModeDSection): Promise<string | null> {
  const { facts, contextLabel } = buildFactsForStrategicImplications(raw, sections);
  if (facts.length === 0) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callOpenAiJsonSynthesis<{ summary: string }>(
      buildStrategicImplicationsSystemPrompt(),
      { channelName, periodLabel, contextLabel, facts },
      "strategic_implications",
      SCHEMA
    );
    const text = result?.summary?.trim();
    if (text && text.length > 0 && factCheckNarrative(text, facts)) return text;
  }
  return null;
}

// Phase 13(2026-09-01) — "6-슬라이드 임원 보고용 PPT" 콘텐츠 생성. deckContent.ts가 이미
// 완결된 한국어 문장(숫자는 formatRating을 거친 값만)으로 뽑아준 signals를 근거로, LLM에게는
// "문장을 재구성만 하라"만 시킨다 — 새 숫자·새 사실 발명 금지, 기존 factCheckNarrative를 그대로
// 적용해 생성된 6개 슬라이드의 모든 텍스트 필드를 한 번에 대조한다.
import type { DeckSignalBundle } from "./deckContent";

export interface DeckNarrative {
  slide2: { actionTitle: string; kpiHighlights: string[]; verdict: string[]; note: string };
  slide3: { actionTitle: string; chartNote: string; bullets: string[]; soWhat: string; note: string };
  slide4: { actionTitle: string; chartNote: string; bullets: string[]; soWhat: string; note: string };
  slide5: { actionTitle: string; chartNote: string; topBullets: string[]; bottomBullets: string[]; soWhat: string; note: string };
  slide6: { actionTitle: string; stop: string[]; keep: string[]; start: string[]; note: string };
}

const NOTE_PROP = { note: { type: "string" } } as const;

const DECK_SCHEMA = {
  type: "object",
  properties: {
    slide2: {
      type: "object",
      properties: {
        actionTitle: { type: "string" },
        kpiHighlights: { type: "array", items: { type: "string" } },
        verdict: { type: "array", items: { type: "string" } },
        ...NOTE_PROP,
      },
      required: ["actionTitle", "kpiHighlights", "verdict", "note"],
      additionalProperties: false,
    },
    slide3: {
      type: "object",
      properties: { actionTitle: { type: "string" }, chartNote: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, soWhat: { type: "string" }, ...NOTE_PROP },
      required: ["actionTitle", "chartNote", "bullets", "soWhat", "note"],
      additionalProperties: false,
    },
    slide4: {
      type: "object",
      properties: { actionTitle: { type: "string" }, chartNote: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, soWhat: { type: "string" }, ...NOTE_PROP },
      required: ["actionTitle", "chartNote", "bullets", "soWhat", "note"],
      additionalProperties: false,
    },
    slide5: {
      type: "object",
      properties: {
        actionTitle: { type: "string" },
        chartNote: { type: "string" },
        topBullets: { type: "array", items: { type: "string" } },
        bottomBullets: { type: "array", items: { type: "string" } },
        soWhat: { type: "string" },
        ...NOTE_PROP,
      },
      required: ["actionTitle", "chartNote", "topBullets", "bottomBullets", "soWhat", "note"],
      additionalProperties: false,
    },
    slide6: {
      type: "object",
      properties: {
        actionTitle: { type: "string" },
        stop: { type: "array", items: { type: "string" } },
        keep: { type: "array", items: { type: "string" } },
        start: { type: "array", items: { type: "string" } },
        ...NOTE_PROP,
      },
      required: ["actionTitle", "stop", "keep", "start", "note"],
      additionalProperties: false,
    },
  },
  required: ["slide2", "slide3", "slide4", "slide5", "slide6"],
  additionalProperties: false,
};

function deckSystemPrompt(scope: "channel" | "portfolio"): string {
  return [
    scope === "channel"
      ? "너는 KT ENA 편성 본부장에게 보고할 6-슬라이드 임원 보고용 PPT의 2~6번 슬라이드 내용을 작성하는 방송 편성/전략 전문가다."
      : "너는 KT ENA 7채널 포트폴리오를 다루는 6-슬라이드 임원 보고용 PPT의 2~6번 슬라이드 내용을 작성하는 방송 편성/전략 전문가다.",
    "아래 JSON의 kpiSignals/trendSignals/demographicSignals/contentSignals/strategySignals는 이미 검증된 사실 문장이다 — 이 문장에 없는 숫자나 사실을 새로 만들지 마라, 재배열·요약·인용만 해라.",
    "PPT 작성 5대 원칙을 반드시 지켜라:",
    "1) Action Title(결론이 곧 제목) — 예: '시청률 현황' 같은 사실 나열형 제목 금지, '주말 프라임타임 시청률 상승, 2040 타겟 유입이 견인'처럼 결론을 제목으로.",
    "2) One Slide, One Message — 슬라이드마다 핵심 메시지 하나에 집중.",
    "3) 텍스트 최소화·개조식 — bullets/verdict/soWhat 등 모든 항목은 완결된 서술형 문장이 아니라 명사형으로 끝나는 개조식으로 짧게 써라(예: '~함', '~검토' 대신 '~ 상승', '~ 검토 필요').",
    "4) chartNote 필드는 반드시 '[차트 삽입: 구체적인 차트 종류와 내용]' 형식으로 써라(예: '[차트 삽입: 일자별 시청률 꺾은선 그래프]').",
    "5) So What — soWhat 필드는 반드시 데이터 설명이 아니라 향후 편성/전략 시사점을 담아라.",
    "slide6은 STOP(중단·재검토 대상)/KEEP(유지)/START(신규·확대) 3분류로 나눠라 — strategySignals의 근거만 사용해 분류하고, 근거가 부족한 칸은 빈 배열로 둬라(억지로 채우지 마라).",
    "각 슬라이드의 actionTitle/kpiHighlights/verdict/bullets/soWhat/stop/keep/start는 모두 합쳐 50단어 내외로 짧고 개조식으로 써라 — 이 본문 글자 수는 반드시 지켜라.",
    "단, 본문만으로는 오해의 소지가 있거나 꼭 필요한 부연 설명이 있으면(예: 수치의 전제 조건, 용어 설명) note 필드에 한 문장으로만 짧게 담아라 — note는 화면·PPT에서 본문보다 작은 글씨로 별도 표시되므로 본문 글자 수 제한과 별개다. 필요 없으면 note는 빈 문자열로 둬라(억지로 채우지 마라).",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

function flattenDeckText(n: DeckNarrative): string {
  return [
    n.slide2.actionTitle, ...n.slide2.kpiHighlights, ...n.slide2.verdict, n.slide2.note,
    n.slide3.actionTitle, n.slide3.chartNote, ...n.slide3.bullets, n.slide3.soWhat, n.slide3.note,
    n.slide4.actionTitle, n.slide4.chartNote, ...n.slide4.bullets, n.slide4.soWhat, n.slide4.note,
    n.slide5.actionTitle, n.slide5.chartNote, ...n.slide5.topBullets, ...n.slide5.bottomBullets, n.slide5.soWhat, n.slide5.note,
    n.slide6.actionTitle, ...n.slide6.stop, ...n.slide6.keep, ...n.slide6.start, n.slide6.note,
  ].join(" ");
}

/** 생성 → 전체 텍스트 수치 대조 → 실패하면 1회만 재시도 → 그래도 실패하면 null(지어내는 것보다
 *  안 보여주는 게 낫다는 원칙 — 호출부가 결정론적 템플릿으로 대체). */
export async function buildExecutiveDeckNarrative(scope: "channel" | "portfolio", periodLabel: string, signals: DeckSignalBundle): Promise<DeckNarrative | null> {
  const allFacts: NarrativeFact[] = [
    ...signals.kpiSignals, ...signals.trendSignals, ...signals.demographicSignals, ...signals.contentSignals, ...signals.strategySignals,
  ].map((s) => ({ label: "signal", formatted: s }));
  if (allFacts.length === 0) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callOpenAiJsonSynthesis<DeckNarrative>(deckSystemPrompt(scope), { periodLabel, ...signals }, "audience_report_deck", DECK_SCHEMA, { timeoutMs: 15000 });
    if (result && factCheckNarrative(flattenDeckText(result), allFacts)) return result;
  }
  return null;
}

export { extractDecimalNumbers, factCheckNarrative };
