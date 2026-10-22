// 공식 하루 환산 배율(배율 v1) — 순수 함수. 승인 A6(2026-10-22), 근거 docs/ena-features/D2_DAILY_ALIGNMENT.md.
// "편성시간 가중 예상"은 프로그램 사이 빈 구간 때문에 닐슨 공식 채널 하루 값보다 약 6~9% 높다(상관 1.00).
// 예측 시점(데이터 마감)까지 알 수 있던 직전 28일의 "공식 ÷ 같은 날 실제 방영 편성시간 가중 집계" 중앙값을 곱해 공식 하루 값의 정의로 옮긴다.
// 원래 값은 그대로 두고 환산 값을 별도 이름으로 붙인다(공식 값과 같은 이름으로 바꿔 부르지 않는다).
import { pairStats } from "./dailyAlignment";
import type { PeriodForecast } from "./types";

export const OFFICIAL_SCALE_VERSION = "official-scale-v1";
export const OFFICIAL_SCALE_LABEL = "공식 하루 환산 예상(배율 v1, 직전 28일)";
export const OFFICIAL_SCALE_WINDOW_DAYS = 28;
/** 직전 28일 중 공식 값과 집계가 둘 다 있는 날이 이보다 적으면 배율을 만들지 않는다 */
export const OFFICIAL_SCALE_MIN_DAYS = 14;

export interface OfficialScale {
  version: typeof OFFICIAL_SCALE_VERSION;
  label: typeof OFFICIAL_SCALE_LABEL;
  /** 공식 ÷ 집계 중앙값. 근거가 모자라면 null(환산하지 않음) */
  ratio: number | null;
  /** 배율 계산에 쓴 날 수 */
  days: number;
  from: string;
  to: string;
  note: string;
}

export function officialScaleOf(pairs: { official: number | null; weighted: number | null }[], from: string, to: string): OfficialScale {
  const usable = pairs.filter((p): p is { official: number; weighted: number } => p.official !== null && p.weighted !== null && p.weighted > 0);
  const st = pairStats(usable.map((p) => ({ est: p.weighted, official: p.official })));
  const ok = usable.length >= OFFICIAL_SCALE_MIN_DAYS && st.medianRatio !== null;
  return {
    version: OFFICIAL_SCALE_VERSION,
    label: OFFICIAL_SCALE_LABEL,
    ratio: ok ? st.medianRatio : null,
    days: usable.length,
    from,
    to,
    note: ok
      ? `직전 ${OFFICIAL_SCALE_WINDOW_DAYS}일 중 ${usable.length}일의 공식 ÷ 실제 방영 편성시간 가중 집계 중앙값. 집계를 공식 정의로 옮기는 변환이며 예측 오차는 별도다.`
      : `공식 값과 집계가 함께 있는 날이 ${usable.length}일로 ${OFFICIAL_SCALE_MIN_DAYS}일 미만이라 환산하지 않았다.`,
  };
}

/** 하루(또는 기간) 예상에 배율을 곱한 값. 배율이 없거나 예상이 없으면 null. */
export function toOfficialEstimate(p: PeriodForecast, s: OfficialScale): number | null {
  return p.value === null || s.ratio === null ? null : p.value * s.ratio;
}
