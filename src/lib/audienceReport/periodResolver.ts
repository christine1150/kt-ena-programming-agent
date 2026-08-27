// Phase 1(2026-08-28, Audience Intelligence Report 계획서 J절 2번) — 설계서 §06의 4개 기간 모드를
// 하나의 정규화된 형태로 합친다. 이후 모든 레이어(dataCollector 등)는 원본 모드가 뭐였는지 몰라도
// dateFrom/dateTo(+priorDateFrom/priorDateTo)만 보면 동작하도록 한다.
//
// MODE A(하루)/B(시작~끝)는 사용자가 고른 날짜를 그대로 정규화하고, MODE C(기간 A vs 기간 B)는
// 사용자가 지정한 두 개의 임의 구간을 그대로 받는다(computePeriodPreset의 비교 프리셋 — DoD/WoW/
// MoM/QoQ/YoY — 과는 다르다: 그건 "오늘 기준 자동 계산"이고 MODE C는 "사용자가 두 구간을 각각
// 직접 지정"). MODE D(누적·트레일링·주기비교)는 이미 검증된 periodPresets.ts의
// computePeriodPreset()을 그대로 재사용한다(계획서 1번 항목).
import { computePeriodPreset, addDaysStr, PERIOD_PRESET_LABELS, COMPARISON_LABELS, type PeriodPreset } from "./periodPresets";

// 기간 길이(일수)를 세어 "직전 동일 길이 기간"을 계산한다 — dashboard/channel/route.ts의
// effectivePriorDateFrom/To(2026-08-20)와 같은 규칙(명시적 prior가 없으면 바로 앞 같은 길이 구간)을
// 그대로 재사용, 계산식만 addDaysStr 기반으로 정리했다(같은 결과, 다른 표현).
function priorEqualLengthRange(dateFrom: string, dateTo: string): { priorDateFrom: string; priorDateTo: string } {
  const lengthDays = Math.round((new Date(`${dateTo}T00:00:00`).getTime() - new Date(`${dateFrom}T00:00:00`).getTime()) / 86400000) + 1;
  const priorDateTo = addDaysStr(dateFrom, -1);
  const priorDateFrom = addDaysStr(dateFrom, -lengthDays);
  return { priorDateFrom, priorDateTo };
}

export type AudiencePeriodMode = "single_day" | "range" | "compare" | "cumulative";

export interface ResolvedAudiencePeriod {
  mode: AudiencePeriodMode;
  dateFrom: string;
  dateTo: string;
  // 4개 모드 전부 "직전 동일 길이 기간"(또는 MODE C는 사용자가 지정한 기간 B)을 자동 계산해
  // 채운다 — get_channel_period_program_movers 등 prior 날짜를 필수로 받는 RPC가 항상 값을
  // 받을 수 있도록 null을 허용하지 않는다.
  priorDateFrom: string;
  priorDateTo: string;
  label: string;
  comparisonLabel: string | null;
}

/** MODE A — 하루. priorDateFrom/To는 전일(직전 동일 길이=하루) — get_channel_period_program_movers
 *  등 일부 RPC가 prior 날짜를 필수로 받기 때문에 단일 일자에서도 채워준다. */
export function resolveSingleDay(date: string): ResolvedAudiencePeriod {
  const { priorDateFrom, priorDateTo } = priorEqualLengthRange(date, date);
  return { mode: "single_day", dateFrom: date, dateTo: date, priorDateFrom, priorDateTo, label: date, comparisonLabel: "전일" };
}

/** MODE B — 시작일~끝일(임의 구간). priorDateFrom/To는 "직전 동일 길이 기간"을 자동 계산해
 *  채운다(get_rating_period_report의 prior_period_change_pct 등이 이 값을 그대로 쓴다). */
export function resolveRange(dateFrom: string, dateTo: string): ResolvedAudiencePeriod {
  const [from, to] = dateFrom <= dateTo ? [dateFrom, dateTo] : [dateTo, dateFrom];
  const { priorDateFrom, priorDateTo } = priorEqualLengthRange(from, to);
  return { mode: "range", dateFrom: from, dateTo: to, priorDateFrom, priorDateTo, label: `${from} ~ ${to}`, comparisonLabel: "직전 동일 길이 기간" };
}

/** MODE C — 기간 A vs 기간 B(사용자가 두 구간을 각각 직접 지정). */
export function resolveCompare(dateFrom: string, dateTo: string, priorDateFrom: string, priorDateTo: string): ResolvedAudiencePeriod {
  const [from, to] = dateFrom <= dateTo ? [dateFrom, dateTo] : [dateTo, dateFrom];
  const [pFrom, pTo] = priorDateFrom <= priorDateTo ? [priorDateFrom, priorDateTo] : [priorDateTo, priorDateFrom];
  return {
    mode: "compare",
    dateFrom: from,
    dateTo: to,
    priorDateFrom: pFrom,
    priorDateTo: pTo,
    label: `${from} ~ ${to}`,
    comparisonLabel: `${pFrom} ~ ${pTo}`,
  };
}

/** MODE D — 누적·트레일링·주기비교(WTD/MTD/QTD/YTD/last7/last30/DoD/WoW/MoM/QoQ/YoY/직접선택).
 *  latest는 데이터가 존재하는 최신 일자(오늘 기준이 아니라 실제 최신 적재일 — 기존 관례 그대로). */
export function resolveCumulative(latest: string, preset: PeriodPreset, customFrom = "", customTo = ""): ResolvedAudiencePeriod | null {
  const range = computePeriodPreset(latest, preset, customFrom, customTo);
  if (!range) return null;
  // WTD/MTD/QTD/YTD/last7/last30/직접선택은 computePeriodPreset이 priorFrom/priorTo를 계산해주지
  // 않는다(비교 프리셋 DoD~YoY만 계산해줌) — 그런 경우도 "직전 동일 길이 기간" 규칙으로 채워
  // get_channel_period_program_movers 등이 요구하는 필수 prior 파라미터를 항상 확보한다.
  const prior = range.priorFrom && range.priorTo ? { priorDateFrom: range.priorFrom, priorDateTo: range.priorTo } : priorEqualLengthRange(range.from, range.to);
  return {
    mode: "cumulative",
    dateFrom: range.from,
    dateTo: range.to,
    priorDateFrom: prior.priorDateFrom,
    priorDateTo: prior.priorDateTo,
    label: PERIOD_PRESET_LABELS[preset],
    comparisonLabel: COMPARISON_LABELS[preset] ?? "직전 동일 길이 기간",
  };
}
