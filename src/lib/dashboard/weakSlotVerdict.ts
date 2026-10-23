// 약해진 자리 판정(순수 함수) — 2026-10-15 사용자 요청: "일시적 하락과 지속적 부진을 별개 문구로 만들지 말고, 먼저 하나의 일관된 판정을 산출한 뒤
// 문장은 그 결과만 쓴다". 수치(오늘·최근 평균·중앙값·기준선)와 판정(status), 근거 문장이 모두 같은 입력에서 한 번에 나온다.
// 2026-10-23 기준 변경(사용자 승인, docs/agent-improvement/SKILL_BASELINE.md §3·§4 제안 1): 기존 "오늘 ≤ 직전 8회 중앙값 × 0.8"은 편성을 바꾸지 않은
// 평상시에도 38~71% 울렸다. 그래서 방영 한 편이 아니라 최근 N회 평균으로 보고, 기준선은 채널마다 "편성을 그대로 둔 자리가 10번에 1번 내려가는 선"으로 둔다.
// 값은 scripts/skill-baseline/weak-calibrate.mts가 2025-01~2026-03 자료로 고르고 2026-04~10 자료로 검증했다(WEAK_SLOT_RULES의 근거 주석).
// DB 접근 없음 — 호출하는 쪽이 같은 자리의 직전 방영 시청률(최신순, 오늘 제외)을 넘긴다.

export const WEAK_VERDICT_CONFIG = {
  /** 비교 회차(최근 창 앞의 방영)가 이 값 미만이면 판정하지 않는다 — 기존 `prior.length >= 3`과 같다 */
  minSample: 3,
  /** 비교 회차 최대 수 — 기존 최근 8회 창과 같다 */
  baseTake: 8,
} as const;

/** 채널별 판정 규칙: 최근 window회 평균(오늘 포함)이 그 앞 비교 회차 중앙값 × line 아래면 '낮음' */
export interface WeakSlotRule {
  window: 2 | 4;
  line: number;
}

/**
 * 보정 구간(2025-01~2026-03) 평상시(같은 프로그램이 같은 자리에 7일 간격으로 이어짐) "최근 평균 ÷ 비교 중앙값"의 10%선을 0.05 단위로 반올림했다.
 * 괄호는 보정 사례 수 → 검증 구간(2026-04~10)에서 그 선 아래로 내려간 비율.
 * ENA Drama·ENA Play는 한 편·2회 평균의 10%선이 0배 근처(한 편 ×0.00·×0.02)라 4회 평균만 쓴다. 두 채널 각각의 4회 사례가 적어(5·58건) 둘을 합쳐 같은 선을 쓴다.
 * skyUHD는 보완 제안 자체가 없다(프로그램 단위 타깃 없음) — 같은 저시청 규칙을 둔다.
 */
export const WEAK_SLOT_RULES: Record<string, WeakSlotRule> = {
  ENA: { window: 2, line: 0.45 }, // 296건 → 검증 12%
  ENA_DRAMA: { window: 4, line: 0.55 }, // 두 채널 합산 63건 → 검증 14%(22건)
  ENA_PLAY: { window: 4, line: 0.55 }, // 두 채널 합산 63건 → 검증 13%(31건)
  ENA_STORY: { window: 2, line: 0.45 }, // 139건 → 검증 10%
  OLIFE: { window: 2, line: 0.55 }, // 353건 → 검증 6%
  ONCE: { window: 2, line: 0.6 }, // 73건 → 검증 19%(27건, 표본 적음)
  SKYUHD: { window: 4, line: 0.55 },
};
/** 규칙이 없는 채널 — 2회 평균 선 중 가장 낮은(보수적인) 값 */
export const DEFAULT_WEAK_SLOT_RULE: WeakSlotRule = { window: 2, line: 0.45 };
export const weakSlotRuleFor = (channelCode: string): WeakSlotRule => WEAK_SLOT_RULES[channelCode] ?? DEFAULT_WEAK_SLOT_RULE;

