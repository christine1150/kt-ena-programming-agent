// LLM 기반 자연어 → Intent/Parameter 분류(사용자 지시 2026-08-20: "18번 openai api key를 활용").
// 규칙 기반 라우터(intentRouter.ts)가 못 잡아내는 표현(오타, 낯선 어순, 규칙에 없는 동의어 등)을
// 위한 폴백 레이어일 뿐이다 — 계산은 여전히 SQL(executors.ts)이 하고, LLM은 여기서 질문을
// Intent/Parameter로 바꾸는 역할만 한다(CLAUDE.md "LLM이 계산을 직접 하지 않는다" 원칙 유지).
// 무거운 openai SDK 대신 fetch로 REST API를 직접 호출한다(gmailClient.ts와 같은 최소 구성 원칙).
// 키가 없거나 호출이 실패/애매하면 null을 돌려줘 규칙 기반 미지원 응답으로 자연스럽게 대체된다
// (LLM 장애·쿼터 초과가 서비스 전체를 막지 않는다 — LLM-independent 원칙).
import { INTENT_REGISTRY } from "./intentRegistry";
import { getChannelRefs, getCompetitorRefs, getTargetLabels } from "./referenceData";
import { resolveTimePeriod } from "./timeResolver";
import type { AskHistoryTurn, ExtractedParameters, RouteResult } from "./types";

// 사용자 지시(2026-08-20): 모델을 gpt-4o-mini로 고정 — 환경변수로 바뀌지 않도록 상수로 박아둔다.
const OPENAI_MODEL = "gpt-4o-mini";

interface LlmClassification {
  intent_id: string | null;
  channel_code: string | null;
  target_label: string | null;
  competitor_name: string | null;
  ranking_limit: number | null;
  ranking_direction: "top" | "bottom" | null;
  time_phrase: string | null;
}

function buildSystemPrompt(channelCodes: string[], competitorNames: string[], targetLabels: string[], referenceDate: string): string {
  return [
    "너는 KT ENA 편성 AI Agent의 자연어 질문 분류기다.",
    "사용자 질문을 아래 Intent 중 하나로 분류하고, 필요한 파라미터를 추출해라. 절대 숫자나 결론을 스스로 계산하지 마라 — 분류/추출만 한다.",
    // 사용자 지시(2026-08-25, 감사 후속): 원 명세 27번 "CURRENT_DATE/TIMEZONE(KST)을 System
    // Message에 항상 동적 주입" — 날짜 산수 자체는 여전히 아래 rule 대로 별도 로직(resolveTimePeriod,
    // timeResolver.ts)이 전담하지만(LLM이 날짜 계산 안 함 원칙 유지), "최근 자료가 있는 날짜 = 오늘"
    // 이라는 기준점을 LLM도 알아야 time_phrase 해석이 아닌 다른 판단(예: 미래형 질문 감지)에서
    // 헷갈리지 않는다.
    `오늘 날짜는 ${referenceDate}(KST, 데이터 존재 최신일 기준)입니다. 날짜 계산은 네가 하지 말고, time_phrase만 원문 그대로 추출해라.`,
    "",
    "## Intent 목록",
    ...INTENT_REGISTRY.map(
      (i) => `- ${i.intent_id}: ${i.description} (예: ${i.examples.join(" / ")}) [필수 파라미터: ${i.required_parameters.join(", ") || "없음"}]`
    ),
    "",
    `## 유효한 channel_code(이 목록에 없으면 null): ${channelCodes.join(", ")}`,
    `## 유효한 competitor_name(이 목록에 없으면 null): ${competitorNames.join(", ") || "(등록된 경쟁채널 없음)"}`,
    `## 유효한 target_label(이 목록에 없으면 null): ${targetLabels.join(", ")}`,
    "",
    "규칙:",
    "- 질문이 위 Intent 중 어디에도 명확히 해당하지 않으면 intent_id를 null로 해라(억지로 끼워맞추지 않는다).",
    "- channel_code/target_label/competitor_name은 반드시 위 목록에 있는 값만 쓰고, 확실하지 않으면 null로 해라. 질문에 채널명이 없고 직전 대화 이력에서도 채널을 알 수 없으면(아래 대화 이력이 아예 없거나, 있어도 그 답에 channel_code가 없었다면) channel_code는 반드시 null로 해라 — ENA 등 아무 채널이나 기본값으로 짐작해서 채우지 마라.",
    "- time_phrase는 질문에서 시간 표현을 원문 그대로 뽑아라(예: '어제', '최근 7일', '지난달', '전주 대비'). 날짜 계산은 별도 로직이 하니 절대 직접 계산하지 마라 — 표현만 그대로 추출한다.",
    "- ranking_limit/ranking_direction은 'TOP 5', '가장 잘한/부진한' 같은 표현이 있을 때만 채우고, 없으면 null.",
    // Tier 2 확장(2026-08-26, 원 제안 7번 "멀티턴 대화 맥락"): 대화 이력이 있으면(아래 user/
    // assistant 메시지로 이어짐) "그럼 지난주는?"처럼 채널·타깃을 생략한 후속 질문을 직전 턴의
    // 값으로 채워 해석하되, 이번 질문이 새 주제면 이전 값을 억지로 끌어오지 않는다.
    "- 바로 위에 이전 질문·답변(assistant 메시지는 그 질문이 어떤 intent_id/channel_code/target_label/competitor_name으로 풀렸는지를 담은 JSON)이 있다면, 이번 질문이 그 맥락을 이어받는 후속 질문인지 먼저 판단해라(예: '그럼 지난주는?', '경쟁채널은 어때?'). 후속 질문이면 이번 질문에 없는 값을 직전 턴에서 채워 넣어라. 이번 질문이 완전히 새로운 주제라면 이전 값을 가져오지 마라.",
  ].join("\n");
}

