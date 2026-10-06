// 채널 화면의 기간 프리셋 → API 쿼리 변환(단계 07) — ChannelDeepDive 안에 인라인으로 있던 계산을 그대로 꺼내 순수 함수로 만들었다.
// 값·분기는 이전과 같다(오늘이거나 최신 수신일을 아직 모르면 서버가 최신일을 고르게 비워 둔다). 다른 점은 두 가지다:
//  ① "직접 선택"은 최신 수신일을 몰라도 URL의 시작·종료일만으로 계산한다(URL로 들어온 첫 요청이 한 번에 끝나게)
//  ② 화면과 요청 함수가 같은 함수를 써서 기간이 두 곳에서 다르게 계산되지 않는다.
import {
  COMPARISON_LABELS,
  COMPARISON_PRESETS,
  computePeriodPreset,
  SDOW_PRESETS,
  SDOW_WEEKS_BACK,
  type PeriodPreset,
} from "@/lib/audienceReport/periodPresets";

export interface ChannelPeriodArgs {
  preset: PeriodPreset;
  customFrom: string;
  customTo: string;
  /** 동요일 프리셋에서 고른 요일. null = 기준일의 요일에 자동 매칭 */
  selectedDow: number | null;
  /** 지금까지 알려진 최신 수신일(모르면 null) */
  latest: string | null;
}

export interface ChannelPeriod {
  selectedDateFrom: string | null;
  selectedDateTo: string | null;
  selectedPriorFrom: string | null;
  selectedPriorTo: string | null;
  isSdowActive: boolean;
  isComparisonPreset: boolean;
  comparisonLabel: string | null;
  effectiveDow: number | null;
  sdowWeeksBack: number | null;
  dateQuery: string;
  priorQuery: string;
  sdowQuery: string;
  fitScoreDateQuery: string;
}

export function deriveChannelPeriod(a: ChannelPeriodArgs): ChannelPeriod {
  let selectedDateFrom: string | null = null;
  let selectedDateTo: string | null = null;
  let selectedPriorFrom: string | null = null;
  let selectedPriorTo: string | null = null;
  if (a.preset !== "today") {
    const canCompute = a.preset === "custom" || !!a.latest;
    if (canCompute) {
      const range = computePeriodPreset(a.latest ?? "", a.preset, a.customFrom, a.customTo);
      selectedDateFrom = range?.from ?? null;
      selectedDateTo = range?.to ?? null;
      selectedPriorFrom = range?.priorFrom ?? null;
      selectedPriorTo = range?.priorTo ?? null;
    }
  }
  const isSdowActive = SDOW_PRESETS.has(a.preset);
  const effectiveDow =
    a.selectedDow ?? (selectedDateTo ? new Date(`${selectedDateTo}T00:00:00`).getDay() : a.latest ? new Date(`${a.latest}T00:00:00`).getDay() : null);
  const sdowWeeksBack = SDOW_WEEKS_BACK[a.preset] ?? null;
  return {
    selectedDateFrom,
    selectedDateTo,
    selectedPriorFrom,
    selectedPriorTo,
    isSdowActive,
    isComparisonPreset: COMPARISON_PRESETS.has(a.preset),
    comparisonLabel: COMPARISON_LABELS[a.preset] ?? null,
    effectiveDow,
    sdowWeeksBack,
    dateQuery: selectedDateFrom && selectedDateTo ? `&dateFrom=${selectedDateFrom}&dateTo=${selectedDateTo}` : "",
    priorQuery: selectedPriorFrom && selectedPriorTo ? `&priorDateFrom=${selectedPriorFrom}&priorDateTo=${selectedPriorTo}` : "",
    sdowQuery: isSdowActive && effectiveDow !== null && sdowWeeksBack !== null ? `&sdowDow=${effectiveDow}&sdowWeeks=${sdowWeeksBack}` : "",
    fitScoreDateQuery: selectedDateTo ? `&date=${selectedDateTo}` : "",
  };
}
