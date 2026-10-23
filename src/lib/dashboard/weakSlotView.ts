// 약한 자리 보완 제안의 화면용 타입(순수) — 서버 계산은 weakSlotRemedy.ts, 문구 조립은 homeCopy.ts가 쓴다.
export interface WeakSlotRemedyView {
  /** 채널 상세용 긴 문장(원인 → 할 일) */
  lines: string[];
  /** 수치로 계산된 이동 제안이 있는가 */
  concrete: boolean;
  /** 같은 자리 비교에 쓴 방영 수 */
  sample: number;
  /** 홈 카드용 한두 문장(원인 · 조치). 쉬운 말로 쓰고 비교 기준과 수치를 남긴다 */
  brief: { cause: string; action: string };
  /** 이 보완 제안이 가리키는 자리 — 같은 요일·시간대 비교 회차 중앙값 대비 최근 평균이 몇 %였나(비교 표본이 모자라면 ratioPct null) */
  hole: { program: string; hour: number; ratioPct: number | null };
  /** 이 조치와 같은 종류의 과거 변경(이동 또는 교체)이 이 채널에서 그 자리 시청률을 올렸는지 센 결과 한 줄(건수가 부족하면 없음). 원인은 가리지 않은 단순 비교 */
  /** 같은 입력에서 한 번에 나온 구조화 판정(문구는 이 값만 쓴다). 표본 부족이면 status=hold */
  verdict?: {
    status: "transient" | "short_persist" | "persistent" | "hold" | "not_low";
    statusKo: string;
    holdReason: "thin_sample" | "median_zero" | "today_missing" | null;
    today: number | null;
    /** 판정 창 — 최근 몇 회 평균(오늘 포함)으로 봤나(채널별 규칙, 2026-10-23) */
    window: number;
    /** 최근 window회 평균 */
    level: number | null;
    /** 비교 회차(최근 창 앞의 최대 8회) 중앙값 */
    median: number | null;
    /** 최근 평균 ÷ 중앙값 × 100(중앙값 0·없음이면 null — 0%로 대체하지 않음) */
    ratioPct: number | null;
    dropLine: number | null;
    /** 비교 회차 수 */
    sampleCount: number;
    lowCount: number;
    /** 비교한 방영 중 이 프로그램 자신의 방영 수(같은 자리 3회 미만이면 시간대 전체로 넓혀 이 값이 sampleCount보다 작다) */
    ownCount: number;
    missingCount: number;
  } | null;
  history?: { kind: "move" | "replace"; line: string } | null;
}
