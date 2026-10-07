// 관리자/편성자/열람자 권한(단계 05) — 서버(route/API)가 이 표로 최소 역할을 검사한다. 화면 숨김은 보안이 아니다.
// 현재 세션 역할은 admin·pd 두 가지뿐이다. pd는 편성자(planner)로 대응하고, 열람자(viewer) 계정은 아직 발급되지 않는다(가정).
// 아래 표는 "현재 admin 전용 API가 그대로 admin 전용"임을 고정하는 목적이며, 편성자에게 새 권한을 주지 않는다.
import type { SessionPayload } from "@/lib/session";

export type Role = "admin" | "planner" | "viewer";

export type AdminAction =
  | "view" // 조회
  | "upload" // 원본 자료 업로드·메일 재수집
  | "approve" // 미매칭·충돌·뉴스 게시 승인
  | "master_edit" // Channel Master·목표 등 기준 정보 변경
  | "rights_edit" // 권리(Avail) 정보 변경
  | "lock_override" // 수동 잠금 해제·덮어쓰기
  | "policy_edit" // 운영정책 변경
  | "schedule_finalize" // 편성안 확정
  | "schedule_edit" // 편성안 수동 수정(교체·잠금·되돌리기·재평가) — 사용자 결정(2026-10-07): 지금은 PD도 가능, 추후 부서별 권한으로 제한 예정(판정은 이 표 한 곳)
  | "schedule_upload" // 주간 편성표 업로드(해당 주의 편성표 행을 교체) — 사용자 결정(2026-10-06): 편성자도 가능
  | "channel_policy_edit" // 채널별 최적화 설정·필수 편성 변경 — 사용자 결정(2026-10-06): 편성자도 가능
  | "export"; // 내보내기

const RANK: Record<Role, number> = { viewer: 0, planner: 1, admin: 2 };

/** 행동별 최소 역할. 편성 확정·내보내기만 편성자에게 열려 있고, 자료 변경·승인·권리·정책은 관리자 전용이다. */
export const MIN_ROLE: Record<AdminAction, Role> = {
  view: "viewer",
  export: "planner",
  schedule_finalize: "planner",
  schedule_edit: "planner",
  // 아래 둘은 권한표가 실제 서버 동작(편성자 허용)과 어긋나 있던 것을 사용자 결정으로 맞춘 항목이다(단계 07).
  schedule_upload: "planner",
  channel_policy_edit: "planner",
  upload: "admin",
  approve: "admin",
  master_edit: "admin",
  rights_edit: "admin",
  lock_override: "admin",
  policy_edit: "admin",
};

export function roleOfSession(session: Pick<SessionPayload, "role"> | null | undefined): Role | null {
  if (!session) return null;
  if (session.role === "admin") return "admin";
  if (session.role === "pd") return "planner";
  return null;
}

export function can(role: Role | null, action: AdminAction): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[MIN_ROLE[action]];
}
