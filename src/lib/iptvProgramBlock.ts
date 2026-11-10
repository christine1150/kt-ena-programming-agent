// 프로그램 "IPTV 셋톱 보조 지표" 블록 — IPTV 활용 계획 3단계 3순위(2026-11-11 사용자 승인).
// 계산은 DB 함수 iptv_program_block(원칙 1)이 하고, 여기서는 ① 닐슨 작품 이름 → IPTV 프로그램 키 대응 ② 기준일 정리 ③ 화면 순서 정리만 한다.
// IPTV 는 보조 자료다(청약·공식 KPI 기준은 닐슨) — 값은 닐슨과 섞지 않고 따로 표기한다.
import { addDaysStr } from "./contentFit/engine";
import { matchIptvProgramKey } from "./contentFit/iptvCrossCheck";
import type { IptvProgramBlock, IptvProgramBlockRow } from "./iptvProgramBlockText";
export type { IptvProgramBlock, IptvProgramBlockRow } from "./iptvProgramBlockText";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export const IPTV_BLOCK_WEEKS = 12;
/** 요청 기준일이 IPTV 마지막 날짜보다 이만큼 넘게 늦으면 IPTV 마지막 날짜를 기준일로 쓴다(자료 종료 뒤에도 이력은 보이게, 계획 P2) */
const SHIFT_DAYS = 14;

const OWN_ORDER = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** 이름 목록 → IPTV 키(중복 없이). 순수 함수. */
export function matchIptvKeys(names: string[], ownKeys: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const k = matchIptvProgramKey(n, ownKeys);
    if (k) out.add(k);
  }
  return [...out];
}

export async function loadIptvProgramBlock(db: Db, args: { names: string[]; to?: string | null }): Promise<IptvProgramBlock | null> {
  const { data: lastRow } = await db.from("iptv_tvindex_airings").select("broadcast_date").eq("channel_group", "own").order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
  const iptvLast = (lastRow?.broadcast_date as string | undefined) ?? null;
  if (!iptvLast) return null;
  const requested = args.to ?? iptvLast;
  const shifted = requested > addDaysStr(iptvLast, SHIFT_DAYS);
  const asOf = shifted ? iptvLast : requested;
  const from = addDaysStr(asOf, -(IPTV_BLOCK_WEEKS * 7 - 1));

  const { data: keyRows, error: keyErr } = await db.rpc("iptv_own_program_keys", { p_from: from, p_to: asOf });
  if (keyErr) throw new Error(`IPTV 프로그램 키 조회 실패: ${keyErr.message}`);
  const keys = matchIptvKeys(args.names.filter(Boolean), ((keyRows ?? []) as { program_key: string }[]).map((r) => r.program_key));
  if (keys.length === 0) return { keys, asOf, shifted, rows: [] };

  const [{ data, error }, { data: map }] = await Promise.all([
    db.rpc("iptv_program_block", { p_keys: keys, p_to: asOf, p_weeks: IPTV_BLOCK_WEEKS }),
    db.from("iptv_channel_map").select("iptv_channel_name, nielsen_channel_code").eq("channel_group", "own"),
  ]);
  if (error) throw new Error(`IPTV 보조 지표 계산 실패: ${error.message}`);
  const codeByName = new Map(((map ?? []) as { iptv_channel_name: string; nielsen_channel_code: string | null }[]).map((m) => [m.iptv_channel_name, m.nielsen_channel_code]));
  const rows: IptvProgramBlockRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    channelName: r.channel_name as string,
    channelCode: codeByName.get(r.channel_name as string) ?? null,
    targetKind: r.target_kind as "household" | "p2049",
    windowFrom: r.window_from as string,
    windowTo: r.window_to as string,
    iptvLastDate: (r.iptv_last_date as string | null) ?? null,
    airings: Number(r.airings ?? 0),
    firstRunAirings: Number(r.first_run_airings ?? 0),
    mainSlotBand: (r.main_slot_band as string | null) ?? null,
    avgRating: num(r.avg_rating),
    avgReachRate: num(r.avg_reach_rate),
    minutesPerReacher: num(r.minutes_per_reacher),
    channelBaseMinutes: num(r.channel_base_minutes),
    channelBaseN: Number(r.channel_base_n ?? 0),
    peerN: Number(r.peer_n ?? 0),
    ratingRank: num(r.rating_rank),
    minutesRank: num(r.minutes_rank),
    topPeerChannel: (r.top_peer_channel as string | null) ?? null,
    topPeerProgram: (r.top_peer_program as string | null) ?? null,
    topPeerRating: num(r.top_peer_rating),
    channelAvgRating: num(r.channel_avg_rating),
    vsChannel: num(r.vs_channel),
  }));
  const ord = (c: string | null) => (c ? OWN_ORDER.indexOf(c) : 99);
  rows.sort((a, b) => ord(a.channelCode) - ord(b.channelCode) || (a.targetKind === b.targetKind ? 0 : a.targetKind === "p2049" ? -1 : 1));
  return { keys, asOf, shifted, rows };
}
