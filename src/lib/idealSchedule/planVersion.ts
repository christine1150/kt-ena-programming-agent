// 편성안 버전 식별·작업본 상태·재평가 값 덮어쓰기(OPT06) — 순수 함수.
//
// 목적: "0.047과 0.048처럼 서로 다른 버전의 수치를 한 편성안의 값처럼 표시하지 않는다."
//  · 편성안 버전(planVersion)은 *내용*(요일·시간·후보)의 지문이다. 잠금만 바꾸면 값이 바뀌지 않으므로 버전도 같다.
//  · 재평가 값은 자기가 계산된 버전을 달고 다닌다. 지금 편성안의 버전과 다르면 *쓰지 않는다*(화면은 저장된 원래 값 + "재평가 전" 안내).
//  · 상단 요약·편성표·내보내기·이력이 모두 같은 함수(weeklyExpectedOf)와 같은 덮어쓰기(overlayEvaluation)를 지난 블록으로 계산한다.
import { sealOf } from "./adoption";

export interface VersionBlock {
  layer?: string;
  weekday: number;
  start_min: number | string;
  end_min: number | string;
  candidate_key: string;
  status?: string;
  locked?: boolean;
}

const r3 = (v: number | string) => Math.round(Number(v) * 1000) / 1000;

/** 이상적 편성안(IDEAL 층) 내용의 지문. 같은 내용이면 같고, 칸 하나라도 후보·시간이 바뀌면 달라진다. */
export function planVersionOf(blocks: VersionBlock[]): string {
  const rows = blocks
    .filter((b) => (b.layer ?? "IDEAL") === "IDEAL")
    .map((b) => [b.weekday, r3(b.start_min), r3(b.end_min), b.candidate_key])
    .sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number) || String(a[3]).localeCompare(String(b[3])));
  return `P${sealOf(JSON.stringify(rows)).slice(0, 10)}`;
}

/** 블록 하나의 재평가 값 — 저장된 블록 열과 같은 이름이라 그대로 덮어쓸 수 있다. */
export interface BlockEvalOverlay {
  expected_kpi: number | null;
  expected_share: number | null;
  expected_time_spent: number | null;
  expected_low: number | null;
  expected_high: number | null;
  range_basis: "BACKTEST" | "TRAINING" | null;
  confidence_score: number | null;
  block_value: number | null;
  fitness_score: number | null;
  sample_count: number | null;
  fallback_level: number | null;
  penalties: Record<string, number> | null;
  score_components: Record<string, number | null> | null;
  /** 선정 이유 — 지금 맥락(이웃·반복)에서 다시 만든 것. 교체 때 붙은 권리 판정 같은 기록은 서버가 유지해 합친다 */
  reasons: { code: string; value: number | string | null; detail?: string }[] | null;
}

export interface WorkingEvaluation {
  /** 이 값이 계산된 편성안 버전 — 지금 버전과 다르면 쓰지 않는다 */
  planVersion: string;
  evaluatedAt: string;
  /** 어떤 계산인지: 탐색 없이 지금 편성 그대로를 같은 모델로 다시 평가함 */
  kind: "REEVALUATE_WORKING_COPY";
  model: string | null;
  objective: number;
  weeklyExpected: number | null;
  byBlock: Record<string, BlockEvalOverlay>;
  /** 재평가하지 못해 저장 값을 유지한 블록(경쟁 Benchmark·장르 원형 등) */
  skippedBlockIds: string[];
  /** 재평가한 영역 — 화면에 그대로 안내한다 */
  scope: string[];
  /**
   * 수정 전 계산 완료본의 주간 기대: 저장 값(stored)과 지금 모델로 같은 방식으로 다시 평가한 값(fresh).
   * 둘이 다르면 그 차이는 수정이 아니라 모델·자료 버전 차이다 — 수정의 효과는 fresh → 수정 후 값으로 읽는다.
   */
  baseline?: { stored: number | null; fresh: number | null };
}

