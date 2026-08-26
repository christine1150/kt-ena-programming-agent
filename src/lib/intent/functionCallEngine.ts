// Tier 2 확장(2026-08-26, 사용자 지시: "티어 2 진행" — 원 제안 6번 "자연어 질문 엔진을 진짜
// 자유형으로"). 지금까지의 두 경로(규칙 기반 라우터 intentRouter.ts / 9-Intent 고정 분류기
// llmClassifier.ts)는 둘 다 "질문 하나 → Intent 하나"만 고른다 — "이 프로그램은 콘텐츠
// 문제야 시간대 문제야?" 처럼 여러 각도를 동시에 봐야 답이 되는 질문은 어느 경로에도 안
// 걸린다. 원 설계 의도(USER → LLM → 승인된 SQL 함수들 → DB → OpenAI 해석)대로, OpenAI
// Function Calling에게 INTENT_REGISTRY의 9개 승인된 분석 함수 중 필요한 걸(복수 가능) 직접
// 고르게 한다 — LLM은 여전히 "어떤 승인된 분석을 부를지"만 고르고 SQL은 한 줄도 안 짠다.
// 각 함수의 실행·Evidence 조립은 dispatchIntent(규칙 기반/9-Intent 분류기와 완전히 같은
// 코드)를 그대로 타므로, 결과 숫자는 항상 SQL이 계산한 값이다(CLAUDE.md "No Arbitrary SQL"
// 원칙 그대로 — LLM이 "무엇을 조회할지"를 고르는 것과 "SQL을 직접 짜는 것"은 다르다).
//
// route.ts에서 규칙 기반 라우터 + 9-Intent 분류기가 둘 다 실패했을 때만 마지막으로 시도된다
// (기존 두 경로를 대체하지 않고 덧붙이는 3번째 폴백 — Delta-Only).
import { INTENT_REGISTRY } from "./intentRegistry";
import { getChannelRefs, getCompetitorRefs, getTargetLabels } from "./referenceData";
import { resolveTimePeriod } from "./timeResolver";
import { extractParameters } from "./parameterExtractor";
import { dispatchIntent } from "./dispatch";
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "@/lib/llmSynthesis";
import type { AskHistoryTurn, EvidenceAnswer, ExtractedParameters, MacroIntentId, RouteResult } from "./types";

const OPENAI_MODEL = "gpt-4o-mini";
const MAX_TOOL_CALLS = 3; // 비용/지연 상한 — 한 질문에 승인된 분석을 최대 3개까지만 동시 호출.

interface ToolCallArgs {
  channel_code: string | null;
  target_label: string | null;
  competitor_name: string | null;
  ranking_limit: number | null;
  ranking_direction: "top" | "bottom" | null;
  time_phrase: string | null;
}

function buildToolSchema(channelCodes: string[], competitorNames: string[], targetLabels: string[]) {
  return INTENT_REGISTRY.map((intent) => ({
    type: "function" as const,
    function: {
      name: intent.intent_id,
      description: `${intent.description}(${intent.examples[0]})`,
      strict: true,
      parameters: {
        type: "object",
        properties: {
          channel_code: { type: ["string", "null"], enum: [...channelCodes, null] },
          target_label: { type: ["string", "null"], enum: [...targetLabels, null] },
          competitor_name: { type: ["string", "null"], enum: [...competitorNames, null] },
          ranking_limit: { type: ["integer", "null"] },
          ranking_direction: { type: ["string", "null"], enum: ["top", "bottom", null] },
          time_phrase: { type: ["string", "null"] },
        },
        required: ["channel_code", "target_label", "competitor_name", "ranking_limit", "ranking_direction", "time_phrase"],
        additionalProperties: false,
      },
    },
  }));
}

function buildSystemPrompt(referenceDate: string): string {
  return [
    "너는 KT ENA 편성 AI Agent다. 사용자의 자유로운 편성 질문에 답하기 위해, 아래 제공된 '승인된 분석 함수' 중 필요한 것을 골라 호출해라.",
    "질문 하나에 여러 각도(예: 콘텐츠 자체 성과 + 시간대 + 경쟁채널)가 필요하면 여러 함수를 동시에 호출해도 된다(최대 3개).",
    "너는 절대 숫자를 스스로 계산하지 않는다 — 함수 호출로 필요한 데이터를 받아오기만 한다.",
    `오늘 날짜는 ${referenceDate}(KST, 데이터 존재 최신일 기준)입니다.`,
    "channel_code/target_label/competitor_name은 함수 스키마에 나열된 값만 쓰고, 확실하지 않으면 null로 해라 — 질문에 채널명이 없고 대화 이력에도 없으면 채널을 임의로 짐작해서 채우지 마라.",
    "time_phrase는 질문의 시간 표현을 원문 그대로 넣어라(날짜 계산은 네가 하지 마라).",
    "이 질문에 맞는 함수가 하나도 없으면 아무 함수도 호출하지 마라(억지로 끼워맞추지 않는다).",
    // 사용자 지시(2026-08-26, 오답 신고 후속) — llmClassifier.ts와 동일한 사고 방지 문구.
    "특정 채널을 짚어 '어느 요일/시간대를 개선해야 하는지', '추천 프로그램은?'처럼 슬롯 단위 편성 추천을 묻는 질문에 맞는 함수는 아래 목록에 없다 — 억지로 CHANNEL_DAYPART 등을 부르지 마라.",
    "질문에 특정 채널명이 명시돼 있는데 그 채널과 무관하게 7개 채널 전체를 스캔하는 함수(PORTFOLIO_RANKING/PORTFOLIO_KPI_GAP/PORTFOLIO_ALERT)를 부르는 것은 거의 항상 오답이다.",
  ].join("\n");
}

