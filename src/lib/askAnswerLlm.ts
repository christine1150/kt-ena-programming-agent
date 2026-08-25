// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — /api/ask
// (자연어 질문)의 답변은 지금까지 conclusion/keyNumbers/comparisonBasis/evidence/interpretation/
// programmingAction 6개 필드 전부 고정 템플릿 문자열이었다(어떤 질문이든 같은 틀). 이미 계산된
// 4개 필드(conclusion/keyNumbers/comparisonBasis/evidence — 전부 SQL이 계산한 값 그대로)는
// "주어진 사실"로 그대로 두고, interpretation·programmingAction 2개만 사용자의 실제 질문 맥락에
// 맞게 OpenAI가 다시 쓰게 한다 — 숫자·사실 필드는 절대 건드리지 않는다(새로 만들지 않음).
// 실패하면 null을 돌려주고 호출부(ask/route.ts)가 기존 템플릿 문구를 그대로 쓴다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface AskAnswerLlmInput {
  question: string; // 사용자가 실제로 입력한 질문 원문
  conclusion: string;
  keyNumbers: string;
  comparisonBasis: string;
  evidence: string;
  confidenceNote: string;
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD의 자연어 질문에 답하는 AI 편성 비서다.",
    "아래 JSON에는 사용자의 실제 질문(question)과, 이미 SQL로 계산·검증된 결론(conclusion)·핵심 수치(keyNumbers)·비교 기준(comparisonBasis)·근거(evidence)·표본 신뢰도(confidenceNote)가 담겨 있다.",
    "이 값들을 바탕으로 두 가지만 새로 작성해라: (1) interpretation — 이 데이터가 사용자의 질문 맥락에서 어떤 의미인지 1~3문장으로 자연스럽게 해석, (2) programmingAction — 이 상황에서 편성PD가 다음에 확인·검토해볼 만한 구체적인 행동 1문장.",
    "conclusion/keyNumbers/comparisonBasis/evidence에 없는 숫자나 사실을 새로 만들지 마라 — 이미 준 값만 재구성·해석해라.",
    "사용자가 실제로 물어본 질문에 직접 답하는 톤으로 써라(질문을 무시한 일반론 금지).",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    interpretation: { type: "string" },
    programmingAction: { type: "string" },
  },
  required: ["interpretation", "programmingAction"],
  additionalProperties: false,
};

export async function enhanceAskAnswerViaLlm(input: AskAnswerLlmInput): Promise<{ interpretation: string; programmingAction: string } | null> {
  const result = await callOpenAiJsonSynthesis<{ interpretation: string; programmingAction: string }>(
    buildSystemPrompt(),
    input,
    "ask_answer_enhancement",
    SCHEMA
  );
  if (!result) return null;
  const interpretation = result.interpretation?.trim();
  const programmingAction = result.programmingAction?.trim();
  if (!interpretation || !programmingAction) return null;
  return { interpretation, programmingAction };
}
