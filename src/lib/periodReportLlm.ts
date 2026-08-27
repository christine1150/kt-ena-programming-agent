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
  // isNewlyScheduled를 명시적으로 줘서(priorAvgRating===null 그대로) LLM이 "새로 편성"을 추측하지
  // 않고 사실만 인용하게 한다 — 이전에는 ratingDelta만 주고 이 문구를 LLM이 스스로 추론했음
  // (Phase B에서 발견·정정, LLM_SYNTHESIS_GUARDRAIL "새 사실 창작 금지" 원칙에 더 부합).
  growthDrivers: { name: string; ratingDelta: number | null; isNewlyScheduled: boolean }[];
  weaknessDrivers: { name: string; ratingDelta: number | null; isNewlyScheduled: boolean }[];
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
    "isNewlyScheduled가 true인 프로그램만 '새로 편성'이라고 표현해라 — false거나 필드가 없으면 그렇게 단정하지 마라.",
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

// Phase B(2026-08-27, 사용자 지시: "Quarterly Report·Annual Report... Turning Point 자동 탐지
// 진행") — Quarterly/Annual tier 전용 "Strategic Implications" 섹션. buildPeriodReportSummaryViaLlm
// 과 완전히 같은 원칙(callOpenAiJsonSynthesis + LLM_SYNTHESIS_GUARDRAIL 재사용, 새 호출 로직 없음)
// 이되, Turning Points·경쟁 구도까지 근거로 주고 더 긴 종합 문단(6~10문장)을 요청한다. "예측이
// 아니라 현재 데이터 기준 참고용"임을 프롬프트에 명시(이 앱 전반의 "AI 추정 · 검증 안 됨" 배지와
// 같은 헤지 원칙).
export interface StrategicImplicationsLlmInput {
  channelName: string;
  periodLabel: string;
  reportTier: "quarterly" | "annual";
  avgRating: number | null;
  priorPeriodChangePct: number | null;
  baselineChangePct: number | null;
  turningPoints: { periodStart: string; direction: "up" | "down"; changePct: number }[];
  growthDrivers: { name: string; ratingDelta: number | null }[];
  weaknessDrivers: { name: string; ratingDelta: number | null }[];
  winDaypart: string | null;
  weaknessDaypart: string | null;
  topCompetitor: { name: string; rating: number | null } | null;
}

function buildStrategicImplicationsSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 Quarterly/Annual Report의 'Strategic Implications' 섹션 작성기다.",
    "아래 JSON(기간 평균 시청률·비교 등락, Turning Points(급변점), Growth/Weakness Driver, 강세/약세 시간대, 최상위 경쟁채널)을 근거로 6~10문장의 한국어 종합 문단을 써라.",
    "단순 수치 재나열이 아니라 '이 기간의 패턴이 다음 편성 의사결정에 어떤 함의를 갖는지'를 짚어라 — 단, 이는 참고 의견이며 확정된 예측이 아니라는 점을 문단 안에서 자연스럽게 드러내라(예: '~검토해볼 만하다', '~참고할 수 있다' 같은 헤지 표현).",
    "turningPoints가 비어 있으면 급변점이 없었다는 사실 자체도 짧게 언급해라(변동성이 낮았다는 뜻으로).",
    "growthDrivers/weaknessDrivers/topCompetitor가 null이거나 비어 있으면 그 부분은 언급하지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

export async function buildStrategicImplicationsViaLlm(input: StrategicImplicationsLlmInput): Promise<string | null> {
  const result = await callOpenAiJsonSynthesis<{ summary: string }>(buildStrategicImplicationsSystemPrompt(), input, "strategic_implications", SCHEMA);
  const summary = result?.summary?.trim();
  return summary && summary.length > 0 ? summary : null;
}