// 사용자 지시(2026-08-26): "그럼 지난주는?" 같은 후속 질문 해석용 — 결론·수치 등 답변 본문은
// 필요 없고, 직전 턴이 어떤 intent_id/파라미터로 풀렸는지만 assistant 메시지로 다시 넣어준다.
function historyToMessages(history: AskHistoryTurn[]): { role: "user" | "assistant"; content: string }[] {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of history.slice(-3)) {
    messages.push({ role: "user", content: turn.question });
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        intent_id: turn.intentId,
        channel_code: turn.channelCode,
        target_label: turn.targetLabel,
        competitor_name: turn.competitorName,
      }),
    });
  }
  return messages;
}

export async function classifyQuestionWithLlm(question: string, referenceDate: string, history: AskHistoryTurn[] = []): Promise<RouteResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const [channels, competitors, targetLabels] = await Promise.all([getChannelRefs(), getCompetitorRefs(), getTargetLabels()]);
  const channelCodes = channels.map((c) => c.code);
  const competitorNames = [...new Set(competitors.map((c) => c.competitorName))];
  const intentIds = INTENT_REGISTRY.map((i) => i.intent_id);

  let content: string | undefined;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: buildSystemPrompt(channelCodes, competitorNames, targetLabels, referenceDate) },
          ...historyToMessages(history),
          { role: "user", content: question },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "intent_classification",
            strict: true,
            schema: {
              type: "object",
              properties: {
                intent_id: { type: ["string", "null"], enum: [...intentIds, null] },
                channel_code: { type: ["string", "null"], enum: [...channelCodes, null] },
                target_label: { type: ["string", "null"], enum: [...targetLabels, null] },
                competitor_name: { type: ["string", "null"], enum: [...competitorNames, null] },
                ranking_limit: { type: ["integer", "null"] },
                ranking_direction: { type: ["string", "null"], enum: ["top", "bottom", null] },
                time_phrase: { type: ["string", "null"] },
              },
              required: ["intent_id", "channel_code", "target_label", "competitor_name", "ranking_limit", "ranking_direction", "time_phrase"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    content = data?.choices?.[0]?.message?.content;
  } catch {
    return null; // 네트워크 오류 등 — 규칙 기반 미지원 응답으로 자연스럽게 대체
  }
  if (!content) return null;

  let parsed: LlmClassification;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed.intent_id) return null;

  const intent = INTENT_REGISTRY.find((i) => i.intent_id === parsed.intent_id);
  if (!intent) return null;

  const timeContext = resolveTimePeriod(parsed.time_phrase ?? "", referenceDate);
  const parameters: ExtractedParameters = {
    channelCode: parsed.channel_code,
    channelName: parsed.channel_code ? (channels.find((c) => c.code === parsed.channel_code)?.name ?? null) : null,
    competitorName: parsed.competitor_name,
    targetLabel: parsed.target_label,
    targetRaw: parsed.target_label,
    rankingLimit: parsed.ranking_limit,
    rankingDirection: parsed.ranking_direction,
  };

  const missing = intent.required_parameters.filter((p) => parameters[p] === null);
  if (missing.length > 0) return null; // 부족하면 규칙 기반과 동일하게 상위에서 미지원 처리

  return {
    ok: true,
    intent_id: intent.intent_id,
    macro_intent: intent.macro_intent,
    parameters,
    timeContext,
    data_mart: intent.data_mart,
  };
}
