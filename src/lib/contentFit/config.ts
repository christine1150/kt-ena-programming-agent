// 콘텐츠 적합도 엔진의 설정값 — 모든 상수는 여기 한 곳에서만 정의한다(값마다 근거를 함께 적는다).
// 근거 수치는 2026-10-14 검증(수도권 2049 채널 3개 + 전국 가구 채널 3개, 2026-01~10 방영 데이터,
// 시점 14일 간격 약 40개 스냅샷 × 이후 28일 실적)에서 나온 값이다. 상세: docs/content-fit/CONTENT_FIT_LOGIC.md

export const CONTENT_FIT_MODEL_VERSION = "content-fit-v1";

export interface ContentFitConfig {
  /** 계산 윈도우(일). 기존 Fit Score 마트(최근 12주)와 같다. */
  windowDays: number;
  /**
   * 수축 강도 κ(가상 방영 건수): 사전 질량 = κ × 채널 평균 시청률. 표본이 적을수록 "슬롯 평균(1.0배)"으로 당긴다.
   * 근거: 이후 28일 실제 지수를 가장 잘 맞추는 값을 교차검증으로 고름 — 슬롯 기준 최소 표본 15건 조건에서
   * κ=1~2가 최소 오차(κ=0 대비 오차 0.208→0.200), 점수 순위상관은 κ=1에서 가장 높고 κ=2에서 표본 편향이 더 작다.
   */
  kappa: number;
  /**
   * 슬롯 기대치를 구할 때 "그 칸에 다른 프로그램의 방영이 최소 몇 건"이어야 그 수준을 믿는가.
   * 근거: 6→10→15로 올릴수록 이후 4주 예측 오차가 줄다가(0.279→0.222→0.208) 15~20에서 평탄(0.200).
   */
  minOtherAirings: number;
  /** 종합 점수에서 "시청 규모"가 차지하는 비중(나머지는 슬롯 대비 성과). 두 질문(자리에 맞는 성과 / 채널에 도움이 되는 규모)에 같은 비중. */
  scaleWeight: number;
  /** 몰입도·추세 보정의 비중(50을 기준으로 한 편차에 곱함). 성과 점수를 대체하지 못하고 보정만 한다. */
  engagementWeight: number;
  trendWeight: number;
  /** 보정 폭의 상·하한(점). 높은 부가 지표가 낮은 성과를 보상하지 못하게 막는 장치(비보상). */
  adjustCapUp: number;
  adjustCapDown: number;
  /** 추세: 최근 N일 vs 그 이전 구간. 양쪽 모두 방영 최소 일수가 있어야 계산. */
  trendRecentDays: number;
  trendMinDays: number;
  /** 방영 일수 미만이면 점수 자체를 내지 않는다(HOLD). */
  minDays: number;
  /** 정식 판정 최소 방영 일수(기존 TEST 규칙: 신뢰도 50% = 16일 만점의 절반 = 8일과 같다). */
  fullDays: number;
  /** 정식 판정 최소 신뢰도(데이터 반영 비중). */
  minReliability: number;
  /** 표본 신뢰도 표시 만점 일수(기존 fit_score_config.full_confidence_sample_days=16과 같다). */
  fullConfidenceDays: number;
  /**
   * 판정선(슬롯 대비 성과 배수 기준). 실제 편성 유지율(이후 28일 내 방영 지속)에서 단차가 생기는 지점:
   * 0.55 미만 69% 이하 / 0.55~0.85 73~83% / 0.85~1.5 88~92% / 1.5 이상 93%.
   */
  cut: { strengthen: number; keep: number; watch: number };
  /** 최근 4주가 이전 대비 이 값(log2) 이하로 떨어지면 한 단계 낮춰 "관찰"로 본다(-0.5 = 약 30% 하락). */
  trendDownDelta: number;
  /** MOVE 판정: 다른 시간대에서 슬롯 대비 지수가 이 이상이면서, 그 시간대가 현재보다 더 좋은 슬롯(기대 시청률이 이 배수 이상)일 때만. */
  move: { minAirings: number; minIndex: number; minSlotStrength: number };
  /** 참고 구간의 방향 표시 기준(슬롯 대비 지수). */
  leanBand: { above: number; below: number };
}

export const CONTENT_FIT_CONFIG: ContentFitConfig = {
  windowDays: 84,
  kappa: 2,
  minOtherAirings: 15,
  scaleWeight: 0.5,
  engagementWeight: 0.2,
  trendWeight: 0.2,
  adjustCapUp: 10,
  adjustCapDown: 15,
  trendRecentDays: 28,
  trendMinDays: 3,
  minDays: 3,
  fullDays: 8,
  minReliability: 0.5,
  fullConfidenceDays: 16,
  cut: { strengthen: 1.5, keep: 0.85, watch: 0.55 },
  trendDownDelta: -0.5,
  move: { minAirings: 3, minIndex: 1.0, minSlotStrength: 1.2 },
  leanBand: { above: 1.2, below: 0.8 },
};
