// IPTV 교차 확인 표시 문구(순수 함수, 화면·테스트 공용). 판단 근거·계산은 iptvCrossCheck.ts(서버).
// IPTV 셋톱은 보조 자료 — 문구는 닐슨 판정을 뒤집지 않고 "확신도"만 말한다(docs/iptv/IPTV_RESEARCH_RESULTS.md 해석 원칙).
import type { ContentFitTag } from "./types";

export type IptvCrossCheckStatusView = "SAME" | "SOFTER" | "OPPOSITE" | "IPTV_SAMPLE_LOW" | "NO_MATCH";
export interface IptvCrossCheckView {
  status: IptvCrossCheckStatusView;
  iptvTag: ContentFitTag | null;
}
export interface IptvCrossCheckMetaView {
  iptvAsOf: string | null;
  skippedReason: string | null;
}

const TAG_KO: Record<ContentFitTag, string> = { STRENGTHEN: "강화", KEEP: "유지", WATCH: "관찰", MOVE: "이동", REPLACE: "교체", TEST: "테스트" };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * 교체·이동 판정 옆에 붙일 한 줄. tone: same=같은 방향(확신 보강), soft=IPTV는 완화(관찰), opposite=반대(교체 전 재확인), none=비교 불가.
 * 비교하지 않은 경우(자료 종료 등)에는 null — 화면에 아무것도 붙이지 않는다.
 */
export function describeIptvCrossCheck(
  check: IptvCrossCheckView | null | undefined,
  meta: IptvCrossCheckMetaView | null | undefined
): { label: string; detail: string; tone: "same" | "soft" | "opposite" | "none" } | null {
  if (!check || !meta || meta.skippedReason || !meta.iptvAsOf) return null;
  const base = `IPTV 셋톱(보조, ${md(meta.iptvAsOf)} 기준)`;
  switch (check.status) {
    case "SAME":
      return { label: `${base}에서도 ${TAG_KO[check.iptvTag ?? "REPLACE"]}`, detail: "두 자료가 같은 방향이라 판정 확신이 높습니다", tone: "same" };
    case "SOFTER":
      return { label: `${base}에서는 관찰`, detail: "닐슨 회차 변동이 섞였을 수 있어 2~4주 더 확인한 뒤 결정을 권합니다", tone: "soft" };
    case "OPPOSITE":
      return { label: `${base}에서는 ${TAG_KO[check.iptvTag ?? "KEEP"]}`, detail: "두 자료 방향이 반대이니 교체 전 시청 흐름을 다시 확인하세요", tone: "opposite" };
    case "IPTV_SAMPLE_LOW":
      return { label: `${base}: 표본이 적어 판정 없음`, detail: "", tone: "none" };
    case "NO_MATCH":
      return { label: `${base}: 같은 프로그램 자료 없음`, detail: "", tone: "none" };
  }
}

export const IPTV_CROSS_CHECK_NOTE =
  "IPTV 셋톱 교차 확인은 보조 자료입니다. 판정과 점수는 닐슨 기준 그대로이며, 같은 엔진을 IPTV 3사 셋톱 시청률(시청률만)에 돌린 방향을 교체·이동 판정 옆에 붙였습니다. IPTV 값 자체를 닐슨과 바꿔 쓰지 않습니다.";
