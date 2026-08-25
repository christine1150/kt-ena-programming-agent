// 공용 OpenAI 서술 생성 헬퍼 — Tier 1 확장(2026-08-26, 사용자 지시: "Tier 1(규칙을 안 어겨도
// 되는 확장) 모두 적용"). src/lib/originalContentInsight.ts에서 이미 검증된 안전한 패턴
// (호출부가 이미 계산·검증된 값만 JSON으로 주고, LLM은 그 값만 인용해 문장을 조립할 뿐 새
// 숫자를 계산하지 않는다 — CLAUDE.md "LLM은 Interpreter, DB가 Source of Truth" 원칙)을 여러
// 섹션에 공통으로 적용하기 위해 호출 로직만 뽑았다. 이 함수는 프롬프트 내용을 모르고, 호출부가
// system prompt·input·JSON Schema를 그대로 준다 — 섹션마다 다른 톤/규칙은 각 호출부 파일에
// 남아있고, 여기는 fetch·에러 처리·타임아웃만 공통화한다.
//
// 안전 장치(모든 호출에 공통 적용):
// - API 키가 없으면 즉시 null(호출부가 기존 규칙 기반 문구로 조용히 대체).
// - 타임아웃(기본 8초)·네트워크 오류·JSON 파싱 실패 전부 null로 수렴 — 절대 throw하지 않는다
//   (LLM 장애가 페이지 전체를 막지 않는다는 llmClassifier.ts와 동일한 원칙).
// - response_format: json_schema(strict)로 항상 구조화된 응답만 받는다(마크다운 섞임 방지).
const OPENAI_MODEL = "gpt-4o-mini";

export async function callOpenAiJsonSynthesis<T>(
  systemPrompt: string,
  input: unknown,
  schemaName: string,
  schema: Record<string, unknown>,
  opts?: { temperature?: number; timeoutMs?: number }
): Promise<T | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 8000);

  let content: string | undefined;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: opts?.temperature ?? 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    content = data?.choices?.[0]?.message?.content;
  } catch {
    return null; // 네트워크 오류·타임아웃 등 — 호출부가 기존 규칙 기반 문구로 대체
  } finally {
    clearTimeout(timeoutId);
  }
  if (!content) return null;

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

// 모든 서술 생성 프롬프트에 공통으로 붙이는 절대 규칙 — 섹션마다 System Prompt 맨 끝에
// 이어 붙여 사용한다(CLAUDE.md No Hallucination / No Unsupported Causality 원칙을 프롬프트
// 레벨에서 강제).
export const LLM_SYNTHESIS_GUARDRAIL = [
  "절대 규칙:",
  "- 아래 JSON으로 주어진 값 외의 숫자를 스스로 계산하거나 추정하지 마라. 준 값을 그대로 인용만 해라.",
  "- 원인을 단정하지 마라(예: 'A 때문에 B가 하락했다' 금지). '동시에 관찰됨/~로 보임/~일 가능성' 같은 헤지 표현을 써라.",
  "- 상식적인 일반론(예: '중장년층 시청이 높은 것은 일반적 패턴')은 쓰지 마라 — 주어진 데이터에 실제로 나타난 것만 서술해라.",
  "- 의미 있게 종합할 신호가 부족하면 억지로 만들지 말고 지정된 필드를 빈 문자열로 반환해라.",
  "- 한국어로, 방송 편성 전문가 톤으로 작성해라.",
].join("\n");
