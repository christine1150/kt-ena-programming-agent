// 자연어 질문 API(18번). USER QUESTION → TIME RESOLVER → PARAMETER EXTRACTOR → INTENT REGISTRY →
// METRIC/RULE ENGINE(기존 get_* SQL 함수) → EVIDENCE → RESPONSE TEMPLATE.
// 1차는 규칙 기반 라우터(intentRouter.ts)로 처리하고, 그게 못 잡아내면(오타·낯선 어순 등)
// OpenAI 기반 분류기(llmClassifier.ts, 사용자 지시 2026-08-20 "openai api key를 활용")로
// 한 번 더 시도한다 — 어느 경로든 Intent/Parameter까지만 다르고, 그 뒤(SQL 실행·Evidence
// 조립)는 완전히 동일한 코드를 탄다(CLAUDE.md "LLM이 계산을 직접 하지 않는다" 원칙).
// 관리자/PD 둘 다 사용 가능(고정 공유 링크 세션 포함, CLAUDE.md 접근 제어 원칙).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { routeQuestion } from "@/lib/intent/intentRouter";
import { classifyQuestionWithLlm } from "@/lib/intent/llmClassifier";
import { getLatestAvailableDate } from "@/lib/intent/referenceData";
import { enhanceAskAnswerViaLlm } from "@/lib/askAnswerLlm";
import { dispatchIntent } from "@/lib/intent/dispatch";
import { buildUnsupportedAnswer } from "@/lib/intent/responseTemplates";
import { answerViaFunctionCalling } from "@/lib/intent/functionCallEngine";
import type { AskHistoryTurn } from "@/lib/intent/types";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  let question: string;
  let history: AskHistoryTurn[] = [];
  try {
    const body = await request.json();
    question = typeof body?.question === "string" ? body.question.trim() : "";
    // Tier 2 확장(2026-08-26, 원 제안 7번 "멀티턴 대화 맥락") — 프론트가 보내는 직전 대화
    // 이력(최대 몇 턴, 질문+그때 풀린 intent/파라미터만). 형식이 이상하면 조용히 빈 배열로
    // 처리한다(임의 추정 없이 그냥 컨텍스트 없이 이번 질문만 단독으로 판단).
    if (Array.isArray(body?.history)) {
      history = body.history
        .filter((t: unknown): t is Record<string, unknown> => typeof t === "object" && t !== null && typeof (t as Record<string, unknown>).question === "string")
        .map((t: Record<string, unknown>) => ({
          question: t.question as string,
          intentId: typeof t.intentId === "string" ? t.intentId : null,
          channelCode: typeof t.channelCode === "string" ? t.channelCode : null,
          targetLabel: typeof t.targetLabel === "string" ? t.targetLabel : null,
          competitorName: typeof t.competitorName === "string" ? t.competitorName : null,
        }));
    }
  } catch {
    return NextResponse.json({ ok: false, message: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ ok: false, message: "질문을 입력해 주세요." }, { status: 400 });
  }

  const referenceDate = (await getLatestAvailableDate()) ?? new Date().toISOString().slice(0, 10);

  let routed = await routeQuestion(question, referenceDate);
  let usedLlmFallback = false;
  // 사용자 지시(2026-08-25, 감사 후속): CLAUDE.md가 "Rule-based Engine Fallback 구조...
  // USE_ADVANCED_LLM_AGENT 환경변수로 제어"라고 문서화했지만 실제로 이 변수를 읽는 코드가
  // 없었다(문서-코드 불일치, 감사에서 확인됨) — 실제 동작하는 토글로 만든다. 기본값은 true
  // (기존 동작 그대로 유지, 명시적으로 "false"를 줘야만 OpenAI 폴백을 끈다).
  const advancedLlmAgentEnabled = process.env.USE_ADVANCED_LLM_AGENT !== "false";
  if (!routed.ok && advancedLlmAgentEnabled) {
    // 규칙 기반이 못 잡으면(오타·낯선 어순·규칙에 없는 동의어 등) OpenAI로 한 번 더 시도한다.
    // API 키가 없거나 호출이 실패하면 null이 돌아와 원래 미지원 결과를 그대로 쓴다.
    const llmRouted = await classifyQuestionWithLlm(question, referenceDate, history);
    if (llmRouted) {
      routed = llmRouted;
      usedLlmFallback = true;
    }
  }

  // Tier 2 확장(2026-08-26, 사용자 지시: "티어 2 진행" — 원 제안 6번 "자유형 질문 엔진") —
  // 고정 9개 Intent(규칙 기반+분류기 둘 다) 어디에도 안 맞으면, 마지막으로 OpenAI Function
  // Calling에게 같은 9개 승인된 함수 중 필요한 걸(복수 가능) 직접 고르게 한다. LLM은 여전히
  // SQL을 짜지 않고 "어떤 승인된 분석을 부를지"만 고르며, 각 함수의 실행·Evidence 조립은
  // dispatchIntent(위 두 경로와 완전히 동일한 코드)를 그대로 탄다 — 무엇을 물어도 숫자는
  // 항상 SQL이 계산한 값이다.
  if (!routed.ok && advancedLlmAgentEnabled) {
    const freeform = await answerViaFunctionCalling(question, referenceDate, history);
    if (freeform) {
      return NextResponse.json({
        ok: true,
        intent_id: freeform.answer.intent_id,
        macro_intent: freeform.answer.macro_intent,
        parameters: { channelCode: freeform.channelCode, targetLabel: freeform.targetLabel, competitorName: freeform.competitorName },
        timeContext: null,
        usedLlmFallback: true,
        usedFunctionCalling: true,
        answer: freeform.answer,
      });
    }
  }

  if (!routed.ok) {
    const answer = buildUnsupportedAnswer(routed.missing);
    return NextResponse.json({ ok: true, intent_id: null, answer });
  }

  const answer = await dispatchIntent(routed, question);

  // Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — conclusion/
  // keyNumbers/comparisonBasis/evidence(전부 SQL이 계산한 값)는 그대로 두고, interpretation·
  // programmingAction 2개만 사용자의 실제 질문 맥락에 맞게 OpenAI가 다시 쓴다. 실패하면 기존
  // 템플릿 문구 그대로(answer 원본 유지) — USE_ADVANCED_LLM_AGENT=false면 아예 시도하지 않는다.
  let finalAnswer = answer;
  if (advancedLlmAgentEnabled) {
    const enhanced = await enhanceAskAnswerViaLlm({
      question,
      conclusion: answer.conclusion,
      keyNumbers: answer.keyNumbers,
      comparisonBasis: answer.comparisonBasis,
      evidence: answer.evidence,
      confidenceNote: answer.confidenceNote,
    });
    if (enhanced) {
      finalAnswer = { ...answer, interpretation: enhanced.interpretation, programmingAction: enhanced.programmingAction };
    }
  }

  return NextResponse.json({
    ok: true,
    intent_id: routed.intent_id,
    macro_intent: routed.macro_intent,
    parameters: routed.parameters,
    timeContext: routed.timeContext,
    usedLlmFallback,
    answer: finalAnswer,
  });
}
