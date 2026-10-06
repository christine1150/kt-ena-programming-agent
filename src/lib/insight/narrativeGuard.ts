// AI 문장 검증기(단계 04) — AI가 쓴 문장이 허용된 Fact와 다른 말을 하지 못하게 한다.
// 검사: 숫자·단위 / 지수를 시청률·%로 바꿔 쓴 것 / %와 %p 혼동 / 화살표·방향어 / 비교 기준 바꿔치기(12주→전주) /
//       본방·재방 혼용 / 인과 단정 / 구성비 근거 없는 시청층 단정 / 여러 집단인데 "한 집단만" / 참조 ID·출처.
// 통과하지 못하면 문장을 내보내지 않는다(호출부가 사실 기반 규칙 문구로 대체). 정수 중 단위 없는 것(시각·회차·타깃명)은 검증하지 않는다.
import type { AirType, ComparisonKind, Fact } from "./types";

export type ViolationCode =
  | "unknown_number"
  | "unit_mismatch"
  | "index_as_percent"
  | "pp_pct_confusion"
  | "direction_mismatch"
  | "baseline_mismatch"
  | "causal_claim"
  | "airtype_mismatch"
  | "composition_without_data"
  | "single_group_claim"
  | "unsourced_fact"
  | "unknown_reference";

export interface Violation {
  code: ViolationCode;
  detail: string;
  excerpt?: string;
}

export interface GuardOptions {
  /** Fact.comparison 외에 문장이 언급해도 되는 비교 기준 */
  allowedBaselines?: ComparisonKind[];
  /** 100 미만인 집단 수 — 2 이상이면 "한 집단만" 표현을 막는다 */
  belowAverageGroupCount?: number;
  allowCausal?: boolean;
  /** 입력 값은 아니지만 문장에 나와도 되는 숫자(규칙 문구의 임계값 등: 70 이상, 40 이하) */
  extraNumbers?: number[];
  /** 단위 없는 정수도 근거와 대조한다(0~100 점수를 다루는 해석처럼 정수가 내용인 경우). 날짜·시각·기간 표기는 제외 */
  strictIntegers?: boolean;
  /** %로 표기된 값을 반올림한 표기(소수 1자리 → 정수)까지 같은 값으로 보는 허용 오차(%p) */
  pctTolerance?: number;
}

export interface GuardResult {
  ok: boolean;
  violations: Violation[];
  /** 문장의 숫자가 대응된 Fact ID(참조 추적) */
  matchedFactIds: string[];
}

// ───────── 숫자 추출 ─────────
interface NumToken {
  value: number;
  unit: "%p" | "%" | "지수" | "위" | "회" | "배" | "점" | "";
  arrow: "▲" | "▼" | null;
  decimal: boolean;
  start: number;
  end: number;
  raw: string;
}

const NUM_RE = /([▲▼])?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%p|%포인트|퍼센트포인트|%|지수|위(?!해)|회(?!차)|배|점)?/g;

export function extractNumberTokens(text: string): NumToken[] {
  const out: NumToken[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const unitRaw = m[4] ?? "";
    const unit = unitRaw === "%포인트" || unitRaw === "퍼센트포인트" ? "%p" : (unitRaw as NumToken["unit"]);
    out.push({
      value: Number(`${m[2].replace(/,/g, "")}${m[3] ?? ""}`),
      unit,
      arrow: (m[1] as "▲" | "▼" | undefined) ?? null,
      decimal: m[3] !== undefined,
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      raw: m[0].trim(),
    });
  }
  return out;
}

const key = (v: number) => v.toFixed(6);

/** 날짜·시각·기간·개수 표기처럼 값이 아닌 정수를 strictIntegers 대상에서 뺀다. */
function isBareInteger(text: string, t: NumToken): boolean {
  // 토큰 시작에 화살표·공백이 붙어 있을 수 있어 숫자 첫 글자 위치로 맞춘다.
  let digitStart = t.start;
  while (digitStart < t.end && /[▲▼\s]/.test(text[digitStart])) digitStart++;
  const next = text.slice(t.end, t.end + 1);
  const prev = text.slice(Math.max(0, digitStart - 1), digitStart);
  if (/[-:/~.0-9]/.test(next) || /[-:/~.0-9]/.test(prev)) return false;
  if (/[월일시분초주년개번차세대]/.test(next)) return false;
  if (/[A-Za-z가-힣]/.test(prev)) return false;
  return true;
}

