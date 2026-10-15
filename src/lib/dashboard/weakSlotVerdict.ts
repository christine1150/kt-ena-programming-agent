// 약해진 자리 판정(순수 함수) — 2026-10-15 사용자 요청: "일시적 하락과 지속적 부진을 별개 문구로 만들지 말고, 먼저 하나의 일관된 판정을 산출한 뒤
// 문장은 그 결과만 쓴다". 수치(오늘·중앙값·기준선·낮은 회차 수)와 판정(status), 근거 문장이 모두 같은 입력에서 한 번에 나온다.
// 임계값은 새로 만들지 않고 weakSlotRemedy가 이미 쓰던 값을 그대로 옮겼다(아래 WEAK_VERDICT_CONFIG의 근거 주석).
// DB 접근 없음 — 호출하는 쪽이 같은 자리의 직전 방영 시청률(최신순, 오늘 제외)을 넘긴다.

export const WEAK_VERDICT_CONFIG = {
  /** 기준선 = 같은 자리 중앙값 × 0.8 — weakSlotRemedy의 기존 dropLine과 같다 */
  dropRatio: 0.8,
  /** 오늘이 기준선 미만이 아니어도 '낮다'고 보는 하한: 중앙값 대비 −20% — 기존 `dev <= -0.2`와 같다 */
  lowDeviation: -0.2,
  /** 비교 표본이 이 값 미만이면 판정하지 않는다 — 기존 `prior.length >= 3`과 같다 */
  minSample: 3,
  /** 지속적 부진은 비교 창(최근 8회)이 모두 채워졌을 때만 — 기존 최근 8회 창과 같다 */
  persistentMinSample: 8,
  /**
   * 지속적 부진: 최근 절반(4회)의 과반이 '그 이전 절반(4회)의 기준선' 아래로 내려앉아 있을 때. 같은 자리 전체 중앙값은 부진이 길어지면 그 부진을 따라 내려가므로
   * (전체 8회 중앙값 기준으로는 과반이 기준선 아래일 수 없다) 이전 구간을 기준으로 삼는다. 0.8·과반(>0.5)·8회 창은 모두 기존 값이고, 4회는 그 창의 절반이다.
   */
  persistentLowShare: 0.5,
  persistentRecent: 4,
} as const;

export type WeakStatus = "transient" | "short_persist" | "persistent" | "hold" | "not_low";

