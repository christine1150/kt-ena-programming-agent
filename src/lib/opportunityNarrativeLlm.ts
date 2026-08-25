// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2
// OPPORTUNITY?(기회가 있나요?) 서술도 규칙 기반 문자열 조합이었다. 같은 입력값(daypart별
// 격차 변화, STRENGTHEN/TEST 후보 프로그램)을 LLM에 줘서 하나의 자연스러운 문단으로 종합한다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface OpportunityNarrativeLlmInput {
  channelName: string;
  recentLabel: string; // "최근 1주" 또는 선택 기간 라벨
  dayparts: {
    daypart: string; // "새벽"/"오전"/"오후"/"저녁_심야"
    our_full_avg: number | null;
    our_recent_avg: number | null;
    gap_full: number | null; // 이전 평균 격차(경쟁채널-우리, 양수=경쟁채널이 더 높음)
    gap_recent: number | null;
    gap_change: number | null; // 양수=격차 축소(기회), 음수=격차 확대(방어 필요)
    classification: "PROTECT" | "DEFEND" | "IMPROVE" | "OPPORTUNITY" | null;
  }[];
  candidatePrograms: { name: string; tag: "STRENGTHEN" | "TEST"; targetAffinityScore: number | null; audienceFlowScore: number | null }[];
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 'OPPORTUNITY?(기회가 있나요)' 서술 작성기다.",
    "아래 dayparts 배열은 시간대(daypart)별 경쟁채널 대비 격차 변화다 — gap_change가 양수면 격차가 좁혀진(기회) 시간대, 음수면 격차가 벌어진(방어 필요) 시간대다. classification은 이미 판정된 4분류(PROTECT=유지/DEFEND=방어 필요/IMPROVE=개선 필요/OPPORTUNITY=성장 기회)다.",
    "가장 기회가 큰 시간대와 가장 방어가 필요한 시간대를 중심으로 2~4문장 문단을 작성해라. 구체적인 격차 수치(gap_full→gap_recent)를 인용해라.",
    "candidatePrograms에 STRENGTHEN/TEST 태그 프로그램이 있고 기회 시간대가 있으면, 그 프로그램을 그 시간대에 배치하는 것을 검토해볼 만하다고 제안해라(targetAffinityScore/audienceFlowScore가 70 이상이면 근거로 언급).",
    "dayparts/candidatePrograms에 없는 시간대·프로그램은 절대 언급하지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { narrative: { type: "string" } },
  required: ["narrative"],
  additionalProperties: false,
};

export async function buildOpportunityNarrativeViaLlm(input: OpportunityNarrativeLlmInput): Promise<string | null> {
  if (input.dayparts.length === 0) return null;
  const result = await callOpenAiJsonSynthesis<{ narrative: string }>(buildSystemPrompt(), input, "opportunity_narrative", SCHEMA);
  const narrative = result?.narrative?.trim();
  return narrative && narrative.length > 0 ? narrative : null;
}
