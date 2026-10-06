// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2
// COMPARED WITH?(경쟁채널과 비교하면) 서술도 규칙 기반이었다. 같은 입력값(경쟁채널별 오늘
// 시청률·12주 평균 대비 등락·오늘 최고 성적 프로그램)을 LLM에 줘서 하나의 문단으로 종합한다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";
import { guardForInput } from "./insight/guardInput";

export interface CompetitorNarrativeLlmInput {
  channelName: string;
  competitors: {
    competitor_name: string;
    today_rating: number | null;
    delta_pct: number | null; // baselineLabel(기본 "12주 평균") 대비 오늘 등락률
    top_program_name: string | null;
    top_program_start_time: string | null;
  }[];
  // 사용자 지시(2026-09-02, SDoW): delta_pct의 기준을 프롬프트에 정확히 알려주기 위한 라벨 —
  // SDoW 활성화 시 "선택한 요일의 최근 N주 평균"으로 바뀌므로, 없으면(기존 호출부) 기존 문구
  // "12주 평균"을 그대로 쓴다(하위호환).
  baselineLabel?: string;
}

function buildSystemPrompt(baselineLabel: string): string {
  return [
    "너는 KT ENA 편성 PD를 위한 'COMPARED WITH?(경쟁채널과 비교하면)' 서술 작성기다.",
    `아래 competitors 배열은 등록 경쟁채널별 오늘 시청률·${baselineLabel} 대비 등락률·오늘 최고 성적 프로그램이다.`,
    "delta_pct가 뚜렷하게 높은(대략 +15% 이상) 채널과 뚜렷하게 낮은(대략 -15% 이하) 채널을 각각 짚어 2~3문장으로 요약해라. 뚜렷한 변화가 없으면 '대부분 평소와 비슷한 수준'이라고만 짧게 서술해라.",
    `문장에서 delta_pct의 기준을 언급할 땐 반드시 "${baselineLabel} 대비"라고 표현해라(다른 기간을 지어내지 마라).`,
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
  const baselineLabel = input.baselineLabel ?? "12주 평균";
  // AI가 인용할 수 있는 자리수를 입력 단계에서 고정한다(시청률 3자리, 등락률 1자리) — 검증이 표기 차이로 멀쩡한 문장을 버리지 않도록.
  const sent = {
    channelName: input.channelName,
    competitors: input.competitors.map((c) => ({
      ...c,
      today_rating: c.today_rating === null ? null : Math.round(c.today_rating * 1000) / 1000,
      delta_pct: c.delta_pct === null ? null : Math.round(c.delta_pct * 10) / 10,
    })),
  };
  const result = await callOpenAiJsonSynthesis<{ narrative: string }>(buildSystemPrompt(baselineLabel), sent, "competitor_narrative", SCHEMA);
  // 단계 04: 숫자·기준·인과 검증. delta_pct의 기준은 baselineLabel 하나뿐이다.
  return guardForInput(result?.narrative, sent, { label: "competitor_narrative", rules: [{ match: /delta_pct$/, valueKind: "pct_change" }], baselineLabels: [baselineLabel] });
}
