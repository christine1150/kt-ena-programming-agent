// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2 WHAT TO
// SCHEDULE?의 펼침 패널 해석(buildFitScoreInterpretation)도 규칙 기반이었다. 같은 지표·신뢰도·태그를 LLM에 줘서 더 자연스러운
// 해석 문단으로 종합한다. 프로그램당 펼쳤을 때만 호출(항상 계산하지 않음 — 비용 절감).
// 2026-10-14 콘텐츠 적합도 재설계: 입력이 옛 하위지표 6종(percentile)에서 슬롯 대비 성과·시청 규모(배수)·시청 몰입도·최근 추세로 바뀌었다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";
import { guardForInput } from "./insight/guardInput";

export interface FitScoreInterpretationLlmInput {
  programName: string;
  tag: "STRENGTHEN" | "KEEP" | "WATCH" | "MOVE" | "REPLACE" | "TEST" | null;
  fitScore: number | null;
  confidencePct: number | null;
  /** 방영 일수(표본). */
  sampleDays: number;
  /** 같은 요일·시간대 다른 프로그램 평균 대비 몇 배(1.0=평균 수준, 소수 둘째 자리). */
  slotIndex: number | null;
  /** 채널 평균 방영 시청률 대비 몇 배(소수 둘째 자리). */
  scaleIndex: number | null;
  /** 도달률·시청시간 비율을 같은 시간대 다른 프로그램과 견준 점수(0~100, 50=평균 수준). */
  engagementScore: number | null;
  /** 최근 4주가 이전 8주보다 몇 % 올랐나(음수=하락). 계산 불가면 null. */
  trendPct: number | null;
  /** true면 표본이 적어 정식 판정이 아닌 참고용 점수다. */
  isReference: boolean;
  audienceRoleLabel: string | null; // "대중형" 등, 있으면
}

