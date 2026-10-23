// 프로그램 방영의 목표 격차 기여(2026-10-23 약한 자리 확인 대기 3 — 사용자 승인) — 순수 함수.
//
// 정의: 방영 i의 목표 기여 = (그 방영 시청률 × 환산 배율 − 목표) × 방영 분 ÷ 하루 전체 분(1,440).
//   · 공식 채널 하루 시청률 ≈ 방영 시청률의 편성시간 가중 평균 × 환산 배율(직전 28일, scheduleForecast/officialScale — 상관 1.00, 배율 없이는 6~9% 높음).
//   · 그래서 하루 모든 방영의 기여를 더하면 (환산 하루 값 − 목표)가 되고, 방영 하나의 몫을 "오늘 목표 격차의 N%"로 말할 수 있다.
//   · "평소 수준이었다면"은 같은 식에 같은 자리 비교 중앙값을 넣은 값이다 — 두 몫의 차이가 오늘 낮아져서 생긴 몫이다.
// 격차가 없거나(목표 이상) 방영이 목표 이상으로 격차를 줄였으면(기여 ≥ 0) 몫을 말하지 않는다(null).

export const DAY_MINUTES = 1440;

export interface ContributionInput {
  /** 이 방영 시청률(프로그램 단위, 편성시간 가중 집계와 같은 값) */
  rating: number;
  /** 같은 자리 비교 회차 중앙값(평소 수준) */
  usual: number | null;
  /** 방영 분 */
  minutes: number;
  /** 공식 하루 환산 배율(직전 28일) */
  scale: number;
}

/** (시청률 × 배율 − 목표) × 분 ÷ 1,440 — 공식 하루 시청률 단위 */
export const gapContribution = (rating: number, minutes: number, scale: number, target: number) => ((rating * scale - target) * minutes) / DAY_MINUTES;

/**
 * 오늘 목표 격차(공식 하루 값 − 목표, 음수) 중 이 방영이 차지한 몫(0~1 이상)과, 평소 수준이었다면의 몫.
 * 격차가 없거나 입력이 모자라면 null.
 */
export function gapShareOf(c: ContributionInput, official: number | null, target: number | null): { share: number; usualShare: number | null } | null {
  if (official === null || target === null || target <= 0 || !(c.scale > 0) || !(c.minutes > 0)) return null;
  const gap = official - target;
  if (gap >= 0) return null;
  const mine = gapContribution(c.rating, c.minutes, c.scale, target);
  if (mine >= 0) return null;
  const usual = c.usual === null ? null : gapContribution(c.usual, c.minutes, c.scale, target);
  return { share: mine / gap, usualShare: usual === null ? null : Math.max(0, usual / gap) };
}
