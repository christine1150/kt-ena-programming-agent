// 전역 탐색(단계 07) — 브리핑/채널분석/포트폴리오/편성비교/AI편성/콘텐츠·Avail/보고서/관리.
// 메뉴 노출은 세션 역할(permissions.ts의 can)로 정한다. 화면 숨김은 보안이 아니다 — 각 화면·API는 서버에서 따로 검사한다.
// 기존 URL은 하나도 바꾸지 않고 그대로 목적지로 쓴다(호환). 새 주소 체계로 옮기는 리다이렉트는 만들지 않았다.
import { can, type AdminAction, type Role } from "@/lib/admin/permissions";
import { hrefFor, type Destination, type ViewContext } from "./viewContext";

export type NavId = "briefing" | "channel" | "portfolio" | "compare" | "ai" | "content" | "reports" | "admin";

export interface NavExtraLink {
  label: string;
  dest: Destination;
  minAction: AdminAction;
}

export interface NavItem {
  id: NavId;
  label: string;
  /** 한 줄 설명(툴팁·접근성) */
  hint: string;
  dest: Destination;
  /** 이 메뉴를 보려면 필요한 행동 권한 */
  minAction: AdminAction;
  /** 같은 메뉴 안의 추가 진입점(권한이 있을 때만) */
  extra?: NavExtraLink[];
}

export const NAV_ITEMS: NavItem[] = [
  { id: "briefing", label: "브리핑", hint: "오늘 확인할 데이터 상태와 결정할 사항", dest: "home", minAction: "view" },
  { id: "channel", label: "채널 분석", hint: "채널별 진단·콘텐츠·편성·경쟁", dest: "channel", minAction: "view" },
  { id: "portfolio", label: "포트폴리오", hint: "채널 그룹 종합 보고", dest: "portfolio", minAction: "view" },
  { id: "compare", label: "편성 비교", hint: "주간 편성표 비교", dest: "schedule_grid", minAction: "view" },
  { id: "ai", label: "AI 편성", hint: "편성안 생성·비교·검토", dest: "ideal_schedule", minAction: "view" },
  { id: "content", label: "콘텐츠·Avail", hint: "구매 검토와 권리(Avail) 상태", dest: "purchase", minAction: "view", extra: [{ label: "Avail 관리", dest: "admin", minAction: "rights_edit" }] },
  { id: "reports", label: "보고서", hint: "채널 리포트(웹·Word·PPT)", dest: "report", minAction: "view" },
  { id: "admin", label: "관리", hint: "자료 업로드·기준 정보·점검", dest: "admin", minAction: "upload" },
];

/** 이 역할이 볼 수 있는 메뉴. 로그인 안 한 요청(role=null)에는 아무것도 보이지 않는다. */
export function visibleNav(role: Role | null): NavItem[] {
  return NAV_ITEMS.filter((i) => can(role, i.minAction));
}

export function visibleExtras(item: NavItem, role: Role | null): NavExtraLink[] {
  return (item.extra ?? []).filter((e) => can(role, e.minAction));
}

/** 현재 경로가 어느 메뉴에 속하는지. 구매 검토(/ideal-schedule/purchase)는 AI 편성이 아니라 콘텐츠·Avail이다. */
export function activeNavId(pathname: string): NavId | null {
  if (pathname === "/") return "briefing";
  if (pathname.startsWith("/channel")) return "channel";
  if (pathname.startsWith("/audience-report/portfolio")) return "portfolio";
  if (pathname.startsWith("/audience-report")) return "reports";
  if (pathname.startsWith("/schedule-grid")) return "compare";
  if (pathname.startsWith("/ideal-schedule/purchase")) return "content";
  if (pathname.startsWith("/ideal-schedule")) return "ai";
  if (pathname.startsWith("/admin")) return "admin";
  return null;
}

/** 메뉴 링크 — 현재 문맥(채널·기간·보기)을 목적지가 읽는 쿼리로 옮긴다. */
export function navHref(item: NavItem, ctx: ViewContext, resolvedDateTo?: string | null, extra: Record<string, string | null | undefined> = {}): string {
  return hrefFor(item.dest, ctx, extra, resolvedDateTo);
}

/**
 * 호환 대상 URL — 이번 단계에서 주소를 바꾸지 않으므로 기존 화면 경로가 전부 그대로 열려야 한다(테스트가 파일 존재를 검사).
 * `[x]`는 동적 세그먼트.
 */
export const COMPAT_ROUTES: { route: string; file: string; navId: NavId | null }[] = [
  { route: "/", file: "src/app/page.tsx", navId: "briefing" },
  { route: "/channel/[code]", file: "src/app/channel/[code]/page.tsx", navId: "channel" },
  { route: "/audience-report/portfolio", file: "src/app/audience-report/portfolio/page.tsx", navId: "portfolio" },
  { route: "/audience-report/[channel]", file: "src/app/audience-report/[channel]/page.tsx", navId: "reports" },
  { route: "/audience-report/view/[id]", file: "src/app/audience-report/view/[id]/page.tsx", navId: "reports" },
  { route: "/schedule-grid", file: "src/app/schedule-grid/page.tsx", navId: "compare" },
  { route: "/ideal-schedule", file: "src/app/ideal-schedule/page.tsx", navId: "ai" },
  { route: "/ideal-schedule/purchase", file: "src/app/ideal-schedule/purchase/page.tsx", navId: "content" },
  { route: "/admin", file: "src/app/admin/page.tsx", navId: "admin" },
  { route: "/admin/schedule-grid", file: "src/app/admin/schedule-grid/page.tsx", navId: "admin" },
  { route: "/admin/login-history", file: "src/app/admin/login-history/page.tsx", navId: "admin" },
  { route: "/admin/ask-gaps", file: "src/app/admin/ask-gaps/page.tsx", navId: "admin" },
];
