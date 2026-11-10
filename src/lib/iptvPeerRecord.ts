// 구매 검토 "다른 채널 IPTV 성적" 서버 조회 — IPTV 활용 계획 3단계 5순위(2026-11-11 사용자 승인).
// 계산은 DB 함수 iptv_peer_record(원칙 1)가 하고, 여기서는 ① 작품 이름 → IPTV 프로그램 키 대응 ② 기준일 정리 ③ 행 변환만 한다.
// 조회만 한다: 구매·권리·편성 쓰기를 일으키지 않는다. IPTV 는 보조 자료(청약·공식 KPI 기준은 닐슨).
import { addDaysStr } from "./contentFit/engine";
import { matchIptvKeys } from "./iptvProgramBlock";
import type { IptvPeerRecord, IptvPeerRow } from "./iptvPeerRecordText";
export type { IptvPeerRecord, IptvPeerRow } from "./iptvPeerRecordText";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export const IPTV_PEER_WEEKS = 52;
/** 요청 기준일이 IPTV 마지막 날짜보다 이만큼 넘게 늦으면 IPTV 마지막 날짜를 기준일로 쓴다(자료 종료 뒤에도 이력은 보이게, 계획 P2) */
const SHIFT_DAYS = 14;
const KEY_PAGE = 1000;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** 프로그램 키 전체(7천여 개)를 1000행씩 쪽으로 읽는다. 자료는 묶음으로만 바뀌므로 연결 객체별로 1시간 기억한다. */
const keyCache = new WeakMap<object, { at: number; keys: string[] }>();
const KEY_TTL_MS = 60 * 60 * 1000;
async function loadAllProgramKeys(db: Db): Promise<string[]> {
  const hit = keyCache.get(db);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.keys;
  const keys: string[] = [];
  for (let offset = 0; ; offset += KEY_PAGE) {
    const { data, error } = await db.rpc("iptv_all_program_keys", {}).order("program_key").range(offset, offset + KEY_PAGE - 1);
    if (error) throw new Error(`IPTV 프로그램 키 조회 실패: ${error.message}`);
    const page = (data ?? []) as { program_key: string }[];
    for (const r of page) keys.push(r.program_key);
    if (page.length < KEY_PAGE) break;
  }
  keyCache.set(db, { at: Date.now(), keys });
  return keys;
}

export async function loadIptvPeerRecord(db: Db, args: { names: string[]; to?: string | null }): Promise<IptvPeerRecord | null> {
  const { data: lastRow } = await db.from("iptv_tvindex_airings").select("broadcast_date").in("channel_group", ["comp", "uhd"]).order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
  const iptvLast = (lastRow?.broadcast_date as string | undefined) ?? null;
  if (!iptvLast) return null;
  const requested = args.to ?? iptvLast;
  const shifted = requested > addDaysStr(iptvLast, SHIFT_DAYS);
  const asOf = shifted ? iptvLast : requested;

  const allKeys = await loadAllProgramKeys(db);
  const keys = matchIptvKeys(args.names.filter(Boolean), allKeys);
  if (keys.length === 0) return { keys, asOf, shifted, weeks: IPTV_PEER_WEEKS, rows: [] };

  const { data, error } = await db.rpc("iptv_peer_record", { p_keys: keys, p_to: asOf, p_weeks: IPTV_PEER_WEEKS });
  if (error) throw new Error(`IPTV 다른 채널 성적 계산 실패: ${error.message}`);
  const rows: IptvPeerRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    channelName: r.channel_name as string,
    channelGroup: r.channel_group as "comp" | "uhd",
    targetKind: r.target_kind as "household" | "p2049",
    windowFrom: r.window_from as string,
    windowTo: r.window_to as string,
    firstDate: (r.first_date as string | null) ?? null,
    lastDate: (r.last_date as string | null) ?? null,
    airings: Number(r.airings ?? 0),
    firstRunAirings: Number(r.first_run_airings ?? 0),
    mainSlotBand: (r.main_slot_band as string | null) ?? null,
    avgRating: num(r.avg_rating),
    avgReachRate: num(r.avg_reach_rate),
    minutesPerReacher: num(r.minutes_per_reacher),
    baseRating: num(r.base_rating),
    baseN: Number(r.base_n ?? 0),
    ratio: num(r.ratio),
    channelAvgRating: num(r.channel_avg_rating),
    vsChannel: num(r.vs_channel),
  }));
  return { keys, asOf, shifted, weeks: IPTV_PEER_WEEKS, rows };
}