// 사용자 지시(2026-10-06 예약 작업/2026-10-07): 화면에 영문 지표명·내부 변수명(confidencePct 등)이 나오지 않게 하고 편성 PD가 바로 읽는 한국어 편성 언어로 쓴다.
const TAG_KO: Record<string, string> = { STRENGTHEN: "강화", KEEP: "유지", WATCH: "관찰", MOVE: "이동 검토", REPLACE: "교체 검토", TEST: "테스트(표본 부족)" };
/** LLM이 영문 지표명·내부 변수명을 섞어 쓴 경우 한국어 편성 용어로 바꾼다(후처리 안전장치). */
export function koreanizeFitText(s: string | null | undefined): string | null {
  if (!s) return null;
  return s
    .replace(/Target Performance/gi, "타깃 성과")
    .replace(/Target Affinity/gi, "타깃 선호도")
    .replace(/Audience Engagement/gi, "시청 몰입도")
    .replace(/Slot Performance/gi, "슬롯 성과")
    .replace(/Competitive Opportunity/gi, "경쟁 기회")
    .replace(/Competitive Pressure/gi, "경쟁 강도")
    .replace(/Audience Flow/gi, "시청 흐름")
    .replace(/Lead-?in Retention/gi, "리드인 유지율")
    .replace(/Fit Score/gi, "적합도")
    .replace(/confidencePct/gi, "표본 신뢰도")
    .replace(/\bSTRENGTHEN\b/g, "강화")
    .replace(/\bREPLACE\b/g, "교체 검토")
    .replace(/\bMOVE\b/g, "이동 검토")
    .replace(/\bKEEP\b/g, "유지")
    .replace(/\bWATCH\b/g, "관찰")
    .replace(/\bTEST\b/g, "테스트")
    .replace(/\bMASS\b/g, "대중형");
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 '무엇을 편성할까요?' 펼침 패널의 프로그램 진단 문구 작성기다. 편성 PD가 바로 읽는 한국어 편성 용어로 쓴다.",
    "입력의 지표와 판단 태그를 보고 강점·주의 한두 줄로 해석한다. 2~3문장, 경어체(~입니다/~보입니다)를 쓴다.",
    "지표의 뜻: 슬롯 대비 성과 = 같은 요일·시간대의 다른 프로그램 평균 시청률의 몇 배(1.0배가 평균 수준) / 시청 규모 = 채널 평균 방영 시청률의 몇 배 / 시청 몰입도 = 도달률·시청시간 비율을 같은 시간대 다른 프로그램과 견준 0~100 점수(50이 평균 수준) / 최근 추세 = 최근 4주가 이전 8주보다 몇 % 올랐거나 내렸는지.",
    "판단은 슬롯 대비 성과가 중심이다: 1.5배 이상이면 뚜렷한 강점, 0.85배 미만이면 주의할 점으로 짚는다. 시청 규모·몰입도·추세는 보조 설명으로만 덧붙인다(둘 다 없으면 '뚜렷한 강점·약점 없이 무난한 성과'라고 쓴다).",
    "'시청률이 낮은데 다른 지표가 좋아서 괜찮다'는 식으로 쓰지 않는다. 시청률 성과가 약하면 그 사실을 먼저 말한다.",
    "표본적음_참고용이 true이면 방영 일수가 적어 정식 판정이 아니라는 뜻이다 — '표본이 적어 참고용'이라고 쓰고 방향만 시사한다. 신뢰도 숫자나 변수명은 쓰지 않는다.",
    "연령 구성이나 타깃 선호도는 입력에 없다. 시청층에 대해 입력에 없는 내용을 추측해서 쓰지 않는다.",
    "마지막 한 문장은 판단 방향(교체 검토·이동 검토·강화·유지·관찰·테스트)을 편성 PD의 말로 시사한다. 예: '같은 시간대 평균의 1.4배로 기대 수준을 웃돌지만 최근 4주는 낮아지는 중이라 몇 주 더 지켜볼 만합니다.'",
    "지표 이름은 한국어 이름(슬롯 대비 성과·시청 규모·시청 몰입도·최근 추세)만 쓴다. 영문 변수명(slotIndex, confidencePct, isReference 등)과 영문 태그(REPLACE, TEST 등)는 절대 쓰지 않는다.",
    "입력에 없는 수치는 절대 만들지 않는다.",
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: { interpretation: { type: "string" } },
  required: ["interpretation"],
  additionalProperties: false,
};

export async function buildFitScoreInterpretationViaLlm(input: FitScoreInterpretationLlmInput): Promise<string | null> {
  // 모델에는 한국어 키·한국어 태그로 바꿔 보낸다(영문 변수명이 문장에 새어 나오지 않게). 숫자 검증(guard)은 원래 입력과 대조한다.
  const forModel = {
    프로그램: input.programName,
    판단태그: input.tag ? TAG_KO[input.tag] ?? input.tag : null,
    적합도점수: input.fitScore,
    표본신뢰도: input.confidencePct,
    방영일수: input.sampleDays,
    슬롯대비성과_배: input.slotIndex,
    시청규모_배: input.scaleIndex,
    시청몰입도: input.engagementScore,
    최근추세_퍼센트: input.trendPct,
    표본적음_참고용: input.isReference,
    시청자유형: input.audienceRoleLabel,
  };
  const result = await callOpenAiJsonSynthesis<{ interpretation: string }>(buildSystemPrompt(), forModel, "fit_score_interpretation", SCHEMA);
  // 단계 04: 이 해석은 점수(정수)·배수가 내용이라 단위 없는 정수도 입력과 대조한다. 규칙 문구의 판정선(1.5배·0.85배·4주·8주)은 허용한다.
  return koreanizeFitText(guardForInput(result?.interpretation, forModel, { label: "fit_score_interpretation", rules: [{ match: /^(슬롯대비성과_배|시청규모_배)$/, valueKind: "ratio_x" }], options: { strictIntegers: true, extraNumbers: [1, 1.5, 0.85, 4, 8, 50, 100] } }));
}
