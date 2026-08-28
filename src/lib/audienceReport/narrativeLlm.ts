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
import type { KpiCard, AudienceReportBody } from "./reportModel";
import type { PortfolioReportDocument } from "./portfolioModel";

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

export { extractDecimalNumbers, factCheckNarrative };
