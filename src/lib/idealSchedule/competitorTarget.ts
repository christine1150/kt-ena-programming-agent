// 경쟁사 비교 타깃 선택 규칙(사용자 지시 2026-09-30):
// "경쟁사는 2049가 있으면 2049 기준, 가구가 있으면 가구 기준으로. 둘 다 있으면 둘 다 활용하되
//  기준이 되는 자사 채널의 KPI와 비교하여 선택할 수 있도록 한다."
// 실측(2026-07~09): 프로그램 단위(competitor_program_ratings)는 경쟁채널마다 타깃 1개(개인2049 또는
// 유료방송가구), 채널 단위(competitor_ratings)는 모든 경쟁채널에 두 타깃이 모두 있다.
import type { CompetitorTargetMode } from "./config";
import type { TargetKind } from "./types";

/** 타깃 라벨 → 종류. 시트마다 표기가 달라(개인2049 / 수도권 2049, 유료방송가구 / National 유료방송가입가구 /
 *  전국 유료가구) 핵심 문자열로 판정한다. 2039·3549 같은 다른 연령대는 OTHER. */
export function targetKindOfLabel(label: string | null | undefined): TargetKind {
  if (!label) return "NONE";
  if (label === "__SKYUHD__") return "HOUSEHOLD"; // skyUHD KPI = 유료방송가입가구(단일 값)
  if (/2049/.test(label)) return "2049";
  if (/유료/.test(label)) return "HOUSEHOLD";
  return "OTHER";
}

/** 채널 단위 일별 데이터에서 종류별로 쓸 라벨(우선순위 순). 자사 가구 KPI가 전국 기준이라 National 우선. */
export const DAILY_LABELS_BY_KIND: Record<"2049" | "HOUSEHOLD", string[]> = {
  "2049": ["개인2049"],
  HOUSEHOLD: ["National 유료방송가입가구", "수도권 유료방송가입가구"],
};

export interface CompetitorTargetChoice {
  kind: "2049" | "HOUSEHOLD";
  matchesOwnKpi: boolean;
  available: ("2049" | "HOUSEHOLD")[];
  reason: "ONLY_AVAILABLE" | "MATCH_OWN_KPI" | "USER_SELECTED" | "USER_SELECTED_UNAVAILABLE_FALLBACK";
}

/** 보유 타깃 중 비교 기준을 고른다. 2049/가구가 하나도 없으면 null(해당 경쟁사는 그 수준에서 사용 불가). */
export function chooseCompetitorTarget(
  availableKinds: TargetKind[],
  ownKpiKind: TargetKind,
  mode: CompetitorTargetMode
): CompetitorTargetChoice | null {
  const available = (["2049", "HOUSEHOLD"] as const).filter((k) => availableKinds.includes(k));
  if (available.length === 0) return null;
  const build = (kind: "2049" | "HOUSEHOLD", reason: CompetitorTargetChoice["reason"]): CompetitorTargetChoice => ({
    kind,
    matchesOwnKpi: kind === ownKpiKind,
    available: [...available],
    reason,
  });
  if (available.length === 1) {
    // 사용자가 다른 타깃을 골랐는데 이 경쟁사엔 한쪽만 있으면, 버리지 않고 보유 타깃으로 쓰되 사유를 남긴다.
    const fallback = mode !== "AUTO_MATCH_KPI" && mode !== available[0];
    return build(available[0], fallback ? "USER_SELECTED_UNAVAILABLE_FALLBACK" : "ONLY_AVAILABLE");
  }
  if (mode === "AUTO_MATCH_KPI") {
    const own = ownKpiKind === "2049" || ownKpiKind === "HOUSEHOLD" ? ownKpiKind : "2049";
    return build(own, "MATCH_OWN_KPI");
  }
  return build(mode, "USER_SELECTED");
}
