// 사용자 지시(2026-08-25): Page 1 "주요 컨텐츠 리뷰"의 [편성 인사이트]가 지금까지는 "본채널
// 직재방으로 인한 타 채널 카니발라이제이션 가능성" 단 하나의 규칙만 판정해왔는데(조건 충족 시만
// 표시), 사용자가 첨부한 PD 수기 리포트 6건(나는솔로/짐쌀라비움/신병4사보타주/그대에게드림)의
// "[N회_이슈] 전회 대비 타깃 및 가구시청률/점유율/도달율 동시 언급 → 목표 대비 누적 X% 달성"
// 같은 여러 신호를 한 문단으로 종합하는 분석 톤을 배워서, 카니발라이제이션은 "가급적 적게"만
// 언급하고 그 대신 이미 검증된(SQL이 계산한) 데이터로 더 폭넓은 패턴을 짚어달라는 요청 —
// "필요시 Open AI 사용"을 명시적으로 허가받아 이 파일에서 구현한다.
//
// CLAUDE.md 원칙 준수: LLM은 여기 넘겨준 필드(전부 이미 SQL/route.ts가 계산·검증한 값)만
// 그대로 인용해 문장을 조립할 뿐, 숫자를 스스로 계산하거나 새로 만들지 않는다(프롬프트에
// "절대 숫자를 새로 계산하지 마라, 아래 준 값만 인용해라" 명시). API 키가 없거나 호출이
// 실패하면 null을 돌려주고, 호출부(page1/route.ts)가 기존 규칙 기반 카니발라이제이션 문구로
// 조용히 대체한다(LLM 장애가 서비스를 막지 않는다는 llmClassifier.ts와 동일한 원칙).
import { enforceDecimalPrecision } from "./ratingRounding";

const OPENAI_MODEL = "gpt-4o-mini";

export interface OriginalInsightInput {
  programName: string;
  episodeNumber: number | null;
  broadcastChannelName: string;
  // 사용자 지시(2026-09-02): 출력 문장의 소숫점 자리수 안전망(enforceDecimalPrecision)이
  // skyUHD인지 정확히 알아야 5자리를 3자리로 잘못 잘라내지 않는다 — 표시명 문자열 비교보다
  // 명시적 코드가 안전하다.
  channelCode: string;
  matchedRating: number | null;
  priorRatingChangePct: number | null;
  matchedHouseholdRating: number | null;
  householdRatingChangePct: number | null;
  achievementPct: number | null;
  matchedReach: number | null;
  targetRank: number | null;
  householdRank: number | null;
  beatenBy: { competitor_name: string; competitor_program_name: string; competitor_rating: number | null }[];
  preRerunRating: number | null;
  selfRerunRating: number | null;
  selfRerunUpliftPct: number | null; // (self_rerun / matched - 1) * 100, 이미 계산된 값
  rerunChannelName: string | null;
  rerunRating: number | null;
  retentionPct: number | null;
  ageBreakdownTop3: { label: string; rating: number }[] | null;
  prevDramaName: string | null;
  prevDramaChangePct: number | null;
  // 카니발라이제이션 규칙 판정 결과(기존 로직 그대로) — "가급적 적게 언급"이므로 힌트로만 준다.
  cannibalizationSuspected: boolean;
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 시청률 분석 코멘트 작성기다.",
    "사용자가 실제로 작성한 PD 리포트 톤(예: '전회 대비 타깃 및 가구시청률, 점유율 증가 반면 도달율 소폭 감소, 동시간대 타깃 7위 및 가구 11위(모두 상승)')을 참고해, 데이터 기반의 명확하고 객관적인 방송 편성 전문가 톤으로 1~2문장의 편성 인사이트를 작성해라.",
    "절대 규칙: 아래 JSON으로 주어진 값 외의 숫자를 스스로 계산하거나 추정하지 마라. 준 값을 그대로 인용만 해라. 원인을 단정하지 말고(예: 'A 때문에 B가 하락했다' 금지) '동시에 관찰됨/~로 보임/~일 가능성' 같은 헤지 표현을 써라.",
    "본방·리드인·직후재방·목표 달성률 각각의 원 수치는 이미 화면 다른 곳(핵심 요약 4개 불렛)에 나와 있으니 그대로 반복하지 말고, 그 신호들을 엮은 '패턴 해석'과 '편성 시사점'에 집중해라(예: 가구 대비 타깃 성과 괴리, 경쟁 구도 속 상대적 위치, 연령대 구성이 시사하는 것, 리드인/재방 흐름이 시사하는 것 등 — 실제로 데이터에 나타난 패턴만).",
    "카니발라이제이션(같은 채널의 자체 재방이 타 채널 재방 유입을 잠식하는 것)은 데이터가 뚜렷이 그 패턴을 보일 때만 아주 짧게라도 언급 가능하되, 그것이 유일한 소재가 되지 않게 하고 가능하면 다른 신호를 우선해라 — cannibalizationSuspected가 false면 언급하지 마라.",
    "출력은 반드시 JSON 스키마를 따르고, insight가 빈 문자열이면 '의미 있게 종합할 신호가 부족하다'는 뜻이다 — 억지로 만들지 마라.",
  ].join("\n");
}

export async function buildOriginalProgrammingInsightViaLlm(input: OriginalInsightInput): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let content: string | undefined;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: JSON.stringify(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "original_content_insight",
            strict: true,
            schema: {
              type: "object",
              properties: { insight: { type: "string" } },
              required: ["insight"],
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
    return null; // 네트워크 오류 등 — 호출부가 기존 규칙 기반 문구로 대체
  }
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as { insight?: string };
    const insight = parsed.insight?.trim();
    if (!insight || insight.length === 0) return null;
    // 사용자 지시(2026-09-02): 입력값을 반올림해 넘겨도 LLM이 실수로 다른 정밀도를 쓸 가능성
    // 자체를 막는 마지막 방어선(강력한 규칙 적용) — skyUHD만 5자리, 그 외는 3자리.
    return enforceDecimalPrecision(insight, input.channelCode === "SKYUHD" ? 5 : 3);
  } catch {
    return null;
  }
}