export interface WeakVerdict {
  status: WeakStatus;
  /** hold인 이유(표본 부족·중앙값 0·오늘 값 없음·과거에도 낮은 회차가 섞임) */
  holdReason: "thin_sample" | "median_zero" | "today_missing" | "mixed_history" | null;
  today: number | null;
  /** 유효한(결측 제외) 비교 표본 수 */
  sampleCount: number;
  /** 결측(null·NaN)이라 비교에서 뺀 회차 수 */
  missingCount: number;
  median: number | null;
  /** 오늘 ÷ 중앙값 × 100 (중앙값이 없거나 0이면 null — 0%로 대체하지 않는다) */
  ratioPct: number | null;
  dropLine: number | null;
  /** 직전 방영 중 기준선 미만 회차 수(오늘 제외) */
  lowCount: number;
  /** 직전 방영이 기준선 미만이었나(null=직전 값 없음) */
  prevLow: boolean | null;
  /** 지속적 부진 판정에 쓴 구간 비교(표본 8회 미만이면 null) — 최근 구간 중 이전 구간 기준선 아래 회차 수 */
  levelShift: { olderMedian: number; olderLine: number; olderN: number; recentN: number; recentLow: number } | null;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * @param today 오늘 방영 시청률(실제 0은 0으로 유효, 없으면 null/NaN)
 * @param priorNewestFirst 같은 자리 직전 방영 시청률(최신순, 오늘 제외). null·NaN은 결측으로 보고 뺀다
 */
export function judgeWeakSlot(today: number | null | undefined, priorNewestFirst: (number | null | undefined)[]): WeakVerdict {
  const cfg = WEAK_VERDICT_CONFIG;
  const prior = priorNewestFirst.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const base = { sampleCount: prior.length, missingCount: priorNewestFirst.length - prior.length, today: typeof today === "number" && Number.isFinite(today) ? today : null };
  const none = { median: null, ratioPct: null, dropLine: null, lowCount: 0, prevLow: null, levelShift: null };
  if (base.today === null) return { ...base, ...none, status: "hold", holdReason: "today_missing" };
  if (prior.length < cfg.minSample) return { ...base, ...none, status: "hold", holdReason: "thin_sample" };
  const med = median(prior);
  if (med === null || med <= 0) return { ...base, ...none, median: med, status: "hold", holdReason: "median_zero" };
  const dropLine = med * cfg.dropRatio;
  const lowCount = prior.filter((v) => v < dropLine).length;
  const prevLow = prior[0] < dropLine;
  let levelShift: WeakVerdict["levelShift"] = null;
  if (prior.length >= cfg.persistentMinSample) {
    const recent = prior.slice(0, cfg.persistentRecent);
    const older = prior.slice(cfg.persistentRecent, cfg.persistentRecent * 2);
    const olderMedian = median(older);
    if (olderMedian !== null && olderMedian > 0) {
      const olderLine = olderMedian * cfg.dropRatio;
      levelShift = { olderMedian, olderLine, olderN: older.length, recentN: recent.length, recentLow: recent.filter((v) => v < olderLine).length };
    }
  }
  const common = { ...base, median: med, ratioPct: (base.today / med) * 100, dropLine, lowCount, prevLow, levelShift };
  // 부동소수 오차로 경계(정확히 −20%)가 뒤집히지 않게 비율이 아니라 곱한 값끼리 비교한다
  if (base.today > med * (1 + cfg.lowDeviation)) return { ...common, status: "not_low", holdReason: null };
  if (levelShift && base.today < levelShift.olderLine && levelShift.recentLow / levelShift.recentN > cfg.persistentLowShare) return { ...common, status: "persistent", holdReason: null };
  if (prevLow) return { ...common, status: "short_persist", holdReason: null };
  if (lowCount === 0) return { ...common, status: "transient", holdReason: null };
  return { ...common, status: "hold", holdReason: "mixed_history" };
}

export const STATUS_KO: Record<WeakStatus, string> = {
  transient: "일시적 하락 가능성",
  short_persist: "단기 부진 지속",
  persistent: "지속적 부진 가능성",
  hold: "판단 보류",
  not_low: "기준선 위",
};

/** 시청률 표기(weakSlotRemedy의 fmt와 같은 자릿수 규칙) */
export const fmtRating = (v: number) => (v >= 0.01 ? v.toFixed(3) : v.toFixed(4));

export interface VerdictBasis {
  /** 비교한 직전 방영 수 */
  n: number;
  /** 그 중 이 프로그램 자신의 방영 수(같은 자리 비교가 3회 미만이라 시간대 전체로 넓혔을 때만 n보다 작다) */
  ownCount: number;
  /** 이 프로그램 자신의 방영 중 기준선 미만 회차 수 */
  ownLowCount: number;
}

/** "같은 요일·시간대 최근 8회(이 프로그램 2회·다른 프로그램 6회)" 같은 비교 대상 설명 */
export function basisLabel(b: VerdictBasis, short = false): string {
  const head = `같은 요일·시간대 최근 ${b.n}회`;
  if (b.ownCount >= b.n) return head;
  if (short) return `${head}(이 프로그램 ${b.ownCount}회 포함)`;
  return b.ownCount === 0 ? `${head}(모두 다른 프로그램 방영분)` : `${head}(이 프로그램 ${b.ownCount}회·다른 프로그램 ${b.n - b.ownCount}회)`;
}

/**
 * 판정 → 근거 문장 한 줄. 판정과 모순되는 표현은 이 함수 밖에서 덧붙이지 않는다.
 * hold(표본 부족·중앙값 0)와 not_low는 호출하는 쪽이 따로 문장을 만들므로 null.
 */
export function verdictCause(v: WeakVerdict, b: VerdictBasis): string | null {
  if (v.dropLine === null) return null;
  const line = fmtRating(v.dropLine);
  const own = b.ownCount >= b.n ? "" : b.ownCount === 0 ? " 비교한 방영은 모두 다른 프로그램 방영분입니다." : ` 이 프로그램 방영분은 ${b.ownCount}회 중 ${b.ownLowCount}회가 기준선 아래입니다.`;
  switch (v.status) {
    case "transient":
      return `${basisLabel(b, true)}가 모두 기준선(${line}) 이상이고 이번만 낮아 일시적 하락 가능성이 있습니다.`;
    case "short_persist":
      return `최근 ${v.sampleCount}회 중 ${v.lowCount}회(직전 방영 포함)가 기준선(${line}) 아래라 단기 부진이 이어지는 중입니다.${own}`;
    case "persistent":
      {
      const ls = v.levelShift;
      return ls ? `최근 ${ls.recentN}회 중 ${ls.recentLow}회가 그 이전 ${ls.olderN}회 기준선(${fmtRating(ls.olderLine)}) 아래로 내려앉아 지속적 부진 가능성이 있습니다.${own}` : null;
    }
    case "hold":
      return `최근 ${v.sampleCount}회 중 ${v.lowCount}회가 기준선(${line}) 아래였지만 직전 방영은 정상이라 일시적 하락인지 지속인지 판단하기 어렵습니다.${own}`;
    default:
      return null;
  }
}
