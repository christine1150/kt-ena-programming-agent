// 필드별 출처 우선순위와 수동 잠금(단계 05) — 재업로드가 운영자가 정한 값을 조용히 지우지 못하게 한다.
// 순서는 "위가 이긴다"이다. 공식 시청률 사실(rating_fact)은 어떤 사람이 쓴 메모로도 덮을 수 없다.
export type FieldId =
  | "target_goal" // 목표 시청률·순위
  | "channel_info" // 채널 기본정보·경쟁채널
  | "episode_info" // 회차·부제
  | "review_text" // 회차 리뷰 문장
  | "airing_schedule" // 방영 시각·편성
  | "rating_fact"; // 공식 시청률·점유율·순위

export type Source =
  | "official_nielsen"
  | "manual_admin"
  | "channel_master_file"
  | "epg_corrected"
  | "epg_daily"
  | "weekly_plan"
  | "pd_manual_review"
  | "calc_review"
  | "daily_actual"
  | "pd_memo";

/** 필드별 우선순위(높은 것부터). 목록에 없는 출처는 그 필드에 쓸 수 없다. */
export const FIELD_PRECEDENCE: Record<FieldId, Source[]> = {
  target_goal: ["manual_admin", "channel_master_file"],
  channel_info: ["manual_admin", "channel_master_file"],
  episode_info: ["epg_corrected", "epg_daily", "weekly_plan"],
  review_text: ["pd_manual_review", "calc_review"],
  airing_schedule: ["daily_actual", "weekly_plan"],
  rating_fact: ["official_nielsen"],
};

export interface FieldLock {
  field: FieldId;
  /** 채널·연도 등 대상 키(예: "ENA:2026") */
  key: string;
  value: unknown;
  lockedBy: string;
  lockedAt: string;
  effectiveFrom: string | null;
  reason: string;
}

export interface Existing {
  source: Source;
  value: unknown;
}

export type WriteDecision =
  | { action: "write"; reason: string }
  | { action: "noop"; reason: string }
  | { action: "skip_locked"; reason: string }
  | { action: "skip_lower_priority"; reason: string }
  | { action: "reject_source"; reason: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 들어온 값을 기존 값 위에 쓸 수 있는지 판단한다.
 * - 그 필드의 허용 출처가 아니면 거부한다(PD 메모가 공식 시청률 사실을 쓰려 해도 거부).
 * - 잠금이 있으면 잠금을 만든 출처(수동 입력)가 아닌 쓰기는 건너뛴다. 건너뛴 사실은 호출부가 결과에 보여 줘야 한다.
 * - 기존 값이 더 높은 우선순위 출처면 건너뛴다.
 */
export function decideWrite(args: { field: FieldId; incomingSource: Source; incomingValue: unknown; existing?: Existing | null; lock?: FieldLock | null; overrideLock?: boolean }): WriteDecision {
  const order = FIELD_PRECEDENCE[args.field];
  if (!order.includes(args.incomingSource)) return { action: "reject_source", reason: `${args.incomingSource}은(는) ${args.field}에 쓸 수 없는 출처입니다` };
  if (args.lock && !args.overrideLock && args.incomingSource !== "manual_admin") {
    return { action: "skip_locked", reason: `${args.lock.lockedBy}가 ${args.lock.lockedAt}에 잠금(${args.lock.reason})` };
  }
  const ex = args.existing;
  if (!ex) return { action: "write", reason: "기존 값 없음" };
  if (same(ex.value, args.incomingValue)) return { action: "noop", reason: "기존 값과 같음" };
  const exRank = order.indexOf(ex.source);
  const inRank = order.indexOf(args.incomingSource);
  if (exRank !== -1 && exRank < inRank && !args.overrideLock) return { action: "skip_lower_priority", reason: `기존 값의 출처(${ex.source})가 우선함` };
  return { action: "write", reason: exRank === -1 ? "기존 출처 불명 — 새 출처로 기록" : "같거나 높은 우선순위" };
}
