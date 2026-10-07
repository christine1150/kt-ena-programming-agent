// 편성 칸의 권리 상태(OPT06) — 순수 함수. 수동 교체·후보 목록·확정 준비 검사가 같은 문구와 같은 판정을 쓴다.
//
// 원칙(공통작업지침·단계 06)
//  · 권리상 불가(unavailable)는 수동 교체에서도 막는다 — 정책이 아니라 오류 수정이다(엔진 게이트는 AI 배치만 막았고 수동 교체는 우회했다).
//  · 조건부·미확인은 "검토안"으로는 둘 수 있지만 실행 가능으로 표시하지 않는다.
//  · Avail 자료가 없거나 판정이 실패하면 "확인하지 못함"이지 "가능"이 아니다.
//  · 조회만으로 권리 예약·편성 저장이 일어나지 않는다(이 모듈은 값을 만들 뿐이다).
import { addDaysIso } from "@/lib/avail/dates";
import type { EligibilityResult, EligibilityStatus } from "@/lib/avail/types";

export type SlotRightsStatus = EligibilityStatus | "not_checked";

export interface SlotRights {
  status: SlotRightsStatus;
  label: string;
  reasonCodes: string[];
  reasons: string[];
  remaining: number | null;
  /** 회차를 지정하지 않고 판정했을 때 쓸 수 있는 회차(없으면 null) — 회차 미지정 칸의 공유 잔여 횟수 추정에 쓴다 */
  eligibleEpisodes: number[] | null;
  expiresOn: string | null;
  inventoryVersion: string | null;
  grantRevisionIds: string[];
  assumptions: string[];
}

export const RIGHTS_LABEL: Record<SlotRightsStatus, string> = {
  available: "권리 확인됨",
  conditional: "조건부 가정(조건 충족 전)",
  unknown: "권리 미확인",
  unavailable: "권리상 불가",
  not_checked: "권리 확인 안 함",
};

export const NOT_CHECKED_REASONS = {
  /** Avail 자료가 입력되지 않았거나 판정에 실패해 확인하지 못함 */
  NO_AVAIL: "Avail(권리) 자료가 없어 확인하지 못했습니다 — 성과 분석은 가능하지만 실행 가능 여부는 판정하지 못합니다.",
  /** 경쟁 Benchmark·장르 원형은 권리 판정 대상(실제 편성 프로그램)이 아니다 */
  VIRTUAL: "경쟁 Benchmark·장르 원형은 실제 편성할 수 있는 프로그램이 아니라 권리를 판정하지 않습니다.",
} as const;

export function notChecked(code: keyof typeof NOT_CHECKED_REASONS, message?: string | null): SlotRights {
  return { status: "not_checked", label: RIGHTS_LABEL.not_checked, reasonCodes: [code === "NO_AVAIL" ? "AVAIL_NOT_LOADED" : "NOT_RIGHTS_SUBJECT"], reasons: [message || NOT_CHECKED_REASONS[code]], remaining: null, eligibleEpisodes: null, expiresOn: null, inventoryVersion: null, grantRevisionIds: [], assumptions: [] };
}

export function slotRightsOf(r: EligibilityResult): SlotRights {
  return {
    status: r.status,
    label: RIGHTS_LABEL[r.status],
    reasonCodes: r.reasonCodes,
    reasons: r.reasons,
    remaining: r.remaining,
    eligibleEpisodes: r.eligibleEpisodes,
    expiresOn: r.expiresOn,
    inventoryVersion: r.inventoryVersion,
    grantRevisionIds: r.grantRevisionIds,
    assumptions: r.assumptions,
  };
}

/** 실행 가능 표시에 쓸 수 있는 상태는 권리가 확인된(available) 것뿐이다. */
export const isExecutableRights = (s: SlotRightsStatus): boolean => s === "available";

export interface SwapRightsVerdict {
  /** false면 교체를 거부한다(권리상 불가) */
  allowed: boolean;
  /** true면 교체는 되지만 실행 가능으로 표시하지 않고 확인이 필요하다 */
  reviewOnly: boolean;
  message: string | null;
}

export function swapRightsVerdict(r: SlotRights): SwapRightsVerdict {
  const why = r.reasons.length ? ` (${r.reasons.slice(0, 2).join(" / ")})` : "";
  switch (r.status) {
    case "unavailable":
      return { allowed: false, reviewOnly: false, message: `이 자리에는 권리상 편성할 수 없습니다${why}` };
    case "conditional":
      return { allowed: true, reviewOnly: true, message: `조건부 가정입니다 — 조건이 충족되기 전에는 실행 가능으로 보지 않습니다${why}` };
    case "unknown":
      return { allowed: true, reviewOnly: true, message: `권리를 확인하지 못했습니다 — 검토안으로만 두고 실행 가능으로 보지 않습니다${why}` };
    case "not_checked":
      return { allowed: true, reviewOnly: true, message: r.reasons[0] ?? NOT_CHECKED_REASONS.NO_AVAIL };
    default:
      return { allowed: true, reviewOnly: false, message: null };
  }
}

/** 권리 판정에 쓰는 방송일(대상 주 월요일 + 요일 − 1) — 엔진 게이트(selector.makeSlotGate)와 같은 계산. 닐슨 방송일 기준이라 24시 이후도 같은 날이다. */
export const broadcastDateOf = (weekStart: string, weekday: number): string => addDaysIso(weekStart, weekday - 1);
