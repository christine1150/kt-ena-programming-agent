// 단계 15 — 지표 표기 공통 모듈. 숫자 정렬·천 단위·음수·소수점·극소값·시청률 단위·시간(분·초)·결측을 한 곳에서 정한다.
// 기존 구현(시청률 반올림 audienceReport/format.ts, 변화량·시간 metrics/delta.ts)은 그대로 두고 여기서 다시 내보낸다 —
// LLM 서술이 쓰는 formatRating의 기존 결과("0")는 바꾸지 않는다. 화면에서 극소값을 구분해 보여줄 때는 formatRatingValue를 쓴다.
import { formatPercent, formatRating, ratingDecimals, roundRating } from "@/lib/audienceReport/format";
import { formatArrowChange, formatArrowPct, formatDurationClock, formatDurationKo, formatRatingDelta, formatRelativeChange, computeDelta } from "@/lib/metrics/delta";

export { formatPercent, formatRating, ratingDecimals, roundRating, formatArrowChange, formatArrowPct, formatDurationClock, formatDurationKo, formatRatingDelta, formatRelativeChange, computeDelta };

/** 결측 표기 — 0과 구분한다(0은 관측값, 빈 값은 결측) */
export const MISSING = "—";
/** 음수 부호: 하이픈이 아니라 수학 빼기 기호(숫자 앞에서 줄바꿈되지 않고 정렬이 맞는다) */
export const MINUS = "−";

const isMissing = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v as number);

const ko = new Intl.NumberFormat("ko-KR");

/** 정수(천 단위 쉼표). 음수는 수학 빼기 기호. */
export function formatInt(v: number | null | undefined): string {
  if (isMissing(v)) return MISSING;
  const r = Math.round(v);
  return r < 0 ? `${MINUS}${ko.format(Math.abs(r))}` : ko.format(r);
}

/** 소수 digits자리(천 단위 쉼표). 반올림하면 0이 되는 음수는 "−0.0"이 아니라 "0.0". */
export function formatDecimal(v: number | null | undefined, digits = 1): string {
  if (isMissing(v)) return MISSING;
  const fixed = Math.abs(v).toFixed(digits);
  const [i, f] = fixed.split(".");
  const body = f ? `${ko.format(Number(i))}.${f}` : ko.format(Number(i));
  return v < 0 && Number(fixed) !== 0 ? `${MINUS}${body}` : body;
}

/** 부호를 항상 붙이는 표기(+1.2 / −1.2 / 0.0) — 변화량 표에서 열 정렬용 */
export function formatSigned(v: number | null | undefined, digits = 1): string {
  if (isMissing(v)) return MISSING;
  const fixed = Number(Math.abs(v).toFixed(digits));
  if (fixed === 0) return Number(0).toFixed(digits);
  return `${v > 0 ? "+" : MINUS}${formatDecimal(Math.abs(v), digits)}`;
}

/** 퍼센트 값(이미 % 단위인 값). 점유율·도달률·시청시간 비율은 소수 2자리가 기존 관례다. */
export function formatPct(v: number | null | undefined, digits = 2): string {
  if (isMissing(v)) return MISSING;
  return `${formatDecimal(v, digits)}%`;
}

/**
 * 시청률 값(% 단위, ×100 금지). 일반 채널 3자리, skyUHD 5자리.
 * 0은 "0", 0보다 큰데 자릿수에서 0이 되는 극소값은 "<0.001"처럼 구분해 보여준다(결측은 "—").
 */
export function formatRatingValue(v: number | null | undefined, channelCode: string, opts: { unit?: boolean } = {}): string {
  if (isMissing(v)) return MISSING;
  const digits = ratingDecimals(channelCode);
  const fixed = v.toFixed(digits);
  const unit = opts.unit ? "%" : "";
  if (Number(fixed) === 0) {
    if (v === 0) return `0${unit}`;
    return v > 0 ? `<${(10 ** -digits).toFixed(digits)}${unit}` : `${MINUS}<${(10 ** -digits).toFixed(digits)}${unit}`;
  }
  return `${formatDecimalKeep(v, digits)}${unit}`;
}

/** formatDecimal과 같지만 자릿수를 그대로 둔다(0.800 → "0.800") */
function formatDecimalKeep(v: number, digits: number): string {
  return formatDecimal(v, digits);
}

/** 순위(정수). 기간 평균 순위처럼 소수가 있으면 digits를 준다. */
export function formatRank(v: number | null | undefined, digits = 0): string {
  if (isMissing(v)) return MISSING;
  return `${digits === 0 ? formatInt(v) : formatDecimal(v, digits)}위`;
}

/** 지수(기준 100) — 퍼센트가 아니다 */
export function formatIndex(v: number | null | undefined): string {
  if (isMissing(v)) return MISSING;
  return formatDecimal(v, 1);
}

export type MetricKey = "rating" | "share" | "reach" | "timeSpentRatio" | "timeSpent" | "rank" | "index" | "airings";

/** 지표 이름·단위·자릿수(사용자 문구 기준). 원본 컬럼명은 출처 패널에서만 보인다. */
export const METRIC_META: Record<MetricKey, { label: string; unit: string; digits: number; note: string }> = {
  rating: { label: "시청률", unit: "%", digits: 3, note: "순간 평균. skyUHD만 5자리" },
  share: { label: "점유율", unit: "%", digits: 2, note: "같은 시간 TV 시청 중 비중" },
  reach: { label: "도달률", unit: "%", digits: 2, note: "한 번이라도 본 사람의 비율" },
  timeSpentRatio: { label: "시청시간 비율", unit: "%", digits: 2, note: "공급자 정의 그대로(합산·평균 금지)" },
  timeSpent: { label: "1인당 시청시간", unit: "분·초", digits: 0, note: "초 단위 값을 분·초로 표기" },
  rank: { label: "순위", unit: "위", digits: 0, note: "순위 종류·타깃·기간을 옆에 표기" },
  index: { label: "지수", unit: "", digits: 1, note: "기준 100, 퍼센트가 아님" },
  airings: { label: "방송 횟수", unit: "회", digits: 0, note: "패널 표본 수가 아님" },
};

export function formatMetric(key: MetricKey, v: number | null | undefined, opts: { channelCode?: string; unit?: boolean } = {}): string {
  switch (key) {
    case "rating":
      return formatRatingValue(v, opts.channelCode ?? "", { unit: opts.unit });
    case "share":
    case "reach":
    case "timeSpentRatio":
      return opts.unit === false ? formatDecimal(v, METRIC_META[key].digits) : formatPct(v, METRIC_META[key].digits);
    case "timeSpent":
      return formatDurationKo(v);
    case "rank":
      return formatRank(v);
    case "index":
      return formatIndex(v);
    case "airings":
      return isMissing(v) ? MISSING : `${formatInt(v)}회`;
  }
}

/** 표 셀용: 숫자 열은 오른쪽 정렬·고정폭 숫자(tabular-nums)를 함께 쓴다 */
export const NUMERIC_CELL_CLASS = "text-right tabular-nums";
