// 콘텐츠 구매 검토(단계 13) — 칸별 권리 판정을 구매 검토 화면의 표시로 바꾼다(순수 함수).
// 핵심 규칙: 실행 가능(권리상)은 "보유 + 그 칸 권리 available"일 때뿐이다. 보유 예정(Avail 행 있음/권리 획득 가정)·확인 못함은 어떤 판정이어도 실행 가능이 아니다.
// 이 화면은 조회·비교만 한다 — 판정이 available이어도 구매 요청·권리 예약·편성 저장을 일으키지 않는다.
import { RIGHTS_LABEL, type SlotRights } from "@/lib/idealSchedule/slotRights";
import type { AcquisitionStage, PlannedBasis } from "./acquisition";

export type RightsTone = "ok" | "warn" | "bad" | "muted";

export interface PurchaseRightsView {
  /** 칸 판정이 없으면(요일·시각 미지정) null */
  slotStatus: SlotRights["status"] | null;
  chip: string;
  tone: RightsTone;
  /** 권리상 실행 가능 — 보유 + available 에서만 true */
  executable: boolean;
  /** 권리 획득을 가정한 값인가(보유 예정 가정·시작 전) */
  assumed: boolean;
  lines: string[];
}

const NEVER_AIRED = "이 채널에서 방영한 적이 없다는 사실은 구매 가능성의 증거가 아닙니다.";

export function purchaseRightsView(stage: AcquisitionStage, plannedBasis: PlannedBasis | null, slot: SlotRights | null): PurchaseRightsView {
  const base = { slotStatus: slot?.status ?? null, executable: false, assumed: false, lines: [] as string[] };
  if (stage === "NO_AVAIL_DATA") return { ...base, chip: "권리 확인 못함(Avail 미입력)", tone: "muted", lines: ["Avail 자료가 없어 어떤 칸도 실행 가능으로 표시하지 않습니다."] };
  if (stage === "NEEDS_LINK") return { ...base, chip: "Avail 연결 확인 필요", tone: "warn", lines: ["같은 콘텐츠인지 확인되기 전에는 권리를 판정하지 않습니다(관리자 > Avail에서 연결 확인)."] };
  if (stage === "PLANNED") {
    const lines =
      plannedBasis === "assumed"
        ? ["권리를 얻는다고 가정한 시뮬레이션입니다. 실행 가능이 아닙니다.", NEVER_AIRED]
        : ["Avail 권리 시작 전이거나 확보 중인 예정작입니다. 시작·조건이 확인되기 전에는 실행 가능이 아닙니다."];
    if (slot && slot.status === "unavailable" && plannedBasis === "avail_row") lines.push(`이 칸은 현재 Avail 기준으로 불가입니다${slot.reasons[0] ? `(${slot.reasons[0]})` : ""}.`);
    return { ...base, assumed: true, chip: plannedBasis === "assumed" ? "보유 예정(가정) — 실행 가능 아님" : "보유 예정 — 실행 가능 아님", tone: "warn", lines };
  }
  // OWNED: 칸별 판정을 그대로 따른다
  if (!slot) return { ...base, chip: "보유 — 칸을 정하면 권리를 확인합니다", tone: "muted", lines: ["요일·시각을 정하면 그 칸의 기간·방수·조건을 판정합니다."] };
  const why = slot.reasons.slice(0, 2).join(" / ");
  switch (slot.status) {
    case "available":
      return { ...base, executable: true, chip: `보유 · ${RIGHTS_LABEL.available}`, tone: "ok", lines: ["권리상 편성할 수 있는 칸입니다(구매·편성 확정이 아닌 조회 결과)."] };
    case "unavailable":
      return { ...base, chip: `보유 · ${RIGHTS_LABEL.unavailable}`, tone: "bad", lines: [why || "권리상 이 칸에는 편성할 수 없습니다."] };
    case "conditional":
      return { ...base, assumed: true, chip: `보유 · ${RIGHTS_LABEL.conditional}`, tone: "warn", lines: [why || "조건이 충족되기 전에는 실행 가능이 아닙니다."] };
    default:
      return { ...base, chip: `보유 · ${RIGHTS_LABEL[slot.status]}`, tone: "warn", lines: [why || "권리를 확인하지 못해 실행 가능으로 표시하지 않습니다."] };
  }
}
