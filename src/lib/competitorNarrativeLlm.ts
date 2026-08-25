// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2
// COMPARED WITH?(경쟁채널과 비교하면) 서술도 규칙 기반이었다. 같은 입력값(경쟁채널별 오늘
// 시청률·12주 평균 대비 등락·오늘 최고 성적 프로그램)을 LLM에 줘서 하나의 문단으로 종합한다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface CompetitorNarrativeLlmInput {
  channelName: string;
  competitors: {
    competitor_name: string;
    today_rating: number | null;
    delta_pct: number | null; // 12주 평균 대비 오늘 등락률
    top_program_name: string | null;
    top_program_start_time: string | null;
  }[];
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 'COMPARED WITH?(경쟁채널과 비교하면)' 서술 작성기다.",
    "아래 competitors 배열은 등록 경쟁채널별 오늘 시청률·12주 평균 대비 등락률·오늘 최고 성적 프로그램이다.",
    "delta_pct가 뚜렷하게 높은(대략 +15% 이상) 채널과 뚜렷하게 낮은(대략 -15% 이하) 채널을 각각 짚어 2~3문장으로 요약해라. 뚜렷한 변화가 없으면 '대부분 평소와 비슷한 수준'이라고만 짧게 서술해라.",
    "competitors 배열에 없는 채널·프로그램은 절대 언급하지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { narrative: { type: "string" } },
  required: ["narrative"],
  additionalProperties: false,
};

export async function buildCompetitorNarrativeViaLlm(input: CompetitorNarrativeLlmInput): Promise<string | null> {
  if (input.competitors.length === 0) return null;
  const result = await callOpenAiJsonSynthesis<{ narrative: string }>(buildSystemPrompt(), input, "competitor_narrative", SCHEMA);
  const narrative = result?.narrative?.trim();
  return narrative && narrative.length > 0 ? narrative : null;
}
