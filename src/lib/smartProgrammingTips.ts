// Tier 3(2026-08-26, 사용자 지시: "티어3에서 11번까지는 우선 진행" — 원 제안 11번 "AI 가설"
// 별도 섹션, 화면 제목은 사용자 지시대로 "AI 편성 비서 - 스마트 편성 팁"). 지금까지 모든 서술
// 생성(askAnswerLlm.ts 등)은 "원인을 절대 단정하지 않는다"는 규칙을 엄격히 지켰다 — 여기서는
// 그 엄격함은 Evidence 섹션(WHY?/OPPORTUNITY? 등)에 그대로 남겨두고, 이 섹션만 명확히
// "AI 추정 · 검증 안 됨"이라고 라벨을 붙인 뒤 그 안에서는 조금 더 대담하게("이게 원인일
// 가능성이 높습니다") 브레인스토밍하게 한다. 다만 완전히 무제한은 아니다 — 아래 제공된 값
// 밖의 숫자·사실은 여전히 만들 수 없다(No Hallucination은 그대로, 헤지 강도만 낮춘다).
import { callOpenAiJsonSynthesis } from "./llmSynthesis";

export interface SmartTipsInput {
  channelName: string;
  rootCauseTriggered: boolean;
  rootCauseStreakDays: number | null;
  rootCauseCompetitorMoves: { competitor_name: string; change_pct: number }[];
  opportunityTriggered: boolean;
  opportunityChangePct: number | null;
  weakCompetitors: { competitor_name: string; change_pct: number }[];
  daypartOpportunities: { daypart: string; gap_full: number | null; gap_recent: number | null; gap_change: number | null }[];
  topPrograms: { program_name: string; avg_rating: number | null }[];
  periodProgramMovers: { canonical_name: string; rating_delta: number | null }[];
}

export interface SmartTip {
  headline: string; // 한 줄 요약(가설)
  rationale: string; // 왜 그렇게 추정하는지 1~2문장
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 돕는 'AI 편성 비서 - 스마트 편성 팁' 코너를 작성하는 AI다.",
    "이 코너는 다른 섹션(WHY?/OPPORTUNITY? 등 Evidence 섹션)과 분리된 '검증 안 된 AI 추정' 전용 공간이다 — 화면에 이미 'AI 추정 · 검증 안 됨' 라벨이 붙어 있으므로, 여기서는 평소보다 조금 더 과감하게 가설을 제시해도 된다(예: '~때문일 가능성이 높습니다', '~로 추정됩니다').",
    "단, 아래 JSON으로 주어진 숫자·사실 밖의 새로운 숫자나 사건을 지어내지는 마라 — 주어진 값을 근거로 한 '해석/가설'까지만 대담해도 된다는 뜻이다.",
    "결과는 2~4개의 짧은 편성 팁으로, 각각 headline(한 줄 가설)과 rationale(그렇게 보는 근거 1~2문장)로 구성해라.",
    "의미 있게 종합할 신호가 아예 없으면(모든 입력이 비어있거나 트리거가 하나도 없으면) tips를 빈 배열로 반환해라 — 억지로 만들지 마라.",
    "한국어, 방송 편성 전문가 톤으로 작성해라.",
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    tips: {
      type: "array",
      items: {
        type: "object",
        properties: { headline: { type: "string" }, rationale: { type: "string" } },
        required: ["headline", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["tips"],
  additionalProperties: false,
};

export async function generateSmartProgrammingTips(input: SmartTipsInput): Promise<SmartTip[] | null> {
  const result = await callOpenAiJsonSynthesis<{ tips: SmartTip[] }>(buildSystemPrompt(), input, "smart_programming_tips", SCHEMA, { temperature: 0.5 });
  if (!result) return null;
  const tips = (result.tips ?? []).filter((t) => t.headline?.trim() && t.rationale?.trim()).slice(0, 4);
  return tips;
}
