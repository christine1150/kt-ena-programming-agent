// 편성표 기반 시청률 예측·사후 리뷰(기능 2) — 입출력 타입. 순수 데이터 구조.
// 설계: docs/ena-features-plan.md §5. 칸별 예측값은 기존 AI 편성 엔진(idx-shrink-v1, 수축 기대값)이 내고, 이 모듈은 집계·고정 기록·대조만 맡는다.

export const FORECAST_SNAPSHOT_VERSION = "schedule-forecast-v1";

/** 근거 등급(A/B/C/가정)은 근거 수준이지 적중 확률이 아니다(OPT02 §7). */
export type EvidenceGrade = "A" | "B" | "C" | "ASSUMED";

export interface ForecastSlot {
  /** 편성표 칸 식별자(방송일|시작분|정규화 이름) */
  slotKey: string;
  date: string; // 닐슨 방송일(02:00~25:59)
  startMin: number; // 방송일 분(02:00=120 … 25:59=1559)
  /** 종료 분. 편성표 마지막 칸처럼 모르면 null(추정하지 않음) */
  endMin: number | null;
  /** 종료 시각을 다음 칸 시작으로 근사했는가(편성표 원본 규칙 보존) */
  endApproximated: boolean;
  /** 그날 마지막 칸이라 방송일 끝(26:00)까지 이어진다고 가정한 칸 — 집계에서 가정 분으로 따로 센다 */
  endAssumedDayEnd?: boolean;
  programName: string;
  programId: string | null;
  expected: number | null;
  low: number | null;
  high: number | null;
  grade: EvidenceGrade | null;
  evidenceAirings: number;
}

/** 일·주 집계 — 정의가 드러나는 이름을 쓴다(공식 채널 하루 시청률과의 일치가 검증되기 전). */
export interface PeriodForecast {
  label: "편성시간 가중 예상";
  from: string;
  to: string;
  /** 예측값이 있는 칸의 분 가중 평균 */
  value: number | null;
  /** 예측값이 있는 편성 분 / 그 기간 방송일 전체 분(24시간 × 일수) */
  forecastMinutes: number;
  totalMinutes: number;
  /** 편성표에 칸은 있지만 예측값이 없는 분(신규·매칭 실패 등) */
  unforecastMinutes: number;
  /** 편성표에 칸이 없는 분(빈칸·종료 미상) — 0으로 채우지 않는다 */
  uncoveredMinutes: number;
  /** 예측 분 중 "마지막 칸이 방송일 끝까지 이어진다"는 가정에 기댄 분 — 실제 종료가 더 이르면 그만큼 비어 있을 수 있다 */
  assumedEndMinutes: number;
  /** 하루(주) 전체가 예측으로 덮였는가 — 아니면 '부분 예측'이며 하루 전체 예측으로 표시하지 않는다 */
  complete: boolean;
  /** 집계 수준의 검증된 잔차가 없으면 범위를 만들지 않는다(칸별 상하한의 단순 평균 금지) */
  range: null;
  rangeNote: string;
}

export interface ActualAiring {
  /** ratings 행 식별(방영×타깃) — 실적 버전 추적용 */
  ratingRowId: string;
  date: string;
  startMin: number;
  endMin: number | null;
  programId: string | null;
  name: string;
  rating: number | null;
  /** 적재 시각(정정 추적) */
  loadedAt: string | null;
}

export type MatchState =
  | "MATCHED" // 같은 작품 방영 1건(또는 칸 안에서 나뉜 같은 작품 방영 여러 건)
  | "CHANGED" // 그 시간에 다른 작품이 방영됨(편성 변경) — 원래 예측의 정답으로 붙이지 않는다
  | "AMBIGUOUS" // 후보가 여럿이거나 이미 다른 칸에 쓰인 방영 — 확인 필요, 학습에 넣지 않음
  | "NO_ACTUAL"; // 그 시간의 실적 행이 없음(미수신·결방 미확인) — 0으로 보지 않는다

export interface SlotMatch {
  slotKey: string;
  state: MatchState;
  actualRowIds: string[];
  /** MATCHED일 때 실적(나뉜 방영이면 방영 분 가중) */
  actual: number | null;
  note: string;
}

export interface ReviewMetrics {
  /** 편성 유지 조건의 모델 성적: MATCHED 칸만 */
  model: { n: number; mae: number | null; bias: number | null };
  /** 포함·제외 기준 — 건수와 편성 분 비율 */
  inclusion: Record<MatchState, { slots: number; minutes: number }>;
  /** 계획 단계 예측 성적: 일별 편성시간 가중 예상 vs 같은 날 실제 방영의 편성시간 가중 집계(같은 정의, 대표 지표: 일별 채널 MAE %p). 공식 하루 값 대비는 환산 승인 후 */
  planDaily: { n: number; mae: number | null; bias: number | null; partialDaysExcluded: number };
}
