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
  /** 이 보완 제안이 가리키는 자리 — 같은 요일·시간대 최근 8회 중앙값 대비 몇 %였나(비교 표본이 모자라면 ratioPct null) */
  hole: { program: string; hour: number; ratioPct: number | null };
  /** 이 조치와 같은 종류의 과거 변경(이동 또는 교체)이 이 채널에서 그 자리 시청률을 올렸는지 센 결과 한 줄(건수가 부족하면 없음). 원인은 가리지 않은 단순 비교 */
  history?: { kind: "move" | "replace"; line: string } | null;
}
