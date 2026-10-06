// 액션 검토 기록(단계 07) — 결정 카드에서 시작한 검토의 상태(검토 중/보류/채택/기각)와 이유를 추가 전용 이벤트로 남긴다.
// 수정·삭제하지 않고 새 이벤트를 쌓으며 "현재 상태"는 같은 action_id의 가장 최근 이벤트다(원장 방식, 이력 보존).
// 다음 브리핑에는 후속이 필요한 것만 보여 준다: 검토 중, 보류 기한이 도래한 것, 채택 후 평가일이 도래한 것.
import { daysBetween } from "./dates";

export type ReviewStatus = "reviewing" | "hold" | "adopted" | "dismissed";

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  reviewing: "검토 중",
  hold: "보류",
  adopted: "채택",
  dismissed: "기각",
};

/** 이유가 반드시 필요한 상태(검토 중은 이유 없이 시작할 수 있다). */
export const REASON_REQUIRED: ReviewStatus[] = ["hold", "adopted", "dismissed"];

export interface ReviewEventInput {
  actionId: string;
  actionKey?: string | null;
  channelCode?: string | null;
  title: string;
  status: ReviewStatus;
  reason?: string | null;
  /** 보류 재검토일 또는 채택 후 성과 평가일(YYYY-MM-DD) */
  reviewBy?: string | null;
  /** 이 검토가 연결된 저장 편성안(ideal_schedule_runs.id) */
  linkedRunId?: string | null;
  /** 판단 당시의 문맥(채널·기간·기준일 등) */
  context?: Record<string, string | null> | null;
  snapshotId?: string | null;
}

export interface ReviewEvent extends ReviewEventInput {
  id: string;
  createdAt: string;
  actorRole: "admin" | "pd" | null;
  actorId: string | null;
  actorName: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 저장 전 검증. 문제가 있으면 사람이 읽을 이유를 돌려준다(조용히 보정하지 않는다). */
export function validateReviewInput(i: ReviewEventInput): string[] {
  const problems: string[] = [];
  if (!i.actionId || !i.actionId.trim()) problems.push("액션 ID가 없습니다.");
  if (!i.title || !i.title.trim()) problems.push("액션 제목이 없습니다.");
  if (!(i.status in REVIEW_STATUS_LABEL)) problems.push(`알 수 없는 상태입니다: ${String(i.status)}`);
  if (REASON_REQUIRED.includes(i.status) && !(i.reason ?? "").trim()) problems.push(`'${REVIEW_STATUS_LABEL[i.status]}'에는 이유를 적어야 합니다.`);
  if ((i.reason ?? "").length > 500) problems.push("이유는 500자 이내로 적어 주세요.");
  if (i.reviewBy && !ISO.test(i.reviewBy)) problems.push("재검토·평가일 형식이 올바르지 않습니다(YYYY-MM-DD).");
  return problems;
}

/** 같은 action_id의 가장 최근 이벤트(createdAt, 같으면 입력 순서상 뒤). */
export function latestByAction(events: ReviewEvent[]): Map<string, ReviewEvent> {
  const out = new Map<string, ReviewEvent>();
  events.forEach((e) => {
    const cur = out.get(e.actionId);
    if (!cur || e.createdAt >= cur.createdAt) out.set(e.actionId, e);
  });
  return out;
}

/** 같은 검토 주제(context.subject, 없으면 actionId)의 가장 최근 이벤트. 날짜가 달라 action_id가 바뀌어도 같은 프로그램·슬롯의 검토는 하나로 본다. */
export function latestBySubject(events: ReviewEvent[]): Map<string, ReviewEvent> {
  const out = new Map<string, ReviewEvent>();
  events.forEach((e) => {
    const key = e.context?.subject || e.actionId;
    const cur = out.get(key);
    if (!cur || e.createdAt >= cur.createdAt) out.set(key, e);
  });
  return out;
}

export interface Followup {
  actionId: string;
  title: string;
  channelCode: string | null;
  status: ReviewStatus;
  reason: string | null;
  reviewBy: string | null;
  /** 지금 처리할 때가 된 것(기한 도래·기한 없는 보류·검토 중) */
  due: boolean;
  /** 화면에 쓰는 한 줄 이유("보류 기한 도래" 등) */
  why: string;
  linkedRunId: string | null;
}

/**
 * 다음 브리핑에 보여 줄 후속. 기각과 종결된 것은 빼고, 아직 기한 전인 보류·채택은 숨긴다.
 * - 검토 중: 항상 표시(결정 전)
 * - 보류: 재검토일이 지났거나(≤오늘) 재검토일이 없으면 표시
 * - 채택: 평가일이 지났으면 "성과 확인" 후속으로 표시
 */
export function pendingFollowups(events: ReviewEvent[], args: { today: string; channelCode?: string | null }): Followup[] {
  const out: Followup[] = [];
  for (const e of latestBySubject(events).values()) {
    if (args.channelCode && e.channelCode && e.channelCode !== args.channelCode) continue;
    const overdue = e.reviewBy ? daysBetween(e.reviewBy, args.today) >= 0 : false;
    let why: string | null = null;
    let due = false;
    if (e.status === "reviewing") {
      why = "검토 중 — 결정 필요";
      due = true;
    } else if (e.status === "hold") {
      if (!e.reviewBy) {
        why = "보류 — 재검토일 미지정";
        due = true;
      } else if (overdue) {
        why = `보류 재검토일(${e.reviewBy}) 도래`;
        due = true;
      }
    } else if (e.status === "adopted") {
      if (e.reviewBy && overdue) {
        why = `채택 후 성과 확인일(${e.reviewBy}) 도래`;
        due = true;
      }
    }
    if (!why) continue;
    out.push({ actionId: e.actionId, title: e.title, channelCode: e.channelCode ?? null, status: e.status, reason: e.reason ?? null, reviewBy: e.reviewBy ?? null, due, why, linkedRunId: e.linkedRunId ?? null });
  }
  // 검토 중 → 보류 → 채택 순, 같은 상태에서는 제목순(안정 정렬)
  const order: Record<ReviewStatus, number> = { reviewing: 0, hold: 1, adopted: 2, dismissed: 3 };
  return out.sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title, "ko"));
}

/** 결정 카드에 현재 검토 상태를 붙이기 위한 조회(없으면 null). */
export function currentStatus(events: ReviewEvent[], actionId: string): ReviewEvent | null {
  return latestByAction(events).get(actionId) ?? null;
}
