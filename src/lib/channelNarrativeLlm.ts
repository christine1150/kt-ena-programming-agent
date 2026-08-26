// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 1
// "채널별 인사이트"(Dashboard.tsx buildChannelNarrative)는 지금까지 독립적으로 계산된 문장을
// 그냥 이어붙이기만 했다(우선순위 점수로 정렬한 뒤 상위 몇 개만 concat). 같은 입력값을 그대로
// LLM에 주고, 여러 신호를 하나의 자연스러운 문단으로 종합하게 한다 — 새 숫자는 절대 계산하지
// 않고, 이미 계산된 값만 인용한다(originalContentInsight.ts와 동일한 안전 패턴,
// llmSynthesis.ts의 공용 가드레일 재사용).
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

// 사용자 지시(2026-08-26): "채널별 인사이트 안에서 어떤건 %까지 표시하고 어떤건 숫자만
// 표시 — skyUHD 제외 모든 채널은 소수점 아래 3자리까지만". 원인은 이 함수가 시청률 원본
// 값(소수점 5자리, DB round(...,5) 그대로)을 그대로 OpenAI에 넘겨 LLM이 몇 자리를 쓸지,
// %를 붙일지 매번 제멋대로 정했기 때문 — 화면 표시 전용 자리수 규칙(Dashboard.tsx의
// formatRating과 동일하게 3자리)을 프롬프트에 맡기지 않고 여기서 미리 반올림해 원천적으로
// LLM이 볼 수 있는 자릿수 자체를 제한한다(skyUHD는 이 LLM 경로를 안 타므로 예외 처리 불필요).
function round3(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 1000;
}

export interface ChannelNarrativeLlmInput {
  channelName: string;
  // 사용자 지시(2026-08-25): ENA는 이 문장이 있으면 항상 맨 앞에, 원문 그대로 — LLM이 다시
  // 쓰지 않고 그 뒤에 자연스럽게 이어붙이게 한다(이미 확정된 서술이라 손대면 안 됨).
  leadSentence: string | null;
  today_rating: number | null;
  baseline_avg_rating: number | null; // 최근 4주 평균
  rating_delta_pct: number | null;
  priorWeekRating: number | null;
  priorWeek2Rating: number | null;
  today_rank: number | null;
  baseline_avg_rank: number | null;
  dow_baseline_avg_rating: number | null; // 오늘과 같은 요일의 baseline 평균
  today_peak_hour: number | null;
  today_peak_rating: number | null;
  today_peak_program_name: string | null;
  baseline_peak_hour: number | null;
  top_program_name: string | null;
  top_program_rating: number | null;
  top_program_start_time: string | null;
  top_program_baseline_avg: number | null; // 같은 요일·시간대 최근 8주 평균
  top_program_baseline_days: number | null;
  decline_program_name: string | null;
  decline_program_rating: number | null;
  decline_program_start_time: string | null;
  decline_program_baseline_avg: number | null;
  decline_program_delta_pct: number | null;
  demographics: { label: string; today: number | null; delta_pct: number | null }[] | null;
  household: {
    today_top_program: string | null;
    today_top_rating: number | null;
    today_top_share: number | null;
    baseline_avg_rating: number | null;
    baseline_days: number | null;
  } | null;
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 '채널별 인사이트' 작성기다.",
    "아래 JSON에 담긴 여러 신호(오늘 시청률 등락, 순위, 전주/전전주 추세, 요일 패턴, 1위 프로그램, 부진 프로그램, 피크 시간대, 유료가구 기여, 연령대 변화)를 하나의 자연스러운 한국어 문단(3~6문장)으로 종합해라.",
    "배치 순서: PD·임원진이 바로 이해할 총평(시청률 등락/순위/요일패턴/주간추세/1위 프로그램)을 앞에, 전문 데이터(연령대 이동/피크 시간대/유료가구 기여)를 뒤에 둔다.",
    "leadSentence 필드가 있으면 그 문장은 절대 다시 쓰지 말고 그대로 맨 앞에 두고, 그 뒤에 자연스럽게 이어지도록 작성해라(leadSentence가 null이면 그냥 총평부터 시작).",
    "값이 null이거나 변화폭이 미미한 지표는 굳이 언급하지 마라 — 뚜렷한 신호만 골라 서술해라(대략 15% 안팎 이상 변화, 3위 이상 순위 변동 정도를 뚜렷한 신호로 본다).",
    "여러 신호가 동시에 나타났다면(예: 연령대 하락과 시간대 약세가 겹침) 그 동시성을 짚어도 되지만, 인과관계로 단정하지 마라.",
    "숫자 표기 규칙(중요) — 시청률(rating) 값(today_rating/baseline_avg_rating/dow_baseline_avg_rating/today_peak_rating/top_program_rating/top_program_baseline_avg/decline_program_rating/decline_program_baseline_avg/priorWeekRating/priorWeek2Rating/household의 rating류/demographics[].today)은 이미 소수점 3자리로 반올림되어 있다 — 그 자리수 그대로만 쓰고(예: 0.147), 뒤에 '%'를 붙이지 마라. 반면 등락률(rating_delta_pct/decline_program_delta_pct/demographics[].delta_pct)은 원래 퍼센트 값이므로 그대로 '%'를 붙여 써라(예: ▲ 12.3%). 이 둘을 섞어 쓰지 마라.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { narrative: { type: "string" } },
  required: ["narrative"],
  additionalProperties: false,
};

export async function buildChannelNarrativeViaLlm(input: ChannelNarrativeLlmInput): Promise<string | null> {
  const rounded: ChannelNarrativeLlmInput = {
    ...input,
    today_rating: round3(input.today_rating),
    baseline_avg_rating: round3(input.baseline_avg_rating),
    priorWeekRating: round3(input.priorWeekRating),
    priorWeek2Rating: round3(input.priorWeek2Rating),
    dow_baseline_avg_rating: round3(input.dow_baseline_avg_rating),
    today_peak_rating: round3(input.today_peak_rating),
    top_program_rating: round3(input.top_program_rating),
    top_program_baseline_avg: round3(input.top_program_baseline_avg),
    decline_program_rating: round3(input.decline_program_rating),
    decline_program_baseline_avg: round3(input.decline_program_baseline_avg),
    demographics: input.demographics?.map((d) => ({ ...d, today: round3(d.today) })) ?? null,
    household: input.household
      ? { ...input.household, today_top_rating: round3(input.household.today_top_rating), baseline_avg_rating: round3(input.household.baseline_avg_rating) }
      : null,
  };
  const result = await callOpenAiJsonSynthesis<{ narrative: string }>(buildSystemPrompt(), rounded, "channel_narrative", SCHEMA);
  const narrative = result?.narrative?.trim();
  return narrative && narrative.length > 0 ? narrative : null;
}
