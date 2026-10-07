// 단계 16 — 기능 끄개(kill switch). 새로 들어간 경로가 문제를 일으키면 코드를 되돌리지 않고 환경 설정 한 줄로 이전 동작으로 돌아가게 한다.
// 기본은 모두 켜짐. 끄려면 환경 변수 FEATURE_<이름>=off (0·false·off). 값은 요청마다 읽으므로 설정을 바꾸고 다시 배포하면 바로 적용된다.
// 이 모듈은 환경 변수 이름만 다루며 어떤 값(키·토큰)도 읽거나 기록하지 않는다.
export interface FlagSpec {
  /** 환경 변수 접미사(대문자) */
  env: string;
  /** 끄면 어떻게 되는지(운영자용 한 줄) */
  whenOff: string;
  /** 어느 단계에서 들어왔나 */
  since: string;
}

export const FEATURE_FLAGS = {
  llm_text_cache: { env: "LLM_TEXT_CACHE", whenOff: "AI 문장 캐시를 건너뛰고 요청마다 새로 생성한다(속도는 느려지지만 이전 동작).", since: "단계 15 이전(캐시) · 15(채널 AI 설명)" },
  report_snapshot_store: { env: "REPORT_SNAPSHOT_STORE", whenOff: "보고서를 저장하지 않고 만든다 — 다운로드는 파일을 만들 때 다시 계산하고 PDF(문서 보기) 버튼은 막힌다(단계 14 이전 동작).", since: "단계 14" },
} as const satisfies Record<string, FlagSpec>;

export type FeatureName = keyof typeof FEATURE_FLAGS;

const OFF = new Set(["off", "0", "false", "no", "disabled"]);

export function isFeatureOn(name: FeatureName, env: Record<string, string | undefined> = process.env): boolean {
  const v = env[`FEATURE_${FEATURE_FLAGS[name].env}`];
  return v === undefined ? true : !OFF.has(v.trim().toLowerCase());
}
