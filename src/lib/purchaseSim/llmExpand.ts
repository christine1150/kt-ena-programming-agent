// 구매 시뮬레이터 — 영문·음차 검색어(예: "radio star")를 한글 검색어 후보로 바꾸는 LLM 보조.
// 이 결과는 "검색용 문자열"일 뿐이며 식별을 확정하지 않는다: 호출부(resolveProgramIdentity)가 반드시 DB 후보로
// 다시 검증하고 감점(×0.92)한다. DB에 없는 프로그램은 만들어지지 않고, 별칭으로 자동 등록되지도 않는다.
const OPENAI_MODEL = "gpt-4o-mini";

export async function expandQueryWithLlm(query: string): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !query.trim()) return [];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            '사용자가 입력한 한국 TV 프로그램 이름 검색어가 영문이거나 한글 발음을 영문으로 옮긴 것일 수 있다. 한글 정식 제목으로 보이는 검색어 후보를 최대 3개, JSON {"candidates":["..."]} 형태로만 답하라. 확실하지 않으면 빈 배열. 시청률 등 숫자는 절대 말하지 말 것.',
        },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  try {
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as { candidates?: unknown };
    return Array.isArray(parsed.candidates) ? parsed.candidates.filter((c): c is string => typeof c === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}
