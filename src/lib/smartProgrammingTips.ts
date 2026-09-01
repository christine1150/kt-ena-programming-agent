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
  // 사용자 지시(2026-09-01): "이 코너는 선택한 기간에 대한 분석을 바탕으로 앞으로의 편성
  // 방향성을 이야기해주어야 하는데, 선택한 기간이 연동되지 않는다면 의미가 없어" — 아래 신호들
  // 자체는 이미 선택 기간 기준으로 조회된 값이지만, AI가 "이게 무슨 기간 얘기인지"를 몰라
  // 문장이 기간과 무관하게 써지고 있었다. 명시적으로 라벨을 주고 프롬프트에서 참조하게 한다.
  periodLabel: string;
  rootCauseTriggered: boolean;
  rootCauseStreakDays: number | null;
  rootCauseCompetitorMoves: { competitor_name: string; change_pct: number }[];
  opportunityTriggered: boolean;
  opportunityChangePct: number | null;
  weakCompetitors: { competitor_name: string; change_pct: number }[];
  daypartOpportunities: { daypart: string; gap_full: number | null; gap_recent: number | null; gap_change: number | null }[];
  // 사용자 지시(2026-08-26, 재지시): "정확한 시간대를 짚어서 — 저녁 22시대라던가 23시대,
  // <특정프로그램>을 <***>으로 바꾸자 같은" — 4단계 daypart(새벽/오전/오후/저녁_심야)만으론
  // "몇 시대"를 못 짚는다. 3시간 단위 8구간(hourBlockLabel, 예: "20~23시") 격차와, 프로그램별
  // 실제 주 방영 시각(most_common_start_hour)을 함께 줘서 "몇 시대 · 어떤 프로그램" 형태로
  // 구체화할 수 있게 한다(둘 다 이미 화면에 표시 중인 값, 새 계산 없음).
  hourBlockOpportunities: { hourBlockLabel: string; our_recent_avg: number | null; gap_recent: number | null; gap_change: number | null }[];
  topPrograms: { program_name: string; avg_rating: number | null; most_common_start_hour: number | null }[];
  periodProgramMovers: { canonical_name: string; rating_delta: number | null }[];
  // WHAT TO SCHEDULE?가 이미 SQL로 판정해 둔 태그(STRENGTHEN/TEST/MOVE/REPLACE만, KEEP은
  // 노이즈라 제외) — "A를 B로 교체" 같은 구체적 제안은 반드시 이 목록 안의 프로그램명만
  // 인용해야 한다(새 후보를 지어내지 않도록).
  fitScoreCandidates: { program_name: string; tag: string; fit_score: number | null; current_daypart: string | null }[];
}

export interface SmartTip {
  headline: string; // 한 줄 요약(가설)
  rationale: string; // 왜 그렇게 추정하는지 1~2문장
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 돕는 'AI 편성 비서 - 스마트 편성 팁' 코너를 작성하는 AI다.",
    "아래 모든 신호(daypartOpportunities/hourBlockOpportunities/topPrograms/periodProgramMovers 등)는 정확히 periodLabel에 적힌 기간을 기준으로 조회된 값이다 — headline·rationale을 쓸 때 이 기간을 명시적으로 언급해라(예: periodLabel이 '전월 대비 이번달 (2026-08-01 ~ 2026-08-31)'이면 '이번 달' 또는 그 날짜 범위를 언급하고, '오늘'이라고 임의로 바꿔 말하지 마라). periodLabel이 '오늘(...)'이면 '오늘'이라고 불러도 된다.",
    "이 코너는 다른 섹션(WHY?/OPPORTUNITY? 등 Evidence 섹션)과 분리된 '검증 안 된 AI 추정' 전용 공간이다 — 화면에 이미 'AI 추정 · 검증 안 됨' 라벨이 붙어 있으므로, 여기서는 평소보다 조금 더 과감하게 가설을 제시해도 된다(예: '~때문일 가능성이 높습니다', '~로 추정됩니다').",
    "단, 아래 JSON으로 주어진 숫자·사실 밖의 새로운 숫자나 사건을 지어내지는 마라 — 주어진 값을 근거로 한 '해석/가설'까지만 대담해도 된다는 뜻이다.",
    "가장 중요한 규칙 — 반드시 구체적으로 짚어라: '새벽 시간대가 약하다' 식의 두루뭉술한 문장 금지. daypartOpportunities의 '새벽/오전/오후/저녁_심야' 같은 큰 구분 명칭은 headline에 쓰지 마라 — 반드시 hourBlockOpportunities에 있는 정확한 시간대 라벨(예: '20~23시')과, topPrograms의 most_common_start_hour(그 프로그램이 실제 주로 방영되는 시각)를 근거로 시간을 짚고, program_name(실제 프로그램명)을 함께 명시해라(예: '20~23시대 OO 강화' — '저녁 시간대 강화' 아님).",
    "'A 프로그램을 B로 교체/투입하자' 같은 구체적 편성 제안을 할 때는, 교체 대상(A)은 topPrograms/periodProgramMovers에서, 대체 후보(B)는 fitScoreCandidates(STRENGTHEN/TEST 태그)에서만 골라라 — 목록에 없는 프로그램명을 새로 지어내지 마라. fitScoreCandidates가 비어있으면 교체 후보를 특정하지 말고 시간대·현상 진단까지만 말해라.",
    "결과는 2~4개의 짧은 편성 팁으로, 각각 headline(시간대·프로그램명이 들어간 한 줄 가설)과 rationale(그렇게 보는 근거 1~2문장)로 구성해라.",
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
