// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2
// "오늘의 브리핑"(ChannelDeepDive.tsx buildBriefingReport, 단일 일자 모드)도 채널별 인사이트와
// 같은 문제 — 개별 계산된 문장을 그냥 이어붙인다. 같은 입력값을 그대로 LLM에 주고 한 문단으로
// 종합한다(새 숫자 계산 없음). 기간(범위) 조회 모드는 대상에서 뺐다 — 그쪽은 baseline 개념이
// 완전히 달라 별도 설계가 필요해 이번 Tier 1 범위에서는 규칙 기반을 그대로 둔다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface BriefingLlmInput {
  channelName: string;
  refLabel: string; // "오늘"/"어제" 등
  currentRating: number | null;
  enaLeadSentence: string | null; // ENA만 — 그대로 맨 앞에 유지
  rating_delta_pct: number | null;
  baseline_avg_rating: number | null; // 최근 12주 평균
  dow_baseline_avg_rating: number | null;
  today_peak_hour: number | null;
  today_peak_rating: number | null;
  today_peak_program_name: string | null;
  today_peak_program_rating: number | null;
  baseline_peak_hour: number | null;
  baseline_peak_rating: number | null;
  top_program_name: string | null;
  top_program_rating: number | null;
  top_program_start_time: string | null;
  top_program_baseline_avg: number | null;
  top_program_baseline_days: number | null;
  demographics: { label: string; today: number | null; baseline_avg: number | null; delta_pct: number | null }[] | null;
  // 사용자 지시(2026-09-02, SDoW): baseline_avg_rating/top_program_baseline_avg가 실제로 무엇
  // 대비인지 프롬프트에 정확히 알려주기 위한 라벨 — SDoW 활성화 시 route.ts가 이미 두 값 모두
  // "선택 요일의 최근 N주 평균"으로 계산해 보내주므로(같은 N주), 문구도 이 라벨 하나로 통일한다.
  // 없으면(기존 호출부) 기존 "최근 12주"/"최근 8주" 문구를 그대로 쓴다(하위호환).
  baselineLabel?: string;
  // 사용자 지시(2026-09-22): "가구 시청률 1% 초과 예외" — ENA/ENA Play/ENA Drama는 평소
  // 2049만 보지만, 오늘 채널 단위 가구 시청률(전국 유료가구)이 1%를 넘거나 시청시간이 길어
  // route.ts가 예외를 발동시켰을 때만 값이 들어온다(그 외엔 null — 언급하지 마라).
  groupAHouseholdException: number | null;
}

// 사용자 지시(2026-09-22): "오늘의 브리핑을 줄글 형태가 아닌 수치와 팩트 위주의 가독률 좋은
// 내용 위주로... 지금은 말이 너무 길어서 읽기 힘들다" — 3~6문장짜리 문단 하나 대신, 숫자가
// 맨 앞에 오는 짧은 사실 나열(각 3~5개)로 바꾼다. 계산 자체는 그대로(새 수치 없음), 문장을
// 짧게 끊어 PD가 훑어보기 쉽게 하는 표현 방식만 바뀐다.
function buildSystemPrompt(baselineLabel: string): string {
  return [
    "너는 KT ENA 편성 PD를 위한 Page 2 '오늘의 브리핑' 작성기다.",
    "PD들은 줄글을 읽기 힘들어한다 — 문장이 아니라 숫자·사실 위주의 짧은 항목 3~5개 배열로 만들어라.",
    "각 항목은 하나의 사실만 담고, 반드시 숫자나 프로그램명으로 시작하며, 15자 안팎으로 짧게 끊는다 — 서술어(~습니다, ~했습니다, ~보였습니다)를 쓰지 마라.",
    '예시 형식: "0.126 (▼51.6%, {baseline} 대비)" / "피크 15시 · \'걸어서 세계속으로\' 0.0141" / "\'걸어서 세계속으로\' {baseline} 대비 ▲490.3%" / "여20대 ▼89.5% · 여40대 ▲24.3%"',
    `가장 중요한 규칙: baseline(비교 기준) 수치를 언급할 땐 반드시 정확히 "${baselineLabel}"라는 표현만 써라. "최근 12주 평균"이나 "최근 8주 평균" 같은 다른 기간을 절대 쓰지 마라 — ${baselineLabel}가 실제로 이번 계산에 쓰인 기준이다.`,
    "enaLeadSentence 필드가 있으면 그 문장(이미 완성된 문장이므로 줄이지 말고 그대로)을 배열의 첫 항목으로 넣어라(null이면 생략).",
    `피크 시간대 프로그램명(today_peak_program_name)이 top_program_name과 같으면 한 항목으로 합쳐라(예: "피크 15시 · '걸어서 세계속으로' 0.0141 (▲490.3%, ${baselineLabel} 대비)"). 둘이 다르면 각각 별도 항목으로 나눠라.`,
    "값이 null이거나 변화폭이 미미한 지표는 항목으로 만들지 마라 — 대략 10~25% 안팎 이상 변화 정도를 뚜렷한 신호로 본다.",
    "연령대(demographics) 변화가 여러 개면 한 항목에 가운뎃점(·)으로 묶어라(위 예시 참고), 항목 수를 늘리지 마라.",
    'groupAHouseholdException 값이 null이 아니면 그 값을 백분율로 바꿔 마지막 항목으로 추가해라(예: "가구 시청률 3.6% (전국 유료가구)"). null이면 가구 시청률을 절대 언급하지 마라.',
    `다시 한번: baseline 관련 수치의 기준을 언급할 땐 반드시 "${baselineLabel}"라고만 표현해라(다른 기간을 지어내지 마라).`,
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { facts: { type: "array", items: { type: "string" } } },
  required: ["facts"],
  additionalProperties: false,
};

export async function buildBriefingReportViaLlm(input: BriefingLlmInput): Promise<string[] | null> {
  const baselineLabel = input.baselineLabel ?? "최근 12주 평균";
  // 사용자 지시(2026-09-02, SDoW): baselineLabel 문구 준수가 중요해(실측 중 기본 온도에서
  // gpt-4o-mini가 가끔 "최근 12주 평균" 관용구를 그대로 재현하는 것을 발견) 이 호출만 온도를
  // 낮춰 지시 준수를 높인다(다른 서술 job들의 기본값 0.3은 그대로 둠).
  const result = await callOpenAiJsonSynthesis<{ facts: string[] }>(buildSystemPrompt(baselineLabel), input, "briefing_report", SCHEMA, {
    temperature: 0.1,
  });
  const facts = (result?.facts ?? []).map((f) => f.trim()).filter((f) => f.length > 0);
  return facts.length > 0 ? facts : null;
}
