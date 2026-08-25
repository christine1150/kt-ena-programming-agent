// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2 WHY?의
// "주도 요인" 문장은 지금까지 편차가 가장 큰 후보 하나만 기계적으로 골라 그 문장을 그대로
// 보여줬다(buildWhyDiagnosis). 같은 후보 목록(이미 rootCauseAlert 트리거 시 5개 변수를 검증해
// 신호가 있는 것만 모은 것 — 새 계산 없음)을 LLM에 주고, 주도 요인을 중심으로 하되 다른 요인과의
// 동시 발생/상호작용까지 자연스럽게 짚은 문장으로 종합한다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface WhyDiagnosisLlmInput {
  channelName: string;
  candidates: { variable: string; strengthPct: number; sentence: string }[]; // 이미 strengthPct 내림차순 정렬됨(1번=주도 요인)
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 'WHY?(왜 그럴까요)' 진단 작성기다.",
    "아래 candidates 배열은 시청률 하락의 후보 요인들이다(strengthPct 내림차순 정렬 — 1번째가 편차가 가장 큰 '주도 요인'). 각 항목의 sentence 필드는 이미 검증된 설명 문장이다.",
    "1번째(주도) 요인을 중심으로 1~3문장의 진단을 작성해라. 2번째 이후 요인이 있고 그 편차도 함께 볼 만하면(1번째 대비 60% 이상 크기), 두 요인이 동시에 나타났다는 점과 콘텐츠 문제인지 시간대 문제인지 등 판단 방향을 자연스럽게 시사해도 좋다.",
    "candidates에 없는 요인은 절대 언급하지 마라. sentence에 있는 수치만 그대로 인용해라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { leadSentence: { type: "string" } },
  required: ["leadSentence"],
  additionalProperties: false,
};

export async function buildWhyDiagnosisViaLlm(input: WhyDiagnosisLlmInput): Promise<string | null> {
  if (input.candidates.length === 0) return null;
  const result = await callOpenAiJsonSynthesis<{ leadSentence: string }>(buildSystemPrompt(), input, "why_diagnosis", SCHEMA);
  const leadSentence = result?.leadSentence?.trim();
  return leadSentence && leadSentence.length > 0 ? leadSentence : null;
}
