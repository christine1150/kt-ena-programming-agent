// 콘텐츠 적합도(CONTENT FITS) 엔진의 입출력 타입 — 순수 데이터 구조(서버·클라이언트 어디서나 import 가능).
// 설계 배경과 검증 근거는 docs/content-fit/CONTENT_FIT_LOGIC.md 참고.

/** 편성 액션 판정. 기존 5태그에 "관찰(WATCH)"을 더한 6태그(README의 6대 액션과 동일). */
export type ContentFitTag = "STRENGTHEN" | "KEEP" | "WATCH" | "MOVE" | "REPLACE" | "TEST";

/** 신뢰 구간: FORMAL=정식 판정, REFERENCE=표본 적음(참고용 점수), HOLD=방영 3일 미만(점수 없음). */
export type ContentFitTier = "FORMAL" | "REFERENCE" | "HOLD";

/** 시간대 구간(02~25시 방송 시각 기준 4구간) — 기존 마트(mart_slot_score)의 daypart 정의와 같다. */
export type Daypart = "새벽" | "오전" | "오후" | "저녁_심야";

/** 슬롯 기대치를 어느 수준에서 구했는지(좁은 순): 같은 요일·시 → 같은 요일·시간대 → 시간대 → 채널 전체. */
export type BaselineLevel = "slot" | "dowDaypart" | "daypart" | "channel";

/** 엔진 입력: 채널 KPI 타깃의 프로그램 단위 방영 1건(ratings 행 1개). */
export interface ContentFitAiring {
  programId: string;
  /** 방송일(YYYY-MM-DD, 02:00~익일 01:59 방송일 기준 그대로). */
  date: string;
  /** 방영 시작 시각("HH:MM:SS"). 없으면 슬롯 기준 비교 없이 채널 평균으로만 비교한다. */
  startTime: string | null;
  /** 채널 KPI 타깃 시청률(원값). */
  rating: number;
  reach: number | null;
  timeSpentShare: number | null;
  /** false면 재방(<재>). 시간대 분석(현재 주 시간대)에서만 제외하고 성과 계산에는 본방·재방을 모두 쓴다. */
  firstRun: boolean | null;
}

export interface ContentFitTrend {
  /** log2(최근 4주 지수 ÷ 이전 8주 지수). 0이면 변화 없음, -1이면 절반. */
  delta: number;
  recentIndex: number;
  priorIndex: number;
  recentDays: number;
  priorDays: number;
}

export interface ContentFitItem {
  programId: string;
  tier: ContentFitTier;
  /** 판정. HOLD면 null. */
  tag: ContentFitTag | null;
  /** 적합도 0~100(슬롯 평균 수준=50 근처). HOLD면 null. */
  score: number | null;
  /** 슬롯 대비 성과(배): 같은 요일·시간대의 다른 프로그램 평균 대비. 표본이 적으면 1.0 쪽으로 보정됨. */
  slotIndex: number | null;
  /** 시청 규모(배): 채널 평균 방영 시청률 대비(절대 수준). 표본이 적으면 1.0 쪽으로 보정됨. */
  scaleIndex: number | null;
  /** 위 두 지수를 0~100으로 옮긴 값(슬롯 평균·채널 평균 = 50, 2배 = 75, 절반 = 25). */
  slotScore: number | null;
  scaleScore: number | null;
  /** 시청 몰입도 0~100: 도달률·시청시간 비율을 같은 시간대 다른 프로그램과 견준 값. */
  engagementScore: number | null;
  /** 도달률·시청시간 비율의 슬롯 대비 배수(시청자 유형 분류용). */
  reachIndex: number | null;
  timeSpentIndex: number | null;
  trend: ContentFitTrend | null;
  /** 데이터가 지수에 반영된 비중 0~1(표본 질량 ÷ (표본 질량 + 사전 질량)). 낮을수록 1.0 쪽으로 많이 보정됨. */
  reliability: number;
  /** 표본 일수 기준 신뢰도 0~100(16일=100). 정식 판정이 아니면 49를 넘지 않는다. */
  confidencePct: number;
  sampleDays: number;
  airings: number;
  avgRating: number | null;
  avgReach: number | null;
  avgTimeSpentShare: number | null;
  /** 이 프로그램이 주로 방영되는 시간대(재방 제외 기준, 없으면 전체). */
  currentDaypart: Daypart | null;
  /** 판정이 MOVE일 때 이동을 검토할 더 좋은 시간대. */
  moveTo: Daypart | null;
  /** 참고 구간(표본 적음)에서 지금까지 흐름의 방향. */
  lean: "ABOVE" | "NEAR" | "BELOW" | null;
  /** 슬롯 기대치를 구한 방영 건수 비율(수준별). 어떤 기준으로 비교했는지 설명용. */
  baselineShare: Record<BaselineLevel, number>;
  lastAiredDate: string;
}

export interface ContentFitResult {
  modelVersion: string;
  asOf: string;
  windowFrom: string;
  windowDays: number;
  /** 채널 KPI 타깃의 방영 1건당 평균 시청률(윈도우 전체). */
  channelMeanRating: number;
  airingCount: number;
  items: ContentFitItem[];
}
