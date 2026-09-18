// 사용자 지시(2026-09-18): src/app/Dashboard.tsx 안에 갇혀 있던 등락 원인 분해 로직(순수
// 함수)을 그대로(로직 변경 없이) 옮긴 파일 — 다음 단계에서 Page 2(ChannelDeepDive.tsx)의
// WHY? 진단에도 같은 원인분해 모델을 재사용하기 위해 분리했다. 계산/판정 로직 자체는 전혀
// 바꾸지 않았고(순수 이동), Dashboard.tsx는 이 파일에서 import해서 그대로 호출한다.

// classifyDeclineCause/monthlyDriverCauseLabel이 참조하는 최소 필드만 담은 타입 — 원본
// Dashboard.tsx의 MonthlyDriver interface와 동일한 필드를 그대로 유지한다(로직 무변경).
export interface MonthlyDriver {
  programName: string;
  contributionDelta: number; // 채널 월간 평균 시청률을 몇 %p 올렸/내렸는가
  volumeEffect: number; // 그중 편성량이 바뀌어서 생긴 몫
  performanceEffect: number; // 그중 작품 성과가 바뀌어서 생긴 몫
  airCount: number;
  priorAirCount: number;
  avgRating: number | null;
  priorAvgRating: number | null;
  slotLift: number | null; // 전월 동시간대 평균 대비
  primeAirCount: number;
  primeDow: number | null;
  // 사용자 지시(2026-09-01, 4대 복합 원인 태깅): 프라임 성과 자체의 등락(편성 횟수와 무관) —
  // "본방 화제성"과 "재방 물량 확대"를 구분하는 데 쓴다.
  primeRatingDelta: number | null;
  priorPrimeAirCount: number;
  mainSlotDow: number | null;
  mainSlotHourBlock: number | null;
  replacedByName?: string;
  replacedByRating?: number | null;
  replacedByAirCount?: number;
}

// 사용자 지시(2026-09-01, "Root Cause Tagging" 재설계): 단순 "편성 확대/축소" 단일 태그를
// 금지하고, 편성량 효과(volumeEffect)와 성과 효과(performanceEffect)의 항등 분해에 프라임(평일 19~23시 · 토·일·공휴일 18~23시)
// 자체의 등락(primeRatingDelta — 편성 횟수와 무관하게 "본방 화제성"만 따로 뗀 값)을 결합해
// 상승 3종 + 하락 3종(2026-09-07 세분화) 복합 원인으로 판정한다. 새 수치를 계산하지 않고
// 이미 SQL이 항등 분해해 준 값들의 조합만
// 본다 — Health Score/Turning Point 때와 같은 "합리적 v1 휴리스틱, 추후 조정 가능" 원칙.
//   · 콘텐츠 경쟁력 견인: 상승이고, 편성량보다 성과(프라임 포함) 효과가 더 크게 기여 — 편성
//     횟수와 무관하게 작품 자체가 좋아져서 오른 경우.
//   · 편성 시너지: 상승이고, 편성량 효과가 더 크게 기여하면서 프라임 성과도 함께 올랐다 —
//     본방 화제성이 재방 물량 확대로 이어져 총 기여도가 동반 상승.
//   · 편성 의존형 방어: 상승이지만 프라임은 정체·하락인데 편성량(주로 재방) 확대만으로 총합을
//     방어한 경우 — 숫자는 양수여도 콘텐츠 자체의 경쟁력 신호는 아니다.
//   · 핵심 콘텐츠 이탈 / 부진 / 이탈+부진: 하락 — "편성에서 밀려난 것"(volumeEffect, 편성
//     축소·종영)과 "방영은 하는데 성과 자체가 나쁜 것"(performanceEffect, 시청률 하락)을
//     구분해 실제 원인을 짚는다(사용자 지시 2026-09-07: "이탈이 문제인지, 부진이 문제인지,
//     둘 다 문제인지 정확히 짚을 것"). 편성 0회(완전 종영)면 performanceEffect가 항등적으로
//     0이 되므로(이 기간 점유 시간이 0이라 성과 항이 사라짐) 자연히 "이탈"로 분류된다 —
//     별도 특례 처리 없이 volume/performance 크기 비교 하나로 세 경우를 모두 판정한다.
export function classifyDeclineCause(volume: number, performance: number): string {
  const total = volume + performance;
  // 둘 다 무시 못할 크기로 섞여 있으면(작은 쪽이 전체의 35% 이상) "이탈+부진"으로 — 편성도
  // 줄고 성과도 나빠진 복합 상황. 35%는 Health Score/Turning Point 때와 같은 "합리적 v1
  // 임계값, 추후 조정 가능" 원칙.
  if (total > 0 && Math.min(volume, performance) / total >= 0.35) return "핵심 콘텐츠 이탈+부진";
  return volume >= performance ? "핵심 콘텐츠 이탈" : "핵심 콘텐츠 부진";
}

export function monthlyDriverCauseLabel(d: MonthlyDriver): string {
  const volume = Math.abs(d.volumeEffect);
  const performance = Math.abs(d.performanceEffect);
  if (volume === 0 && performance === 0) return "";

  if (d.contributionDelta < 0) return classifyDeclineCause(volume, performance);

  // 프라임 표본이 충분할 때만(이번 달·전월 중 많이 방영된 쪽 기준 2회 이상) 프라임 신호를 신뢰한다.
  const primeSampleOk = Math.max(d.primeAirCount, d.priorPrimeAirCount) >= 2;
  const primeRising = primeSampleOk && d.primeRatingDelta !== null && d.primeRatingDelta > 0;
  const volumeDominant = volume >= performance;

  if (!volumeDominant) return "콘텐츠 경쟁력 견인";
  return primeRising ? "편성 시너지" : "편성 의존형 방어";
}
