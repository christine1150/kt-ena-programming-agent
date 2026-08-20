// INTENT ROUTER — 스펙 32번(route_question)/31번(Intent Collision Prevention)을 그대로 구현한다.
// TIME RESOLVER → PARAMETER EXTRACTOR → 후보 Intent 탐지 → (필요 파라미터 충족 + specificity로)
// 가장 구체적인 Intent 선택. 후보가 없으면 스펙 29번 그대로 "지원하지 않는다"를 돌려준다.
import type { RouteResult, UnsupportedResult } from "./types";
import { resolveTimePeriod } from "./timeResolver";
import { extractParameters } from "./parameterExtractor";
import { INTENT_REGISTRY } from "./intentRegistry";

export async function routeQuestion(question: string, referenceDate: string): Promise<RouteResult | UnsupportedResult> {
  const timeContext = resolveTimePeriod(question, referenceDate);
  const parameters = await extractParameters(question);
  const lower = question.toLowerCase();

  const candidates = INTENT_REGISTRY.filter((intent) => intent.keywords.some((kw) => lower.includes(kw.toLowerCase())));

  if (candidates.length === 0) {
    return { ok: false, reason: "no_intent_matched" };
  }

  // 필요 파라미터를 충족하는 후보만 우선 고려하고, 그중 가장 구체적인(specificity 높은) 것을 고른다.
  const satisfied = candidates.filter((intent) => intent.required_parameters.every((p) => parameters[p] !== null));
  const pool = satisfied.length > 0 ? satisfied : candidates;
  const chosen = [...pool].sort((a, b) => b.specificity - a.specificity)[0];

  const missing = chosen.required_parameters.filter((p) => parameters[p] === null);
  if (missing.length > 0) {
    return { ok: false, reason: "missing_required_parameter", missing, candidateIntentIds: [chosen.intent_id] };
  }

  return {
    ok: true,
    intent_id: chosen.intent_id,
    macro_intent: chosen.macro_intent,
    parameters,
    timeContext,
    data_mart: chosen.data_mart,
  };
}
