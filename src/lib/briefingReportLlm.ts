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
  demographics: { label: string; today: number | null; delta_pct: number | null }[] | null;
  // 사용자 지시(2026-09-02, SDoW): baseline_avg_rating/top_program_baseline_avg가 실제로 무엇
  // 대비인지 프롬프트에 정확히 알려주기 위한 라벨 — SDoW 활성화 시 route.ts가 이미 두 값 모두
  // "선택 요일의 최근 N주 평균"으로 계산해 보내주므로(같은 N주), 문구도 이 라벨 하나로 통일한다.
  // 없으면(기존 호출부) 기존 "최근 12주"/"최근 8주" 문구를 그대로 쓴다(하위호환).
  baselineLabel?: string;
}

function buildSystemPrompt(baselineLabel: string): string {
  return [
    "너는 KT ENA 편성 PD를 위한 Page 2 '오늘의 브리핑' 작성기다.",
    `가장 중요한 규칙: baseline(비교 기준) 수치를 언급할 땐 반드시 정확히 "${baselineLabel}"라는 표현만 써라. "최근 12주 평균"이나 "최근 8주 평균" 같은 다른 기간을 절대 쓰지 마라 — ${baselineLabel}가 실제로 이번 계산에 쓰인 기준이다.`,
    `아래 JSON에 담긴 신호(채널 시청률, ${baselineLabel} 대비 등락, 요일 패턴, 피크 시간대와 그 시간대를 이끈 프로그램, 연령대 변화)를 하나의 자연스러운 한국어 문단(3~6문장)으로 종합해라.`,
    "enaLeadSentence 필드가 있으면 그 문장은 절대 다시 쓰지 말고 그대로 맨 앞에 두고 이어서 작성해라(null이면 채널 시청률 언급부터 시작).",
    `피크 시간대 프로그램명(today_peak_program_name)이 top_program_name과 같으면, top_program_baseline_avg 대비 등락률(같은 요일·시간대 본방 슬롯 기준 ${baselineLabel} 대비, top_program_baseline_days>=3일 때만 유효)까지 그 시간대 문장에 자연스럽게 엮어라. 둘이 다르면 억지로 합치지 말고 각자 따로 언급해라.`,
    "값이 null이거나 변화폭이 미미한 지표는 굳이 언급하지 마라 — 대략 10~25% 안팎 이상 변화 정도를 뚜렷한 신호로 본다.",
    `다시 한번: baseline 관련 수치의 기준을 언급할 땐 반드시 "${baselineLabel}"라고만 표현해라(다른 기간을 지어내지 마라).`,
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { briefing: { type: "string" } },
  required: ["briefing"],
  additionalProperties: false,
};

export async function buildBriefingReportViaLlm(input: BriefingLlmInput): Promise<string | null> {
  const baselineLabel = input.baselineLabel ?? "최근 12주 평균";
  // 사용자 지시(2026-09-02, SDoW): baselineLabel 문구 준수가 중요해(실측 중 기본 온도에서
  // gpt-4o-mini가 가끔 "최근 12주 평균" 관용구를 그대로 재현하는 것을 발견) 이 호출만 온도를
  // 낮춰 지시 준수를 높인다(다른 서술 job들의 기본값 0.3은 그대로 둠).
  const result = await callOpenAiJsonSynthesis<{ briefing: string }>(buildSystemPrompt(baselineLabel), input, "briefing_report", SCHEMA, {
    temperature: 0.1,
  });
  const briefing = result?.briefing?.trim();
  return briefing && briefing.length > 0 ? briefing : null;
}
