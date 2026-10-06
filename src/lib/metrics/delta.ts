// 변화량 계산·표기(단계 02). 값의 차이(%p)와 상대 변화(%)를 분리하고, 원시 정밀도로 계산한 뒤 표시 단계에서만 반올림한다.
// 분모가 0이거나 극소일 때는 무한 증가율 대신 상태와 절대 변화를 돌려준다.

export type DeltaStatus = "ok" | "no_current" | "no_prior" | "prior_zero" | "prior_tiny";

export interface Delta {
  /** current − prior (원시 값, 시청률이면 %p) */
  absolute: number | null;
  /** (current − prior) / prior × 100, 기준값이 0·극소·결측이면 null */
  relativePct: number | null;
  status: DeltaStatus;
}

/** 시청률(%) 기준 극소값: 이보다 작은 기준값으로 나눈 상대 변화는 의미가 없어 산출하지 않는다. */
export const RATING_TINY_BASE = 0.001;

export function computeDelta(current: number | null | undefined, prior: number | null | undefined, opts: { tinyBase?: number } = {}): Delta {
  if (current === null || current === undefined || Number.isNaN(current)) return { absolute: null, relativePct: null, status: "no_current" };
  if (prior === null || prior === undefined || Number.isNaN(prior)) return { absolute: null, relativePct: null, status: "no_prior" };
  const absolute = current - prior;
  if (prior === 0) return { absolute, relativePct: null, status: "prior_zero" };
  const tiny = opts.tinyBase ?? RATING_TINY_BASE;
  if (Math.abs(prior) < tiny) return { absolute, relativePct: null, status: "prior_tiny" };
  return { absolute, relativePct: (absolute / prior) * 100, status: "ok" };
}

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

/** 시청률 차이(%p). 반올림하면 0이 되는데 실제로는 0이 아니면 자릿수를 늘리고, 그래도 안 되면 "미세 증가/감소". */
export function formatRatingDelta(absolute: number | null, opts: { digits?: number; maxDigits?: number } = {}): string {
  if (absolute === null || Number.isNaN(absolute)) return "—";
  const digits = opts.digits ?? 3;
  const maxDigits = opts.maxDigits ?? 5;
  if (absolute === 0) return "변동 없음";
  for (let d = digits; d <= maxDigits; d++) {
    const rounded = Number(Math.abs(absolute).toFixed(d));
    if (rounded !== 0) return `${sign(absolute)}${rounded.toFixed(d)}%p`;
  }
  return absolute > 0 ? "미세 증가" : "미세 감소";
}

/** 상대 변화(%). 산출 불가 상태는 이유를 말로 돌려준다(무한대·NaN 금지). */
export function formatRelativeChange(d: Delta, opts: { digits?: number } = {}): string {
  const digits = opts.digits ?? 1;
  if (d.status === "no_current" || d.status === "no_prior") return "비교 불가";
  if (d.status === "prior_zero") return d.absolute && d.absolute > 0 ? "신규(기준 0)" : "변동 없음(기준 0)";
  if (d.status === "prior_tiny") return "산출 불가(기준값 미미)";
  const v = d.relativePct as number;
  const rounded = Number(Math.abs(v).toFixed(digits));
  if (rounded === 0) return v === 0 ? "변동 없음" : v > 0 ? "미세 증가" : "미세 감소";
  return `${sign(v)}${rounded.toFixed(digits)}%`;
}

/** 방향 화살표 + 상대 변화. 반올림해서 0이 되는 값에 ▲0.0%를 붙이지 않는다. */
export function formatArrowChange(d: Delta, opts: { digits?: number } = {}): string {
  const text = formatRelativeChange(d, opts);
  if (d.status !== "ok") return text;
  if (text === "미세 증가" || text === "미세 감소" || text === "변동 없음") return text;
  const v = d.relativePct as number;
  return `${v > 0 ? "▲" : "▼"}${text.replace(/^[+−]/, "")}`;
}

/** 시청시간(초) → "N분 S초". 초를 먼저 정수로 반올림한 뒤 분·초로 나눠 "28분 60초"가 생기지 않게 한다. */
export function formatDurationKo(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

/** "M:SS" 압축 표기(표 전용). 같은 반올림 규칙. */
export function formatDurationClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 이미 계산된 상대 변화율(%)에 방향 화살표를 붙인다. 반올림하면 0이 되는 값은 "▲0.0%" 대신 "미세 증가/감소". */
export function formatArrowPct(pct: number | null | undefined, digits = 1): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return formatArrowChange({ absolute: pct, relativePct: pct, status: "ok" }, { digits });
}
