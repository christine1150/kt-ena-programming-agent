// 시간대 경쟁 지도(D1)·UHD 벤치마크(D3)의 타입·표시 규칙(순수, 화면·테스트 공용). 계산은 DB 함수 iptv_slot_rivals·iptv_uhd_benchmark.
// IPTV 는 보조 자료다 — 청약·공식 KPI 기준은 닐슨이고 이 값은 따로 표기한다. 비중은 "관측 채널 합계 대비"이며 점유율이 아니다.

export type IptvKind = "household" | "p2049";
export type DowGroup = "weekday" | "sat" | "sun";

export interface SlotRivalRow {
  dowGroup: DowGroup;
  slotBand: string;
  windowFrom: string;
  windowTo: string;
  ownAirings: number;
  ownRating: number;
  observedChannels: number;
  ownRank: number;
  /** 관측 채널 합계 대비 우리 비중(0~1) — 점유율 아님 */
  ownShare: number | null;
  topRivalChannel: string | null;
  topRivalGroup: string | null;
  topRivalRating: number | null;
}
export interface SlotRivalMap {
  channelName: string;
  targetKind: IptvKind;
  asOf: string;
  shifted: boolean;
  weeks: number;
  rows: SlotRivalRow[];
}

export interface UhdBenchRow {
  channelName: string;
  isSky: boolean;
  slotBand: string;
  windowFrom: string;
  windowTo: string;
  airings: number;
  avgRating: number | null;
  prevAvgRating: number | null;
  avgReachRate: number | null;
  minutesPerReacher: number | null;
  ratingRank: number | null;
  channelsRanked: number;
}
export interface UhdBenchmark {
  asOf: string;
  shifted: boolean;
  weeks: number;
  rows: UhdBenchRow[];
}

/** 닐슨 채널 코드 → IPTV 채널명(iptv_channel_map 과 같은 대응) */
export const IPTV_NAME_BY_CODE: Record<string, string> = { ENA: "ENA", ENA_DRAMA: "ENA Drama", ENA_PLAY: "ENA Play", ENA_STORY: "ENA Story", OLIFE: "OLIFE", ONCE: "ONCE", SKYUHD: "skyUHD" };
/** 채널 KPI 타깃: A군(ENA·ENA Drama·ENA Play)은 수도권 2049, 나머지는 가구 */
export function slotMapKindOf(channelCode: string): IptvKind {
  return ["ENA", "ENA_DRAMA", "ENA_PLAY"].includes(channelCode) ? "p2049" : "household";
}

export const DOW_GROUPS: { key: DowGroup; label: string }[] = [
  { key: "weekday", label: "평일(월~금)" },
  { key: "sat", label: "토요일" },
  { key: "sun", label: "일요일" },
];
/** 화면 표시 순서(방송일 기준 새벽 → 밤 → 심야) */
export const SLOT_BAND_ORDER = ["02-05", "05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02"];
export const bandLabel = (b: string) => (b === "all" ? "전체" : `${Number(b.slice(0, 2))}~${Number(b.slice(3, 5))}시`);

/** 한 요일 묶음의 행을 시간대 순서로 정렬해 돌려준다(순수). */
export function rowsOfGroup(rows: SlotRivalRow[], g: DowGroup): SlotRivalRow[] {
  return rows.filter((r) => r.dowGroup === g).sort((a, b) => SLOT_BAND_ORDER.indexOf(a.slotBand) - SLOT_BAND_ORDER.indexOf(b.slotBand));
}

/** "22개 중 7위" */
export const rankText = (rank: number, n: number) => `${n}개 중 ${rank}위`;

/** 우리가 최강 경쟁 채널 시청률의 몇 %인지(경쟁이 없거나 0이면 null) */
export function vsTopRivalPct(ownRating: number, topRival: number | null): number | null {
  return topRival !== null && topRival > 0 ? (ownRating / topRival) * 100 : null;
}

/** 순위 상위 1/3 안이면 "top", 하위 1/3이면 "low", 그 사이는 "mid" — 색 대신 글로 위치를 말한다. */
export function rankTier(rank: number, n: number): "top" | "mid" | "low" {
  if (n <= 0) return "mid";
  const q = rank / n;
  return q <= 1 / 3 ? "top" : q > 2 / 3 ? "low" : "mid";
}

/** UHD 벤치마크: 전체 행을 순위순으로 돌려준다(순수). */
export function uhdOverall(rows: UhdBenchRow[]): UhdBenchRow[] {
  return rows.filter((r) => r.slotBand === "all").sort((a, b) => (a.ratingRank ?? 99) - (b.ratingRank ?? 99) || a.channelName.localeCompare(b.channelName));
}
/** skyUHD 시간대별 행을 시간대 순서로 돌려준다(순수). */
export function skyBands(rows: UhdBenchRow[]): UhdBenchRow[] {
  return rows.filter((r) => r.isSky && r.slotBand !== "all").sort((a, b) => SLOT_BAND_ORDER.indexOf(a.slotBand) - SLOT_BAND_ORDER.indexOf(b.slotBand));
}
/** 직전 같은 기간 대비 시청률 변화율(%) — 직전 값이 없거나 0이면 null */
export function changePct(cur: number | null, prev: number | null): number | null {
  return cur !== null && prev !== null && prev > 0 ? ((cur - prev) / prev) * 100 : null;
}