// ───────── 문장 분리 ─────────
interface Sentence {
  start: number;
  end: number;
  text: string;
}
function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const re = /(?<=[.!?。])\s+|\n+/g;
  for (const m of text.matchAll(re)) {
    const end = m.index ?? 0;
    if (end > start) out.push({ start, end, text: text.slice(start, end) });
    start = end + m[0].length;
  }
  if (start < text.length) out.push({ start, end: text.length, text: text.slice(start) });
  return out;
}
const sentenceOf = (ss: Sentence[], pos: number) => ss.find((s) => pos >= s.start && pos < s.end) ?? ss[ss.length - 1];

// ───────── 비교 기준 ─────────
const BASELINE_PATTERNS: { cls: ComparisonKind; re: RegExp }[] = [
  { cls: "prior_week2", re: /전전주|2주\s*전/g },
  { cls: "prior_week", re: /(?<!전)전주(?!간)|지난주|직전\s*주/g },
  { cls: "prior_period", re: /전\s*기간|직전\s*기간|이전\s*기간/g },
  { cls: "prior_month", re: /전월/g },
  { cls: "prior_year", re: /전년|작년/g },
  { cls: "same_dow", re: /같은\s*요일|동일\s*요일|동요일|선택한\s*요일/g },
  { cls: "slot_avg", re: /같은\s*슬롯|동일\s*슬롯|본방\s*슬롯|동시간대\s*평균|같은\s*시간대\s*평균/g },
  { cls: "channel_avg", re: /채널\s*평균/g },
  { cls: "goal", re: /목표/g },
];
const ROLLING_RE = /(\d{1,2})\s*주\s*(?:평균|대비)/g;

interface BaselineMention {
  cls: ComparisonKind;
  start: number;
  end: number;
}

