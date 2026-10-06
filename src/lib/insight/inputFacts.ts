// LLM 입력 객체 → Fact 목록(단계 04). 서술 생성기마다 이미 "계산·반올림된 값만" JSON으로 AI에게 준다. 그 입력을 그대로 허용 사실로
// 바꿔 두면 AI 출력의 숫자·단위·기준을 같은 입력과 대조할 수 있다(새 계산 없음).
import type { AirType, ComparisonKind, Fact, ValueKind } from "./types";

export interface InputFactRule {
  /** 키 경로(예: "demographics.0.delta_pct")에 대한 정규식 */
  match: RegExp;
  valueKind?: ValueKind;
  comparison?: ComparisonKind;
  airType?: AirType;
}

export interface InputFactSpec {
  source: string;
  snapshotId?: string;
  rules?: InputFactRule[];
}

function ruleFor(path: string, spec: InputFactSpec): InputFactRule | undefined {
  return spec.rules?.find((r) => r.match.test(path));
}

function defaultKind(path: string, isString: boolean): ValueKind {
  if (isString) return "text";
  if (/rank/i.test(path)) return "rank";
  if (/delta_pct|_pct$|Pct$/i.test(path)) return "pct_change";
  if (/rating|avg|share/i.test(path)) return "rating";
  return "count";
}

/** 입력 객체의 숫자·문장 잎(leaf)을 전부 Fact로 만든다. 순위는 정수로 반올림한 값만 허용한다(순위는 정수 규칙). */
export function factsFromInput(input: unknown, spec: InputFactSpec): Fact[] {
  const facts: Fact[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}.${i}`));
    if (typeof v === "object") return Object.entries(v as Record<string, unknown>).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k));
    const rule = ruleFor(path, spec);
    if (typeof v === "number" && Number.isFinite(v)) {
      const valueKind = rule?.valueKind ?? defaultKind(path, false);
      facts.push({
        id: `in:${path}`,
        metricId: path.replace(/\.\d+/g, ""),
        context: path,
        value: valueKind === "rank" ? Math.round(v) : v,
        valueKind,
        unit: valueKind === "rank" ? "위" : "",
        display: valueKind === "rank" ? `${Math.round(v)}위` : String(v),
        comparison: rule?.comparison ? { kind: rule.comparison, label: rule.comparison, baseValue: null, direction: null } : undefined,
        provenance: { source: spec.source, snapshotId: spec.snapshotId },
        basis: "observed",
        airType: rule?.airType ?? null,
      });
    } else if (typeof v === "string" && v.length > 0) {
      facts.push({
        id: `in:${path}`,
        metricId: path.replace(/\.\d+/g, ""),
        context: path,
        value: null,
        valueKind: "text",
        unit: "",
        display: v,
        comparison: rule?.comparison ? { kind: rule.comparison, label: rule.comparison, baseValue: null, direction: null } : undefined,
        provenance: { source: spec.source, snapshotId: spec.snapshotId },
        basis: "observed",
        airType: rule?.airType ?? null,
      });
    }
  };
  walk(input, "");
  return facts;
}
