// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2 WHAT TO
// SCHEDULE?의 펼침 패널 해석(buildFitScoreInterpretation)도 규칙 기반이었다(강점/주의 지표
// 쌍으로만 기계적 문장화). 같은 6개 하위지표·신뢰도·태그를 LLM에 줘서 더 자연스러운 해석
// 문단으로 종합한다. 프로그램당 펼쳤을 때만 호출(항상 계산하지 않음 — 비용 절감).
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";
import { guardForInput } from "./insight/guardInput";

export interface FitScoreInterpretationLlmInput {
  programName: string;
  tag: "STRENGTHEN" | "KEEP" | "MOVE" | "REPLACE" | "TEST" | null;
  fitScore: number | null;
  confidencePct: number | null;
  subScores: { label: string; value: number | null }[];
  audienceRoleLabel: string | null; // "대중형(MASS)" 등, 있으면
}

// 사용자 지시(2026-10-06 예약 작업/2026-10-07): 화면에 영문 지표명·내부 변수명(confidencePct 등)이 나오지 않게 하고 편성 PD가 바로 읽는 한국어 편성 언어로 쓴다.
const TAG_KO: Record<string, string> = { STRENGTHEN: "강화", KEEP: "유지", MOVE: "이동 검토", REPLACE: "교체 검토", TEST: "테스트(표본 부족)" };
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
    .replace(/STRENGTHEN/g, "강화")
    .replace(/REPLACE/g, "교체 검토")
    .replace(/MOVE/g, "이동 검토")
    .replace(/KEEP/g, "유지")
    .replace(/TEST/g, "테스트")
    .replace(/MASS/g, "대중형");
}

function buildSystemPrompt(): string {
  return [
    "너는 KT ENA 편성 PD를 위한 '무엇을 편성할까요?' 펼침 패널의 프로그램 진단 문구 작성기다. 편성 PD가 바로 읽는 한국어 편성 용어로 쓴다.",
    "입력의 하위지표(0~100)와 판단 태그를 보고 강점·주의 한두 줄로 해석한다. 2~3문장, 경어체(~입니다/~보입니다)를 쓴다.",
    "70 이상인 지표는 강점으로, 40 이하인 지표는 주의할 점으로 짚는다(둘 다 없으면 '뚜렷한 강점·약점 없이 무난한 성과'라고 쓴다).",
    "지표 이름은 입력에 있는 한국어 이름(타깃 성과·타깃 선호도·시청 몰입도·슬롯 성과·경쟁 기회·시청 흐름)만 그대로 쓴다. 영문 지표명(Target Performance, Audience Engagement 등)과 변수명(confidencePct, subScores, tag 등), 영문 태그(REPLACE, TEST 등)는 절대 쓰지 않는다.",
    "표본 신뢰도가 60 미만이면 '표본이 적어 참고용'이라고만 쓰고 신뢰도 숫자나 변수명은 쓰지 않는다.",
    "마지막 한 문장은 판단 방향(교체 검토·이동 검토·강화·유지·테스트)을 편성 PD의 말로 시사한다. 예: '앞 프로그램 시청자를 잘 이어받고 몰입도가 높습니다. 다만 같은 시간대 경쟁 여건이 불리해 경쟁 기회는 낮습니다. 표본이 적어 참고용입니다.'",
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
    하위지표: input.subScores,
    시청자유형: input.audienceRoleLabel,
  };
  const result = await callOpenAiJsonSynthesis<{ interpretation: string }>(buildSystemPrompt(), forModel, "fit_score_interpretation", SCHEMA);
  // 단계 04: 이 해석은 0~100 점수(정수)가 내용이라 단위 없는 정수도 입력과 대조한다. 규칙 문구의 판정선(70·40·60)은 허용한다.
  return koreanizeFitText(guardForInput(result?.interpretation, input, { label: "fit_score_interpretation", options: { strictIntegers: true, extraNumbers: [70, 40, 60, 100] } }));
}
