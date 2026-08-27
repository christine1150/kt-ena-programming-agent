// Phase 4(2026-08-27, 사용자 지시) — 기간 리포트(WTD/MTD/QTD/YTD/DoD~YoY 등) 전용 AI Executive
// Summary. src/lib/briefingReportLlm.ts(오늘 단일 일자 전용)와 완전히 같은 원칙 — 호출부가 이미
// 계산·검증한 값만 JSON으로 주고, LLM은 그 값만 인용해 한 문단으로 종합할 뿐 새 숫자를 만들지
// 않는다(callOpenAiJsonSynthesis 공용 헬퍼 재사용, 새 호출 로직 없음).
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface PeriodReportLlmInput {
  channelName: string;
  periodLabel: string; // "이번 분기 누적(QTD)" 등
  comparisonLabel: string | null; // "전분기" 등
  daysWithData: number;
  avgRating: number | null;
  priorPeriodChangePct: number | null;
  baselineChangePct: number | null;
  bestDate: string | null;
  bestRating: number | null;
  worstDate: string | null;
  worstRating: number | null;
  growthDrivers: { name: string; ratingDelta: number | null }[];
  weaknessDrivers: { name: string; ratingDelta: number | null }[];
  winDaypart: string | null;
  weaknessDaypart: string | null;
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 기간 리포트(주간/월간/분기/연간 또는 전기간 대비 분석) Executive Summary 작성기다.",
    "아래 JSON에 담긴 신호(기간 평균 시청률, 직전 동일 기간 대비 등락, 최근 12주 평균 대비 등락, 기간 중 최고/최저일, 상승/하락을 이끈 프로그램, 강세/약세 시간대)를 하나의 자연스러운 한국어 문단(4~7문장)으로 종합해라.",
    "이 리포트는 방송 편성 전문가가 의사결정 근거로 볼 문서다 — 단순 수치 나열이 아니라 '이 기간에 어떤 패턴이 있었는지'를 짚어라.",
    "growthDrivers/weaknessDrivers 배열이 비어 있으면 그 부분은 언급하지 마라.",
    "값이 null이거나 변화폭이 미미한 지표는 굳이 언급하지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};

export async function buildPeriodReportSummaryViaLlm(input: PeriodReportLlmInput): Promise<string | null> {
  const result = await callOpenAiJsonSynthesis<{ summary: string }>(buildSystemPrompt(), input, "period_report_summary", SCHEMA);
  const summary = result?.summary?.trim();
  return summary && summary.length > 0 ? summary : null;
}
