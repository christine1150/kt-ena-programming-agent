// OPT04 — 탐색 제어(시간·평가 횟수 예산, 취소)와 탐색 보고서.
// 엔진(optimizer)은 시계·난수를 쓰지 않는 순수 함수로 유지한다. 시간 예산이 필요하면 호출자가 now()를 주입한다.
//  · 평가 횟수 예산(maxEvaluations)은 같은 입력이면 같은 지점에서 멈춰 결과가 재현된다.
//  · 마감 시각(deadlineAt)·취소(isCancelled)는 실행 환경에 따라 멈추는 지점이 달라 결과가 달라질 수 있다(reproducible=false).
// 어느 경우든 멈춘 시점의 편성안은 항상 하드 제약을 만족한다(국소탐색은 채택한 이동만 반영하고, 평가 중인 이동은 되돌린다).

export interface SearchControl {
  /** 현재 시각(ms). 주입하지 않으면 단계별 시간·마감 시각 판정을 하지 않는다. */
  now?: () => number;
  /** 이 시각(now() 기준 ms)이 지나면 탐색을 멈추고 지금까지의 최선안을 낸다. */
  deadlineAt?: number;
  /** 이번 실행에서 허용하는 편성 평가(Scorer.evaluate) 호출 수. 넘기면 멈춘다(재현 가능). */
  maxEvaluations?: number;
  /** true를 돌려주면 탐색을 멈춘다(사용자 취소·새 요청 대체). 호출자는 이때의 결과를 채택하지 않는 것이 원칙이다. */
  isCancelled?: () => boolean;
  /** 검증 모드(느림): 국소탐색의 차분 평가를 매번 전체 재평가와 비교해 불일치를 센다(T07). 평가 횟수가 늘어나므로 예산과 함께 쓰지 않는다. */
  verifyDelta?: boolean;
  /** 국소탐색의 시작점. GREEDY(기본) = 슬롯 가치 순 탐욕 구성, INCUMBENT = 지난주 실제 편성을 시작점으로(KEEP 모드, 안 맞는 칸은 탐욕으로 채움). */
  startFrom?: "GREEDY" | "INCUMBENT";
}

/** 서버 함수 제한(maxDuration 60초) 안에서 편성안을 확실히 돌려주기 위한 탐색 마감(요청 시작 기준, ms).
 *  넘기면 지금까지의 최선안으로 마무리한다(수렴한 결과가 아니며 요약·경고에 표시). 환경변수 IDEAL_SEARCH_DEADLINE_MS로 조정. */
export const DEFAULT_SEARCH_DEADLINE_MS = 45_000;

export type StopReason = "CONVERGED" | "MAX_MOVES" | "EVAL_BUDGET" | "DEADLINE" | "CANCELLED";

export const STOP_LABEL: Record<StopReason, string> = {
  CONVERGED: "더 좋아지는 교체·맞교환이 없어 끝남(국소 최적, 전역 최적 증명 아님)",
  MAX_MOVES: "교체 횟수 상한에 도달해 끝남",
  EVAL_BUDGET: "평가 횟수 예산을 다 써서 멈춤(지금까지의 최선안)",
  DEADLINE: "시간 예산을 다 써서 멈춤(지금까지의 최선안)",
  CANCELLED: "취소되어 멈춤",
};

/** 탐색 종료 사유를 화면 문구로 — 수렴·상한 도달이 아니면 "최선안이 아직 개선 중이었을 수 있음"을 알린다. */
export function searchNote(r: SearchReport | null | undefined): string | null {
  if (!r) return null;
  if (r.stoppedBy === "CONVERGED" || r.stoppedBy === "MAX_MOVES") return null;
  const sec = r.phaseMs ? Math.round(Object.values(r.phaseMs).reduce((a, b) => a + b, 0) / 100) / 10 : null;
  const gain = r.objectiveAfterConstruction !== null && r.objectiveAfterSearch !== null && r.objectiveAfterConstruction > 0 ? (r.objectiveAfterSearch / r.objectiveAfterConstruction - 1) * 100 : null;
  return `${STOP_LABEL[r.stoppedBy]}. 평가 ${r.evaluations.toLocaleString("ko-KR")}회${sec !== null ? ` · ${sec}초` : ""}${gain !== null ? ` · 구성 직후 대비 탐색 개선 ${gain.toFixed(2)}%` : ""}. 시간·취소로 멈춘 결과는 같은 입력으로 다시 계산하면 달라질 수 있습니다.`;
}

export interface SearchReport {
  stoppedBy: StopReason;
  /** 같은 입력·같은 버전이면 같은 결과가 나오는 종료 사유인가(시간 마감·취소는 false). */
  reproducible: boolean;
  /** 이번 실행의 편성 평가 호출 수·기대값 캐시 적중/미스 */
  evaluations: number;
  deltaCalls: number;
  expectedCacheHits: number;
  expectedCacheMisses: number;
  /** 국소탐색에서 채택한 교체·맞교환 수 */
  moves: number;
  /** 구성 직후(국소탐색 전) 목적함수 — 국소탐색 직후 값(objectiveAfterSearch) ≥ 이 값(채택은 개선뿐) */
  objectiveAfterConstruction: number | null;
  objectiveFinal: number;
  /** 시계를 주입했을 때만: 단계별 소요(ms) */
  phaseMs?: Record<string, number>;
  /** 검증 모드에서만: 차분 평가 비교 횟수·불일치 수·최대 차이 */
  deltaCheck?: { checked: number; mismatches: number; maxAbsDiff: number };
  /** 국소탐색이 끝난 직후(유지 판단·지난주 편성 복귀 전) 목적함수 — KEEP 모드의 최종값은 유지 판단으로 의도적으로 낮아질 수 있다 */
  objectiveAfterSearch: number | null;
  /** 실제로 쓴 시작점 */
  startedFrom: "GREEDY" | "INCUMBENT";
  /** 대체 후보 계산을 시간·취소 때문에 생략했는가 */
  alternativesSkipped: boolean;
  /** 탐색이 시간·평가 예산으로 끝나 구성 도중 빠른 채움으로 마무리한 슬롯 수 */
  fastFilledSlots: number;
}

/** 반복마다 부르는 정지 판정. 한 번 멈추면 같은 사유를 유지한다. */
export class SearchGate {
  private reason: StopReason | null = null;
  private ticks = 0;
  constructor(
    private readonly ctl: SearchControl | undefined,
    private readonly evalCount: () => number,
    private readonly startEvals: number
  ) {}

  get stopped(): boolean {
    return this.reason !== null;
  }
  get stopReason(): StopReason | null {
    return this.reason;
  }

  check(): StopReason | null {
    if (this.reason) return this.reason;
    const c = this.ctl;
    if (!c) return null;
    if (c.isCancelled?.()) return (this.reason = "CANCELLED");
    if (c.maxEvaluations !== undefined && this.evalCount() - this.startEvals >= c.maxEvaluations) return (this.reason = "EVAL_BUDGET");
    // 시계 호출 비용을 줄이려 몇 번에 한 번만 확인한다
    if (c.now && c.deadlineAt !== undefined && (this.ticks++ & 7) === 0 && c.now() >= c.deadlineAt) return (this.reason = "DEADLINE");
    return null;
  }
}