export type WeakStatus = "transient" | "short_persist" | "persistent" | "hold" | "not_low";

export interface WeakVerdict {
  status: WeakStatus;
  /** hold인 이유(표본 부족·중앙값 0·오늘 값 없음) */
  holdReason: "thin_sample" | "median_zero" | "today_missing" | null;
  today: number | null;
  /** 판정 창(최근 몇 회 평균인지, 오늘 포함) */
  window: number;
  /** 최근 window회 평균(오늘 포함) */
  level: number | null;
  /** 유효한(결측 제외) 직전 방영 수(최근 창 몫 포함) */
  sampleCount: number;
  /** 비교 회차 수(최근 창 앞의 방영, 최대 8) */
  baseCount: number;
  /** 결측(null·NaN)이라 비교에서 뺀 회차 수 */
  missingCount: number;
  /** 비교 회차 중앙값 */
  median: number | null;
  /** 최근 평균 ÷ 중앙값 × 100 (중앙값이 없거나 0이면 null — 0%로 대체하지 않는다) */
  ratioPct: number | null;
  /** 기준선 = 중앙값 × 채널 line */
  dropLine: number | null;
  line: number;
  /** 비교 회차 중 기준선 미만 회차 수 */
  lowCount: number;
  /** 한 회 앞에서 같은 방식으로 본 판정도 기준선 아래였나(null=그 판정을 할 표본 없음) */
  prevLow: boolean | null;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * @param today 오늘 방영 시청률(실제 0은 0으로 유효, 없으면 null/NaN)
 * @param priorNewestFirst 같은 자리 직전 방영 시청률(최신순, 오늘 제외). null·NaN은 결측으로 보고 뺀다. 최근 창 몫(window−1)과 비교 회차 8회를 합친 만큼 넘긴다
 * @param rule 채널 규칙(weakSlotRuleFor). 없으면 DEFAULT_WEAK_SLOT_RULE
 */
export function judgeWeakSlot(today: number | null | undefined, priorNewestFirst: (number | null | undefined)[], rule: WeakSlotRule = DEFAULT_WEAK_SLOT_RULE): WeakVerdict {
  const cfg = WEAK_VERDICT_CONFIG;
  const prior = priorNewestFirst.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const t = typeof today === "number" && Number.isFinite(today) ? today : null;
  const k = rule.window - 1;
  const baseList = prior.slice(k, k + cfg.baseTake);
  const base = { window: rule.window, line: rule.line, sampleCount: prior.length, baseCount: baseList.length, missingCount: priorNewestFirst.length - prior.length, today: t };
  const none = { level: null, median: null, ratioPct: null, dropLine: null, lowCount: 0, prevLow: null };
  if (t === null) return { ...base, ...none, status: "hold", holdReason: "today_missing" };
  if (prior.length < k || baseList.length < cfg.minSample) return { ...base, ...none, status: "hold", holdReason: "thin_sample" };
  const med = median(baseList);
  if (med === null || med <= 0) return { ...base, ...none, median: med, status: "hold", holdReason: "median_zero" };
  const level = mean([t, ...prior.slice(0, k)]);
  const dropLine = med * rule.line;
  // 한 회 앞의 판정: 직전 방영까지의 최근 window회 평균 vs 그 앞 비교 회차 중앙값
  const prevBase = prior.slice(rule.window, rule.window + cfg.baseTake);
  const prevMed = prior.length >= rule.window && prevBase.length >= cfg.minSample ? median(prevBase) : null;
  const prevLow = prevMed !== null && prevMed > 0 ? mean(prior.slice(0, rule.window)) < prevMed * rule.line : null;
  const common = { ...base, level, median: med, ratioPct: (level / med) * 100, dropLine, lowCount: baseList.filter((v) => v < dropLine).length, prevLow };
  if (level >= dropLine) return { ...common, status: t < dropLine ? "transient" : "not_low", holdReason: null };
  return { ...common, status: prevLow ? "persistent" : "short_persist", holdReason: null };
}

export const STATUS_KO: Record<WeakStatus, string> = {
  transient: "오늘은 낮지만 평균은 평소 범위",
  short_persist: "단기 부진",
  persistent: "지속적 부진 가능성",
  hold: "판단 보류",
  not_low: "기준선 위(평소 흔들림 범위)",
};

/** 시청률 표기(weakSlotRemedy의 fmt와 같은 자릿수 규칙) */
export const fmtRating = (v: number) => (v >= 0.01 ? v.toFixed(3) : v.toFixed(4));

export interface VerdictBasis {
  /** 비교 회차 수 */
  n: number;
  /** 그 중 이 프로그램 자신의 방영 수(같은 자리 비교가 3회 미만이라 시간대 전체로 넓혔을 때만 n보다 작다) */
  ownCount: number;
  /** 이 프로그램 자신의 방영 중 기준선 미만 회차 수 */
  ownLowCount: number;
}

/** "같은 요일·시간대 그 앞 8회(이 프로그램 2회·다른 프로그램 6회)" 같은 비교 대상 설명 */
export function basisLabel(b: VerdictBasis, short = false): string {
  const head = `같은 요일·시간대 그 앞 ${b.n}회`;
  if (b.ownCount >= b.n) return head;
  if (short) return b.ownCount === 0 ? `${head}(모두 다른 프로그램 방영분)` : `${head}(이 프로그램 ${b.ownCount}회 포함)`;
  return b.ownCount === 0 ? `${head}(모두 다른 프로그램 방영분)` : `${head}(이 프로그램 ${b.ownCount}회·다른 프로그램 ${b.n - b.ownCount}회)`;
}

/** "최근 2회 평균 0.031" — 판정에 쓴 수준 */
export const levelLabel = (v: WeakVerdict) => (v.level === null ? "" : `최근 ${v.window}회 평균 ${fmtRating(v.level)}`);

/** 기준선의 뜻 — 문장 끝에 한 번 붙인다 */
export const lineNote = (v: WeakVerdict) => `기준선은 이 채널에서 편성을 그대로 둔 자리도 10번에 1번은 내려가는 수준(중앙값의 ${Math.round(v.line * 100)}%)입니다`;

/**
 * 판정 → 근거 문장 한 줄. 판정과 모순되는 표현은 이 함수 밖에서 덧붙이지 않는다.
 * hold(표본 부족·중앙값 0)는 호출하는 쪽이 따로 문장을 만들므로 null.
 */
export function verdictCause(v: WeakVerdict, b: VerdictBasis): string | null {
  if (v.dropLine === null || v.median === null || v.level === null) return null;
  const line = fmtRating(v.dropLine);
  // 수치(오늘·평균·중앙값)는 호출하는 쪽 문장에 이미 있으므로 여기서는 판정만 말한다(같은 숫자 되풀이 방지). 비교 회차 구성은 판정과 함께 밝힌다
  const avg = `최근 ${v.window}회 평균`;
  const own = b.ownCount >= b.n ? "" : b.ownCount === 0 ? " 비교한 방영은 모두 다른 프로그램 방영분입니다." : ` 비교한 ${b.n}회 중 이 프로그램 방영분은 ${b.ownCount}회(그중 ${b.ownLowCount}회가 기준선 아래)입니다.`;
  switch (v.status) {
    case "not_low":
      return `${avg}이 평소 흔들림 범위(기준선 ${line}) 안입니다.${own}`;
    case "transient":
      return `오늘은 기준선(${line}) 아래지만 ${avg}은 평소 흔들림 범위 안입니다. 한 편만으로는 부진을 판단할 수 없어 다음 방영을 넣어 다시 봅니다.${own}`;
    case "short_persist":
      return `${avg}이 평소 흔들림 범위(기준선 ${line}) 아래입니다.${own}`;
    case "persistent":
      return `${avg}이 한 회 앞 판정에 이어 이번에도 기준선(${line}) 아래라 지속적 부진 가능성이 있습니다.${own}`;
    default:
      return null;
  }
}