function baselineMentions(text: string): BaselineMention[] {
  const out: BaselineMention[] = [];
  for (const { cls, re } of BASELINE_PATTERNS) {
    for (const m of text.matchAll(re)) out.push({ cls, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const m of text.matchAll(ROLLING_RE)) {
    const n = Number(m[1]);
    const cls = (n === 4 ? "rolling_4w" : n === 8 ? "rolling_8w" : n === 12 ? "rolling_12w" : null) as ComparisonKind | null;
    // 4·8·12주 외의 N주 평균은 어떤 Fact도 가질 수 없는 기준이라 항상 불일치로 처리한다.
    out.push({ cls: cls ?? ("rolling_other" as unknown as ComparisonKind), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function comparisonKindFromLabel(label: string): ComparisonKind[] {
  return baselineMentions(label)
    .map((m) => m.cls)
    .filter((c, i, a) => a.indexOf(c) === i && (c as string) !== "rolling_other");
}

// ───────── 단어 사전 ─────────
const UP_WORD = /상승|증가|올랐|올라|반등|늘었|높아졌|확대됐/;
const DOWN_WORD = /하락|감소|떨어|내렸|줄었|낮아졌|빠졌|축소됐/;
const CAUSAL_RE = /(때문에|때문이다|때문입니다|탓에|덕분에|덕분이다|영향으로|영향을 받아|로 인해|으로 인해|로 인한|으로 인한|이끌었|이끈|끌어내렸|끌어내린|끌어올렸|끌어올린|견인했|견인한|초래|야기|원인이다|원인은|원인입니다|에\s*밀(?:림|렸|려))/;
const HEDGE_RE = /(가능성|로 보임|로 보인다|로 보입니다|보입니다|보인다|추정|수 있|일 수|듯하|것으로 보|관찰|동시에|함께 나타|확인되지 않|단정할 수 없|알 수 없)/;
const COMPOSITION_RE = /핵심\s*시청층|주\s*시청층|주요\s*시청층|시청자\s*구성|구성비|시청층\s*비중/;
const SINGLE_GROUP_RE = /(?:한|하나의)\s*(?:집단|타깃|연령대?)\s*(?:만|뿐)|[가-힣0-9]+(?:\([0-9.]+\))?만\s*(?:채널\s*)?평균\s*(?:이하|미만)/;

const AIR_FIRST = /본방/;
const AIR_RERUN = /재방/;
const AIR_MIXED = /본방\s*[+·&]\s*재방|본방과\s*재방|합산|전체\s*평균/;

// ───────── Fact에서 허용 집합 만들기 ─────────
interface Allowed {
  all: Set<string>;
  withUnit: Set<string>;
  units: Set<string>;
  arrowVals: Set<string>;
  indexValues: Map<string, Fact>;
  baselines: Set<string>;
  hasComposition: boolean;
  pctValues: number[];
}

const unitKey = (value: number, unit: string) => `${key(value)}|${unit}`;

function buildAllowed(facts: Fact[], opts: GuardOptions): Allowed {
  const a: Allowed = { all: new Set(), withUnit: new Set(), units: new Set(), arrowVals: new Set(), indexValues: new Map(), baselines: new Set(opts.allowedBaselines ?? []), hasComposition: false, pctValues: [] };
  for (const n of opts.extraNumbers ?? []) a.all.add(key(n));
  for (const f of facts) {
    for (const t of extractNumberTokens(f.display)) {
      a.all.add(key(t.value));
      if (t.unit) {
        a.withUnit.add(unitKey(t.value, t.unit));
        a.units.add(t.unit);
        if (t.unit === "%") a.pctValues.push(t.value);
      }
      if (t.arrow) a.arrowVals.add(`${t.arrow}|${key(t.value)}`);
    }
    if (f.value !== null && Number.isFinite(f.value)) {
      const v = f.value;
      a.all.add(key(v));
      if (f.valueKind === "rank") {
        a.withUnit.add(unitKey(Math.round(v), "위"));
        a.units.add("위");
      } else if (f.valueKind === "index100") {
        a.withUnit.add(unitKey(v, "지수"));
        a.units.add("지수");
        a.indexValues.set(key(v), f);
        // 기준 대비 %로 읽는 파생값(153.8 → 53.8%)은 허용한다.
        const gap = Math.abs(Math.round((v - 100) * 10) / 10);
        a.withUnit.add(unitKey(gap, "%"));
        a.all.add(key(gap));
      } else if (f.valueKind === "pp_change") {
        a.withUnit.add(unitKey(Math.abs(v), "%p"));
        a.units.add("%p");
        if (v !== 0) a.arrowVals.add(`${v > 0 ? "▲" : "▼"}|${key(Math.abs(v))}`);
      } else if (f.valueKind === "pct_change") {
        a.withUnit.add(unitKey(Math.abs(v), "%"));
        a.units.add("%");
        a.pctValues.push(Math.abs(v));
        if (v !== 0) a.arrowVals.add(`${v > 0 ? "▲" : "▼"}|${key(Math.abs(v))}`);
      } else if (f.valueKind === "composition_pct") {
        a.hasComposition = true;
      }
    }
    if (f.valueKind === "composition_pct") a.hasComposition = true;
    if (f.comparison) a.baselines.add(f.comparison.kind);
  }
  return a;
}

// ───────── 본 검증 ─────────
export function guardNarrative(text: string, facts: Fact[], opts: GuardOptions = {}): GuardResult {
  const violations: Violation[] = [];
  const allowed = buildAllowed(facts, opts);
  const sentences = splitSentences(text);
  const tokens = extractNumberTokens(text);
  const matchedIds = new Set<string>();
  const add = (code: ViolationCode, detail: string, excerpt?: string) => {
    if (!violations.some((v) => v.code === code && v.excerpt === excerpt)) violations.push({ code, detail, excerpt });
  };

  const factsWithNumber = (value: number) => facts.filter((f) => extractNumberTokens(f.display).some((t) => key(t.value) === key(value)) || (f.value !== null && key(f.value) === key(value)));

  for (const t of tokens) {
    const hits = factsWithNumber(t.value);
    const near = text.slice(Math.max(0, t.start - 6), Math.min(text.length, t.end + 6));

    // 1) %p
    if (t.unit === "%p") {
      if (!allowed.withUnit.has(unitKey(t.value, "%p"))) {
        add(allowed.withUnit.has(unitKey(t.value, "%")) || allowed.all.has(key(t.value)) ? "pp_pct_confusion" : "unknown_number", `근거에 없는 %p 값 ${t.raw}`, t.raw);
        continue;
      }
    }
    // 2) %
    else if (t.unit === "%") {
      const idxFact = allowed.indexValues.get(key(t.value));
      const gapOk = allowed.withUnit.has(unitKey(t.value, "%")) || (opts.pctTolerance !== undefined && allowed.pctValues.some((p) => Math.abs(p - t.value) <= opts.pctTolerance!));
      if (idxFact && !gapOk) {
        add("index_as_percent", `지수 ${t.value}을(를) %로 표기함 — 지수는 기준(100) 대비 수준이며 시청률·상승률이 아님`, t.raw);
        continue;
      }
      if (allowed.units.has("%") && !gapOk) {
        add(allowed.withUnit.has(unitKey(t.value, "%p")) ? "pp_pct_confusion" : allowed.all.has(key(t.value)) ? "unit_mismatch" : "unknown_number", `근거에 없는 % 값 ${t.raw}`, t.raw);
        continue;
      }
      // 지수 값을 "상승/높" 같은 변화로 읽은 경우: 지수의 기준 대비 %와 값이 같을 때만 허용(위 gapOk)
    }
    // 3) 지수 — 근거에 없는 지수는 항상 지어낸 값
    else if (t.unit === "지수") {
      if (!allowed.withUnit.has(unitKey(t.value, "지수"))) {
        add(allowed.all.has(key(t.value)) ? "unit_mismatch" : "unknown_number", `근거에 없는 지수 ${t.raw}`, t.raw);
        continue;
      }
    }
    // 4) 위·회·배·점 — 근거에 그 단위가 있을 때만 값·단위를 함께 대조
    else if (t.unit !== "") {
      if (allowed.units.has(t.unit) && !allowed.withUnit.has(unitKey(t.value, t.unit))) {
        add(allowed.all.has(key(t.value)) ? "unit_mismatch" : "unknown_number", `근거에 없는 값 ${t.raw}`, t.raw);
        continue;
      }
    }
    // 5) 단위 없는 소수는 어떤 Fact에든 있어야 한다. 단위 없는 정수는 검증하지 않는다(strictIntegers일 때만 대조).
    else if (!t.decimal && opts.strictIntegers && isBareInteger(text, t) && !allowed.all.has(key(t.value))) {
      add("unknown_number", `근거에 없는 정수 ${t.raw}`, t.raw);
      continue;
    } else if (t.decimal && !allowed.all.has(key(t.value))) {
      // "시청률 153.8" 처럼 지수를 시청률처럼 쓴 경우를 구분해 알려 준다.
      add(/시청률/.test(near) && allowed.indexValues.has(key(t.value)) ? "index_as_percent" : "unknown_number", `근거에 없는 수치 ${t.raw}`, t.raw);
      continue;
    }
    // 시청률처럼 읽히는 단위 없는 소수가 지수 값과 같은 경우("시청률 153.8")
    if (t.unit === "" && t.decimal && /시청률/.test(near) && allowed.indexValues.has(key(t.value)) && !facts.some((f) => f.valueKind === "rating" && f.value !== null && key(f.value) === key(t.value))) {
      add("index_as_percent", `지수 ${t.value}을(를) 시청률처럼 표기함`, t.raw);
    }

    for (const f of hits) matchedIds.add(f.id);

    // 화살표 — 근거의 화살표와 방향이 같아야 하고 주변 방향어와도 어긋나면 안 된다.
    if (t.arrow) {
      const opposite = t.arrow === "▲" ? "▼" : "▲";
      const tol = opts.pctTolerance ?? 0;
      const hasArrow = (arrow: string) => [...allowed.arrowVals].some((k) => k.startsWith(`${arrow}|`) && Math.abs(Number(k.slice(2)) - t.value) <= tol + 1e-9);
      if (!hasArrow(t.arrow) && hasArrow(opposite)) {
        add("direction_mismatch", `근거는 ${opposite}${t.value}인데 문장은 ${t.arrow}로 씀`, t.raw);
      }
      const around = text.slice(Math.max(0, t.start - 14), Math.min(text.length, t.end + 14));
      if (t.arrow === "▲" && DOWN_WORD.test(around) && !UP_WORD.test(around)) add("direction_mismatch", `▲ 표기에 하락 계열 표현이 붙음`, around.trim());
      if (t.arrow === "▼" && UP_WORD.test(around) && !DOWN_WORD.test(around)) add("direction_mismatch", `▼ 표기에 상승 계열 표현이 붙음`, around.trim());
    }
  }

  // 비교 기준: 문장이 언급한 기준은 근거가 가진 기준이어야 하고, 등락률은 그 값의 기준과 같아야 한다.
  const mentions = baselineMentions(text);
  for (const m of mentions) {
    if (!allowed.baselines.has(m.cls)) {
      add("baseline_mismatch", `근거에 없는 비교 기준(${String(m.cls) === "rolling_other" ? "허용되지 않은 N주 평균" : m.cls}) 언급`, text.slice(m.start, m.end));
    }
  }
  for (const t of tokens) {
    if (!t.arrow || t.unit !== "%") continue;
    const sent = sentenceOf(sentences, t.start);
    const prior = mentions.filter((m) => m.end <= t.start && m.start >= sent.start && t.start - m.end <= 30).pop();
    if (!prior) continue;
    const factKinds = facts.filter((f) => f.comparison && extractNumberTokens(f.display).some((x) => x.arrow === t.arrow && key(x.value) === key(t.value))).map((f) => f.comparison!.kind);
    if (factKinds.length > 0 && !factKinds.includes(prior.cls)) {
      add("baseline_mismatch", `${t.raw}은(는) ${factKinds[0]} 기준 값인데 문장은 ${String(prior.cls)} 기준처럼 씀`, text.slice(prior.start, t.end));
    }
  }

  // 본방·재방
  for (const t of tokens) {
    const sent = sentenceOf(sentences, t.start);
    if (!sent) continue;
    const said: AirType[] = [];
    if (AIR_MIXED.test(sent.text)) said.push("mixed");
    const stripped = sent.text.replace(AIR_MIXED, "");
    if (AIR_FIRST.test(stripped)) said.push("first_run");
    if (AIR_RERUN.test(stripped)) said.push("rerun");
    if (said.length === 0) continue;
    const owners = factsWithNumber(t.value).filter((f) => f.airType);
    if (owners.length === 0) continue;
    if (!owners.some((f) => said.includes(f.airType as AirType))) {
      add("airtype_mismatch", `${t.raw}은(는) ${owners[0].airType} 값인데 문장은 ${said.join("·")}로 설명함`, sent.text.trim().slice(0, 60));
    }
  }

  // 인과 단정
  if (!opts.allowCausal) {
    for (const s of sentences) {
      if (CAUSAL_RE.test(s.text) && !HEDGE_RE.test(s.text)) add("causal_claim", "관측을 원인으로 단정함(헤지 표현 없음)", s.text.trim().slice(0, 60));
    }
  }

  // 구성비 근거 없는 시청층 단정
  if (!allowed.hasComposition && COMPOSITION_RE.test(text)) add("composition_without_data", "구성비 자료 없이 핵심 시청층·구성을 단정함", text.match(COMPOSITION_RE)?.[0]);

  // 여러 집단이 평균 미만인데 한 집단만
  if ((opts.belowAverageGroupCount ?? 0) > 1 && SINGLE_GROUP_RE.test(text)) add("single_group_claim", `평균 미만 집단이 ${opts.belowAverageGroupCount}개인데 한 집단만 있는 것처럼 씀`, text.match(SINGLE_GROUP_RE)?.[0]);

  // 출처 없는 Fact에만 근거한 숫자
  for (const id of matchedIds) {
    const f = facts.find((x) => x.id === id);
    if (f && !f.provenance.source) add("unsourced_fact", `출처가 없는 사실(${id})을 인용함`, id);
  }

  return { ok: violations.length === 0, violations, matchedFactIds: [...matchedIds] };
}

/** 문장·액션이 인용했다고 주장하는 Fact ID가 실제로 허용된 Fact인지. */
export function verifyReferences(ids: string[], facts: Fact[]): Violation[] {
  const known = new Set(facts.map((f) => f.id));
  return ids.filter((id) => !known.has(id)).map((id) => ({ code: "unknown_reference" as const, detail: `허용되지 않은 참조 ID ${id}`, excerpt: id }));
}

/**
 * 검증을 통과한 문장만 돌려준다. 통과하지 못하면 null — 호출부가 규칙 기반 문구로 대체한다.
 * 거부 사유(코드)는 로그에 남겨 어떤 규칙이 얼마나 자주 막는지 볼 수 있게 한다(문장 본문은 남기지 않는다).
 */
export function acceptNarrative(text: string | null | undefined, facts: Fact[], opts: GuardOptions & { label?: string } = {}): string | null {
  const t = text?.trim();
  if (!t) return null;
  const r = guardNarrative(t, facts, opts);
  if (r.ok) return t;
  console.warn(`[narrativeGuard] ${opts.label ?? "narrative"} 문장 폐기: ${[...new Set(r.violations.map((v) => v.code))].join(",")}`);
  return null;
}

/** AI 문장을 쓸 수 없을 때의 사실 기반 대체 문구(숫자는 전부 Fact 표시값). */
export function factTemplate(facts: Fact[], opts: { max?: number } = {}): string {
  return facts
    .filter((f) => f.display && f.display !== "—")
    .slice(0, opts.max ?? 4)
    .map((f) => `${f.context} ${f.display}`)
    .join(" · ");
}