export const EVALUATION_SCOPE = ["인접 편성(앞뒤 프로그램 연관·연속 편성)", "같은 프로그램 반복 노출(같은 시간대·하루·주 횟수)", "그날 장르 편중", "주간 기대 시청률 합산"] as const;

export interface OverlayBlock {
  id: string;
  layer?: string;
  start_min: number | string;
  end_min: number | string;
  content_type?: string;
  [k: string]: unknown;
}

/** 현재 버전과 같은 버전의 재평가 값만 IDEAL 블록 위에 덮어쓴다(다르면 그대로 돌려준다). */
export function overlayEvaluation<B extends OverlayBlock>(blocks: B[], evaluation: WorkingEvaluation | null | undefined, currentVersion: string): { blocks: B[]; applied: boolean } {
  if (!evaluation || evaluation.planVersion !== currentVersion) return { blocks, applied: false };
  const skip = new Set(evaluation.skippedBlockIds);
  return {
    applied: true,
    blocks: blocks.map((b) => {
      const o = evaluation.byBlock[b.id];
      if ((b.layer ?? "IDEAL") !== "IDEAL" || !o || skip.has(b.id)) return b;
      return { ...b, ...o };
    }),
  };
}

/** 주간 기대 평균 = 편성 분 가중 평균(경쟁 Benchmark 가상 편성 제외, 값 없는 칸 제외). 화면·내보내기·재평가가 같은 식을 쓴다. */
export function weeklyExpectedOf(blocks: { start_min: number | string; end_min: number | string; expected_kpi: number | string | null; content_type?: string; layer?: string }[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of blocks) {
    if ((b.layer ?? "IDEAL") !== "IDEAL") continue;
    if (b.content_type === "COMPETITOR_BENCHMARK" || b.expected_kpi === null || b.expected_kpi === undefined) continue;
    const len = Number(b.end_min) - Number(b.start_min);
    num += Number(b.expected_kpi) * len;
    den += len;
  }
  return den > 0 ? num / den : null;
}

export type WorkingState = "COMPUTED" | "DIRTY" | "REEVALUATED";

export interface WorkingStateInfo {
  state: WorkingState;
  label: string;
  detail: string;
  /** true면 화면의 주간 기대값·칸 값이 지금 편성안 그대로 계산된 값이다 */
  valuesCurrent: boolean;
}

/**
 * 작업본 상태.
 *  · COMPUTED    엔진이 계산한 그대로(수동 수정 없음 또는 모두 되돌림).
 *  · DIRTY       수동 수정이 있고 이웃·반복·합계는 아직 재평가 전 — 요약을 계산 완료 값처럼 보이면 안 된다.
 *  · REEVALUATED 수동 수정 뒤 같은 모델로 다시 평가함(탐색은 하지 않음 — 다른 칸을 더 좋게 바꾸는 재계산이 아니다).
 */
export function workingStateOf(args: { activeEditCount: number; evaluation: WorkingEvaluation | null | undefined; currentVersion: string }): WorkingStateInfo {
  const { activeEditCount, evaluation, currentVersion } = args;
  if (activeEditCount <= 0) return { state: "COMPUTED", label: "계산 완료본", detail: "엔진이 계산한 그대로의 편성안입니다.", valuesCurrent: true };
  if (evaluation && evaluation.planVersion === currentVersion) {
    return { state: "REEVALUATED", label: `작업본 · 재평가됨(수동 수정 ${activeEditCount}건)`, detail: "수정한 칸과 인접·반복·합계를 같은 모델로 다시 평가했습니다. 다른 칸을 더 좋게 바꾸는 탐색(다시 계산)은 하지 않았습니다.", valuesCurrent: true };
  }
  return { state: "DIRTY", label: `작업본 · 재평가 전(수동 수정 ${activeEditCount}건)`, detail: "수정한 칸의 값만 후보 평가값입니다. 인접 편성·반복 노출·주간 합계는 재평가 전이라 지금 편성안의 값이 아닙니다.", valuesCurrent: false };
}
