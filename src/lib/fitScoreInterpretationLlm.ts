// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2 WHAT TO
// SCHEDULE?의 펼침 패널 해석(buildFitScoreInterpretation)도 규칙 기반이었다(강점/주의 지표
// 쌍으로만 기계적 문장화). 같은 6개 하위지표·신뢰도·태그를 LLM에 줘서 더 자연스러운 해석
// 문단으로 종합한다. 프로그램당 펼쳤을 때만 호출(항상 계산하지 않음 — 비용 절감).
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface FitScoreInterpretationLlmInput {
  programName: string;
  tag: "STRENGTHEN" | "KEEP" | "MOVE" | "REPLACE" | "TEST" | null;
  fitScore: number | null;
  confidencePct: number | null;
  subScores: { label: string; value: number | null }[];
  audienceRoleLabel: string | null; // "대중형(MASS)" 등, 있으면
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 'WHAT TO SCHEDULE?' 펼침 패널 해석 작성기다.",
    "아래 subScores(6개 하위지표, 0~100)와 태그(STRENGTHEN/KEEP/MOVE/REPLACE/TEST)를 보고 2~3문장으로 해석해라.",
    "70 이상인 지표는 강점으로, 40 이하인 지표는 주의할 점으로 짚어라(둘 다 없으면 그냥 '뚜렷한 강점·약점 없이 평이한 성과'라고 서술).",
    "confidencePct가 60 미만이면 표본이 적어 참고용이라는 점을 짚어라.",
    "마지막에 태그에 맞는 판단 방향(REPLACE=교체 검토, MOVE=이동 검토, STRENGTHEN=투입 확대 검토, KEEP=유지 재확인, TEST=표본 축적 필요)을 한 문장으로 시사해라.",
    "subScores에 없는 수치는 절대 만들지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { interpretation: { type: "string" } },
  required: ["interpretation"],
  additionalProperties: false,
};

export async function buildFitScoreInterpretationViaLlm(input: FitScoreInterpretationLlmInput): Promise<string | null> {
  const result = await callOpenAiJsonSynthesis<{ interpretation: string }>(buildSystemPrompt(), input, "fit_score_interpretation", SCHEMA);
  const interpretation = result?.interpretation?.trim();
  return interpretation && interpretation.length > 0 ? interpretation : null;
}