function historyToMessages(history: AskHistoryTurn[]): { role: "user" | "assistant"; content: string }[] {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of history.slice(-3)) {
    messages.push({ role: "user", content: turn.question });
    messages.push({
      role: "assistant",
      content: JSON.stringify({ intent_id: turn.intentId, channel_code: turn.channelCode, target_label: turn.targetLabel, competitor_name: turn.competitorName }),
    });
  }
  return messages;
}

interface ToolCallResult {
  name: string;
  arguments: string;
}

async function requestToolCalls(question: string, referenceDate: string, history: AskHistoryTurn[]): Promise<ToolCallResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  const [channels, competitors, targetLabels] = await Promise.all([getChannelRefs(), getCompetitorRefs(), getTargetLabels()]);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: buildSystemPrompt(referenceDate) },
          ...historyToMessages(history),
          { role: "user", content: question },
        ],
        tools: buildToolSchema(
          channels.map((c) => c.code),
          [...new Set(competitors.map((c) => c.competitorName))],
          targetLabels
        ),
        tool_choice: "auto",
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const calls = data?.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(calls)) return [];
    return calls
      .slice(0, MAX_TOOL_CALLS)
      .map((c: { function?: { name?: string; arguments?: string } }) => ({ name: c.function?.name ?? "", arguments: c.function?.arguments ?? "{}" }))
      .filter((c: ToolCallResult) => c.name);
  } catch {
    return []; // 네트워크 오류·타임아웃 — 호출부가 기존 미지원 응답으로 대체
  } finally {
    clearTimeout(timeoutId);
  }
}

const CONFIDENCE_RANK: Record<EvidenceAnswer["confidence"], number> = { HIGH: 3, MEDIUM: 2, LOW: 1, INSUFFICIENT_SAMPLE: 0 };

export interface FreeformAnswerResult {
  answer: EvidenceAnswer;
  // Tier 2 확장(2026-08-26, 원 제안 7번과의 정합성) — askHistory가 다음 턴("그럼 지난주는?")의
  // 맥락으로 쓸 수 있게, 여기서도 첫 번째로 성공한 호출의 채널/타깃 정보를 함께 돌려준다.
  channelCode: string | null;
  targetLabel: string | null;
  competitorName: string | null;
}

