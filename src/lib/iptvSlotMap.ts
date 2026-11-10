// 시간대 경쟁 지도(D1)·UHD 벤치마크(D3) 서버 조회 — IPTV 활용 계획 3단계 6순위(2026-11-11 사용자 승인).
// 계산은 DB 함수 iptv_slot_rivals·iptv_uhd_benchmark(원칙 1)가 하고, 여기서는 기준일 정리와 행 변환만 한다. 조회만 한다.
import { addDaysStr } from "./contentFit/engine";
import { IPTV_NAME_BY_CODE, slotMapKindOf, type DowGroup, type IptvKind, type SlotRivalMap, type SlotRivalRow, type UhdBenchmark, type UhdBenchRow } from "./iptvSlotMapText";
export type { SlotRivalMap, SlotRivalRow, UhdBenchmark, UhdBenchRow } from "./iptvSlotMapText";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export const SLOT_MAP_WEEKS = 12;
/** 요청 기준일이 IPTV 마지막 날짜보다 이만큼 넘게 늦으면 IPTV 마지막 날짜를 기준일로 쓴다(자료 종료 뒤에도 이력은 보이게, 계획 P2) */
const SHIFT_DAYS = 14;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** 요청 기준일 → 실제 기준일(IPTV 마지막 날 기준으로 당김). IPTV 자료가 없으면 null. */
export async function resolveIptvAsOf(db: Db, to: string | null | undefined): Promise<{ asOf: string; shifted: boolean } | null> {
  const { data } = await db.from("iptv_tvindex_airings").select("broadcast_date").in("channel_group", ["comp", "uhd"]).order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
  const last = (data?.broadcast_date as string | undefined) ?? null;
  if (!last) return null;
  const requested = to ?? last;
  const shifted = requested > addDaysStr(last, SHIFT_DAYS);
  return { asOf: shifted ? last : requested, shifted };
}

export async function loadSlotRivals(db: Db, args: { channelCode: string; to?: string | null }): Promise<SlotRivalMap | null> {
  const channelName = IPTV_NAME_BY_CODE[args.channelCode];
  if (!channelName) return null;
  const when = await resolveIptvAsOf(db, args.to);
  if (!when) return null;
  const kind: IptvKind = slotMapKindOf(args.channelCode);
  const { data, error } = await db.rpc("iptv_slot_rivals", { p_channel: channelName, p_target: kind, p_to: when.asOf, p_weeks: SLOT_MAP_WEEKS });
  if (error) throw new Error(`IPTV 시간대 경쟁 지도 계산 실패: ${error.message}`);
  const rows: SlotRivalRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    dowGroup: r.dow_group as DowGroup,
    slotBand: r.slot_band as string,
    windowFrom: r.window_from as string,
    windowTo: r.window_to as string,
    ownAirings: Number(r.own_airings ?? 0),
    ownRating: Number(r.own_rating),
    observedChannels: Number(r.observed_channels ?? 0),
    ownRank: Number(r.own_rank ?? 0),
    ownShare: num(r.own_share),
    topRivalChannel: (r.top_rival_channel as string | null) ?? null,
    topRivalGroup: (r.top_rival_group as string | null) ?? null,
    topRivalRating: num(r.top_rival_rating),
  }));
  return { channelName, targetKind: kind, asOf: when.asOf, shifted: when.shifted, weeks: SLOT_MAP_WEEKS, rows };
}

export async function loadUhdBenchmark(db: Db, args: { to?: string | null }): Promise<UhdBenchmark | null> {
  const when = await resolveIptvAsOf(db, args.to);
  if (!when) return null;
  const { data, error } = await db.rpc("iptv_uhd_benchmark", { p_to: when.asOf, p_weeks: SLOT_MAP_WEEKS });
  if (error) throw new Error(`IPTV UHD 벤치마크 계산 실패: ${error.message}`);
  const rows: UhdBenchRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    channelName: r.channel_name as string,
    isSky: r.is_sky === true,
    slotBand: r.slot_band as string,
    windowFrom: r.window_from as string,
    windowTo: r.window_to as string,
    airings: Number(r.airings ?? 0),
    avgRating: num(r.avg_rating),
    prevAvgRating: num(r.prev_avg_rating),
    avgReachRate: num(r.avg_reach_rate),
    minutesPerReacher: num(r.minutes_per_reacher),
    ratingRank: num(r.rating_rank),
    channelsRanked: Number(r.channels_ranked ?? 0),
  }));
  return { asOf: when.asOf, shifted: when.shifted, weeks: SLOT_MAP_WEEKS, rows };
}
