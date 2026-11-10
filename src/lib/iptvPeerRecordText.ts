// 구매 검토 "다른 채널 IPTV 성적" 블록의 타입·표시 규칙(순수, 화면·테스트 공용). 계산·조회는 iptvPeerRecord.ts(서버)와 DB 함수 iptv_peer_record.
// IPTV 는 보조 자료다 — 청약·공식 KPI 기준은 닐슨이고, 이 값은 닐슨 예측과 섞지 않고 따로 표기한다.

export type IptvTargetKind = "household" | "p2049";

export interface IptvPeerRow {
  channelName: string;
  channelGroup: "comp" | "uhd";
  targetKind: IptvTargetKind;
  windowFrom: string;
  windowTo: string;
  firstDate: string | null;
  lastDate: string | null;
  airings: number;
  firstRunAirings: number;
  mainSlotBand: string | null;
  avgRating: number | null;
  avgReachRate: number | null;
  minutesPerReacher: number | null;
  baseRating: number | null;
  baseN: number;
  ratio: number | null;
}

export interface IptvPeerRecord {
  /** 대응한 IPTV 프로그램 키(없으면 빈 배열 → 블록 없음) */
  keys: string[];
  asOf: string;
  /** 요청 기준일보다 IPTV 자료가 끝나 기준일을 당겼으면 true */
  shifted: boolean;
  weeks: number;
  rows: IptvPeerRow[];
}

/** 채널당 보여 줄 최대 행 수(타깃별) — 여러 채널에 재방송으로 깔린 작품이 화면을 덮지 않게 한다 */
export const PEER_MAX_ROWS_PER_TARGET = 6;
/** 이 방영 수 미만이면 한두 번 편성된 잡음으로 보고 표에서 뺀다 */
export const PEER_MIN_AIRINGS = 3;
/** 평소(같은 채널·시간대 다른 프로그램 본방) 표본이 이보다 적으면 배수를 '표본 적음'으로 표기한다 */
export const PEER_MIN_BASE_N = 20;
/** 본방 방영이 이보다 적으면 '표본 적음' */
export const PEER_MIN_FIRST_RUN = 4;

/** 요청 타깃(구매 검토의 A2049/HH) → IPTV 타깃 */
export function peerTargetKind(t: string): IptvTargetKind | null {
  if (t === "A2049") return "p2049";
  if (t === "HH") return "household";
  return null;
}

/** 타깃별로 방영 수 기준을 넘는 행만 본방 많은 순으로 추려 돌려준다(순수 함수). */
export function selectPeerRows(rows: IptvPeerRow[], kind: IptvTargetKind): IptvPeerRow[] {
  return rows
    .filter((r) => r.targetKind === kind && r.airings >= PEER_MIN_AIRINGS && r.avgRating !== null)
    .sort((a, b) => b.firstRunAirings - a.firstRunAirings || b.airings - a.airings || a.channelName.localeCompare(b.channelName, "ko"))
    .slice(0, PEER_MAX_ROWS_PER_TARGET);
}

export function isThinPeerSample(r: Pick<IptvPeerRow, "baseN" | "firstRunAirings" | "airings">): boolean {
  const first = r.firstRunAirings > 0 ? r.firstRunAirings : r.airings;
  return r.baseN < PEER_MIN_BASE_N || first < PEER_MIN_FIRST_RUN;
}

/** "평소의 1.58배" / 평소 값이 없으면 null */
export function peerRatioText(r: Pick<IptvPeerRow, "ratio">): string | null {
  return r.ratio === null ? null : `평소의 ${r.ratio.toFixed(2)}배`;
}

/** 본방이 하나도 없어(재방뿐) 전체 방영으로 요약한 행인가 */
export function isRerunOnlyPeer(r: Pick<IptvPeerRow, "firstRunAirings">): boolean {
  return r.firstRunAirings === 0;
}

/** 평소의 3배 이상이면 시간대 구간(8대)이 넓어 심야·새벽 낮은 편성과 견준 영향일 수 있어 참고용으로만 표기한다 */
export const PEER_WIDE_RATIO = 3;
export function isWideBandRatio(r: Pick<IptvPeerRow, "ratio">): boolean {
  return r.ratio !== null && r.ratio >= PEER_WIDE_RATIO;
}