export async function answerViaFunctionCalling(question: string, referenceDate: string, history: AskHistoryTurn[] = []): Promise<FreeformAnswerResult | null> {
  const toolCalls = await requestToolCalls(question, referenceDate, history);
  if (toolCalls.length === 0) return null;

  const [channels, competitors, targetLabels] = await Promise.all([getChannelRefs(), getCompetitorRefs(), getTargetLabels()]);
  const channelCodes = new Set(channels.map((c) => c.code));
  const competitorNames = new Set(competitors.map((c) => c.competitorName));
  const targetLabelSet = new Set(targetLabels);

  // 방어적 검증(2026-08-26, 오답 신고 후속) — llmClassifier.ts와 동일한 대조. 질문 하나에
  // 여러 함수를 부를 수 있는 구조라 매 호출마다 확인해야 한다.
  const ruleParams = await extractParameters(question);

  const results: { intentId: string; answer: EvidenceAnswer; parameters: ExtractedParameters }[] = [];
  for (const call of toolCalls) {
    const intent = INTENT_REGISTRY.find((i) => i.intent_id === call.name);
    if (!intent) continue;
    if (ruleParams.channelCode && intent.macro_intent === "PORTFOLIO_HEALTH" && !intent.required_parameters.includes("channelCode")) {
      continue; // 채널명이 명시된 질문에 전사 스캔형 함수를 고른 오분류 — 건너뛴다
    }
    let args: ToolCallArgs;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      continue;
    }
    // 방어적 검증(2026-08-26, #7 채널 임의 추정 버그와 같은 원칙) — 스키마 enum이 이미
    // 막아주지만, 모델이 스키마 밖 값을 만들어낼 가능성에 대비해 한 번 더 실제 목록과 대조한다.
    const channelCode = args.channel_code && channelCodes.has(args.channel_code) ? args.channel_code : null;
    const targetLabel = args.target_label && targetLabelSet.has(args.target_label) ? args.target_label : null;
    const competitorName = args.competitor_name && competitorNames.has(args.competitor_name) ? args.competitor_name : null;
    const parameters: ExtractedParameters = {
      channelCode,
      channelName: channelCode ? (channels.find((c) => c.code === channelCode)?.name ?? null) : null,
      competitorName,
      targetLabel,
      targetRaw: targetLabel,
      rankingLimit: args.ranking_limit ?? null,
      rankingDirection: args.ranking_direction ?? null,
    };
    const missing = intent.required_parameters.filter((p) => parameters[p] === null);
    if (missing.length > 0) continue; // 필수 파라미터 없이는 억지로 실행하지 않는다(임의 추정 금지)

    const timeContext = resolveTimePeriod(args.time_phrase ?? "", referenceDate);
    const routed: RouteResult = { ok: true, intent_id: intent.intent_id, macro_intent: intent.macro_intent, parameters, timeContext, data_mart: intent.data_mart };
    const answer = await dispatchIntent(routed, question);
    results.push({ intentId: intent.intent_id, answer, parameters });
  }

  if (results.length === 0) return null;
  const primaryParams = results[0].parameters;
  if (results.length === 1) {
    // 단일 함수면 기존 9-Intent 경로와 동일 품질 그대로 반환.
    return { answer: results[0].answer, channelCode: primaryParams.channelCode, targetLabel: primaryParams.targetLabel, competitorName: primaryParams.competitorName };
  }

  // 2개 이상 — 각 답변은 이미 완결된 Evidence(숫자·근거 전부 SQL 계산값)이므로 그대로 이어
  // 붙이고, LLM은 "여러 각도를 종합하는 1~2문장"만 새로 쓴다(askAnswerLlm.ts와 동일 원칙:
  // 숫자는 절대 새로 안 만들고, 이미 준 conclusion/keyNumbers만 인용해 종합).
  const synthesis = await callOpenAiJsonSynthesis<{ conclusion: string; interpretation: string; programmingAction: string }>(
    [
      "너는 KT ENA 편성 AI 비서다. 아래 JSON에는 사용자의 질문과, 서로 다른 분석 함수 여러 개가 이미 계산한 결론들(answers)이 들어있다.",
      "이 여러 결론을 종합해 (1) conclusion — 전체를 아우르는 1~2문장 결론, (2) interpretation — 여러 신호가 함께 시사하는 바(2~3문장), (3) programmingAction — 편성PD가 다음에 확인할 구체적 행동 1문장을 새로 써라.",
      "answers에 없는 숫자나 사실을 새로 만들지 마라 — 이미 준 conclusion/keyNumbers/evidence만 인용·종합해라.",
      LLM_SYNTHESIS_GUARDRAIL,
    ].join("\n"),
    { question, answers: results.map((r) => ({ intent: r.intentId, conclusion: r.answer.conclusion, keyNumbers: r.answer.keyNumbers, evidence: r.answer.evidence })) },
    "freeform_multi_synthesis",
    {
      type: "object",
      properties: { conclusion: { type: "string" }, interpretation: { type: "string" }, programmingAction: { type: "string" } },
      required: ["conclusion", "interpretation", "programmingAction"],
      additionalProperties: false,
    }
  );

  const minConfidence = results.reduce((min, r) => (CONFIDENCE_RANK[r.answer.confidence] < CONFIDENCE_RANK[min] ? r.answer.confidence : min), results[0].answer.confidence);
  const followups = [...new Set(results.flatMap((r) => r.answer.followups ?? []))].slice(0, 2);

  return {
    answer: {
      intent_id: "FREEFORM_MULTI",
      macro_intent: results[0].answer.macro_intent as MacroIntentId,
      conclusion: synthesis?.conclusion?.trim() || results.map((r) => r.answer.conclusion).join(" "),
      keyNumbers: results.map((r) => `[${r.intentId}] ${r.answer.keyNumbers}`).join(" / "),
      comparisonBasis: [...new Set(results.map((r) => r.answer.comparisonBasis))].join(" · "),
      evidence: results.map((r) => `[${r.intentId}] ${r.answer.evidence}`).join(" / "),
      interpretation: synthesis?.interpretation?.trim() || "여러 분석 신호를 함께 참고하세요(개별 결과는 위 근거 참고).",
      programmingAction: synthesis?.programmingAction?.trim() || "각 항목의 세부 내용은 Page 2에서 추가로 확인하세요.",
      confidence: minConfidence,
      confidenceNote: `여러 분석(${results.map((r) => r.intentId).join(", ")})을 종합한 답변으로, 그중 가장 낮은 신뢰도를 기준으로 표시합니다.`,
      raw: results.map((r) => r.answer.raw),
      visualization: results[0].answer.visualization,
      followups: followups.length > 0 ? followups : undefined,
    },
    channelCode: primaryParams.channelCode,
    targetLabel: primaryParams.targetLabel,
    competitorName: primaryParams.competitorName,
  };
}
