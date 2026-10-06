// Fact / Insight / ActionCandidate 구조(단계 04) — 숫자·문장·액션이 같은 사실을 쓰도록 하는 공통 형태.
// 규칙 엔진이 Fact와 ActionCandidate를 만들고, AI는 허용된 Fact를 설명만 한다. 문장은 narrativeGuard를 통과해야 쓰인다.
import type { ActionTag } from "@/lib/actionTags";

/** 값의 성격 — 같은 숫자라도 시청률·지수·변화율·%p는 서로 바꿔 쓸 수 없다. */
export type ValueKind =
  | "rating" // 시청률(%)
  | "share" // 점유율(%)
  | "rank" // 순위(정수)
  | "index100" // 기준=100 지수
  | "pct_change" // 상대 변화(%)
  | "pp_change" // 값 차이(%p)
  | "count" // 횟수·일수
  | "ratio_x" // 배수
  | "seconds" // 시간
  | "composition_pct" // 구성비(해당 집단이 전체에서 차지하는 비중)
  | "text"; // 이미 완성된 문장·라벨에서 숫자만 허용할 때

/** 비교 기준의 종류 — 문장이 기준을 바꿔 쓰는 것(12주 → 전주)을 잡는 데 쓴다. */
export type ComparisonKind =
  | "prior_week"
  | "prior_week2"
  | "rolling_4w"
  | "rolling_8w"
  | "rolling_12w"
  | "prior_period"
  | "prior_month"
  | "prior_year"
  | "same_dow"
  | "slot_avg"
  | "channel_avg"
  | "goal";

export type FactBasis = "observed" | "estimated" | "derived";
export type AirType = "first_run" | "rerun" | "mixed";

export interface Fact {
  /** 참조 ID — 문장·액션이 어떤 사실을 인용했는지 추적한다 */
  id: string;
  /** 지표 정의 ID(rating, share, rank, ...) */
  metricId: string;
  /** 대상·타깃·기간을 사람이 읽을 수 있게 한 줄로 */
  context: string;
  value: number | null;
  valueKind: ValueKind;
  unit: string;
  /** 이미 포맷된 표시 문자열 — 문장은 이것만 인용한다 */
  display: string;
  comparison?: { kind: ComparisonKind; label: string; baseValue: number | null; direction: "up" | "down" | "flat" | null };
  provenance: { source: string; snapshotId?: string };
  coverage?: { basedOn: number; expected: number } | null;
  basis: FactBasis;
  airType?: AirType | null;
}

export type InsightStatus = "observation" | "hypothesis" | "unverifiable";

/** 규칙 엔진이 만든 판단 문장 — 반드시 근거 Fact ID를 가진다. */
export interface Insight {
  id: string;
  status: InsightStatus;
  text: string;
  factIds: string[];
  /** 가설일 때 확인할 방법 */
  howToVerify?: string;
}

export type ActionKind = "KEEP" | "MOVE" | "REPLACE" | "STRENGTHEN" | "TEST" | "MONITOR";
export type ActionScopeLevel = "program" | "episode" | "slot";
export type ActionPurpose = "daily_review" | "weekly_plan" | "portfolio" | "report";
export type EvidenceStrength = "strong" | "moderate" | "weak" | "insufficient";
export type AvailStatus = "unverified" | "available" | "unavailable" | "not_applicable";

export interface ActionCandidate {
  /** 같은 대상·기간·목적·판단이면 같은 ID */
  actionId: string;
  /** 대상·기간·목적의 키 — 같은 키에 서로 다른 판단이 있으면 충돌이다 */
  actionKey: string;
  snapshotId: string;
  scope: {
    level: ActionScopeLevel;
    programName: string | null;
    episode: number | null;
    slot: { dow: number | null; hour: number | null } | null;
  };
  period: { from: string; to: string; label: string };
  purpose: ActionPurpose;
  kind: ActionKind;
  /** 화면에 쓰는 짧은 판단 문구(홈·상세·보고서 공통) */
  shortLabel: string;
  /** 관측 — 근거 Fact ID와 표시 문장 */
  observation: { factIds: string[]; text: string };
  /** 가설 — 관측이 아니며 교란요인을 분리하지 못했다 */
  hypothesis: string | null;
  proposal: string;
  alternatives: string[];
  /** 이 조건이 확인되면 판단을 확정·철회한다 */
  confirmConditions: string[];
  evidence: { strength: EvidenceStrength; sampleN: number | null; repeatedObservations: number; reasons: string[] };
  constraints: { avail: AvailStatus; policyFlags: string[]; notes: string[] };
  /** 검토일(YYYY-MM-DD) */
  reviewBy: string | null;
  /** 실행 후 평가 기준 */
  evaluation: { metric: string; successCriterion: string; windowDays: number } | null;
  policyVersion: string;
  /** Fit Score 마트가 매긴 태그(있을 때만) — 판단의 출처 */
  fitScoreTag: ActionTag | null;
  /** 영구 교체·이동처럼 되돌리기 어려운 변경을 권해도 되는 근거인지 */
  permanentChangeSupported: boolean;
}

export interface ActionConflict {
  actionKey: string;
  kinds: ActionKind[];
  actionIds: string[];
  message: string;
}
