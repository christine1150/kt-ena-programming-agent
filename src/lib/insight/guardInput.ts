// 서술 생성기용 검증 어댑터(단계 04) — 각 생성기가 AI에게 준 입력 객체를 그대로 허용 사실로 삼아 출력 문장을 검증한다.
// 호출부는 검증에 실패하면 null을 받아 기존의 규칙 기반 문구로 대체한다(잘못된 문장을 그대로 내보내지 않는다).
import { factsFromInput, type InputFactRule } from "./inputFacts";
import { acceptNarrative, comparisonKindFromLabel, type GuardOptions } from "./narrativeGuard";
import type { ComparisonKind, Fact } from "./types";

export interface InputGuardSpec {
  label: string;
  rules?: InputFactRule[];
  /** 문장이 언급해도 되는 비교 기준 */
  allowedBaselines?: ComparisonKind[];
  /** 기준 이름 라벨(예: "최근 12주 평균", "선택한 요일의 최근 8주 평균")에서 허용 기준을 뽑는다 */
  baselineLabels?: string[];
  extraFacts?: Fact[];
  options?: Omit<GuardOptions, "allowedBaselines">;
}

/** 입력 문자열이 이미 언급한 비교 기준(리드 문장·근거 문장 등)은 그대로 인용될 수 있으므로 허용한다. */
function baselinesFromStrings(facts: Fact[]): ComparisonKind[] {
  return facts.filter((f) => f.valueKind === "text").flatMap((f) => comparisonKindFromLabel(f.display));
}

export function guardForInput(text: string | null | undefined, input: unknown, spec: InputGuardSpec): string | null {
  const facts = [...factsFromInput(input, { source: spec.label, rules: spec.rules }), ...(spec.extraFacts ?? [])];
  const allowedBaselines = [
    ...(spec.allowedBaselines ?? []),
    ...(spec.baselineLabels ?? []).flatMap((l) => comparisonKindFromLabel(l)),
    ...baselinesFromStrings(facts),
  ];
  return acceptNarrative(text, facts, { ...spec.options, allowedBaselines, label: spec.label });
}
