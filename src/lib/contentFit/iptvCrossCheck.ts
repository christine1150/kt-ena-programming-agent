// 콘텐츠 적합도 "IPTV 교차 확인"(IPTV 활용 계획 3단계 1순위, 2026-11-11 사용자 승인).
// 닐슨 판정(점수·태그)은 그대로 두고, 같은 엔진(computeContentFit)을 IPTV 셋톱 방영 값에 돌린 판정 방향을 옆에 붙인다.
// IPTV 는 보조 자료다 — 청약·공식 KPI 기준은 닐슨이고, 이 표시는 "교체·이동 판정의 확신도"를 보강하는 근거로만 쓴다
// (docs/iptv/IPTV_RESEARCH_RESULTS.md A2: 엇갈림은 대부분 닐슨 교체 → IPTV 관찰, A군 2049 닐슨 판정 4주 뒤집힘 25~35% vs IPTV 9~11%).
// 비교 조건: 도달·시청시간 비율은 두 자료의 정의가 달라 IPTV 쪽은 시청률만으로 판정한다. 프로그램은 정규화한 이름(program_key)으로 맞춘다.
// 자료가 끊겨도 깨지지 않게(계획 P2): IPTV 마지막 날짜가 기준일보다 STALE_DAYS 넘게 이르면 비교하지 않는다.
import { CONTENT_FIT_CONFIG } from "./config";
import { addDaysStr, computeContentFit } from "./engine";
import type { ContentFitAiring, ContentFitItem, ContentFitTag } from "./types";
import { normalizeProgramCanonicalName } from "../programNameMatch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/** IPTV 마지막 날짜가 닐슨 기준일보다 이 일수를 넘게 이르면 "자료 없음"으로 둔다(12주 창의 1/6 정도 어긋남까지만 허용). */
export const IPTV_CROSS_CHECK_STALE_DAYS = 14;
/** 교차 확인을 붙이는 닐슨 판정(결정이 필요한 아래쪽 판정부터 — 계획 3단계 1순위). */
export const IPTV_CROSS_CHECK_TAGS: ContentFitTag[] = ["REPLACE", "MOVE"];

export type IptvCrossCheckStatus =
  | "SAME" // IPTV 에서도 교체·이동
  | "SOFTER" // IPTV 에서는 관찰
  | "OPPOSITE" // IPTV 에서는 유지·강화
  | "IPTV_SAMPLE_LOW" // IPTV 표본이 적어 정식 판정 없음
  | "NO_MATCH"; // IPTV 에서 같은 프로그램을 찾지 못함

export interface IptvCrossCheck {
  status: IptvCrossCheckStatus;
  iptvTag: ContentFitTag | null;
  /** 맞춘 IPTV 프로그램 키(점검용) */
  iptvProgramKey?: string | null;
}
export interface IptvCrossCheckMeta {
  /** IPTV 판정 기준일(닐슨 기준일과 IPTV 마지막 날짜 중 이른 날) */
  iptvAsOf: string | null;
  /** IPTV 자료 마지막 날짜(채널·타깃) */
  iptvLastDate: string | null;
  targetKind: "household" | "p2049" | null;
  /** 비교하지 않은 이유(자료 없음·오래됨). 비교했으면 null */
  skippedReason: string | null;
}

const dirOf = (t: ContentFitTag | null): "up" | "mid" | "down" | null =>
  t === "STRENGTHEN" || t === "KEEP" ? "up" : t === "WATCH" ? "mid" : t === "REPLACE" || t === "MOVE" ? "down" : null;

/** 닐슨 판정과 IPTV 엔진 결과 한 건을 비교한다(순수 함수). */
export function classifyIptvCrossCheck(iptv: Pick<ContentFitItem, "tier" | "tag"> | null): IptvCrossCheck {
  if (!iptv) return { status: "NO_MATCH", iptvTag: null };
  if (iptv.tier !== "FORMAL" || !iptv.tag) return { status: "IPTV_SAMPLE_LOW", iptvTag: null };
  const d = dirOf(iptv.tag);
  return { status: d === "down" ? "SAME" : d === "mid" ? "SOFTER" : "OPPOSITE", iptvTag: iptv.tag };
}

const MIN_CONTAIN_LEN = 3;
const stripSeason = (s: string) => s.replace(/시즌/g, "");
/**
 * 닐슨 프로그램 이름(정규화) → IPTV program_key(순수 함수). IPTV 제목은 닐슨보다 짧은 경우가 많다
 * (예: 닐슨 "캐리어하나로떠나는주문짐쌀라비움" ↔ IPTV "짐쌀라비움", "로앤오더…인텐트2" ↔ "로앤오더…인텐트시즌2").
 * 1) "시즌" 표기를 뺀 뒤 같으면 그대로, 2) 한쪽이 다른 쪽을 포함(짧은 쪽 3자 이상)하면 가장 길게 겹치는 후보.
 * 닐슨 이름에 "스페셜"이 있는데 IPTV 후보에 없으면 본편과 다른 방영이라 맞추지 않는다(본편 판정을 스페셜에 붙이지 않기 위해).
 */
export function matchIptvProgramKey(nielsenName: string, iptvKeys: Iterable<string>): string | null {
  const n = stripSeason(normalizeProgramCanonicalName(nielsenName));
  if (!n) return null;
  const special = n.includes("스페셜");
  let best: { key: string; len: number } | null = null;
  for (const key of iptvKeys) {
    const k = stripSeason(key);
    if (!k) continue;
    if (special && !k.includes("스페셜")) continue;
    if (k === n) return key;
    const shorter = k.length <= n.length ? k : n;
    if (shorter.length < MIN_CONTAIN_LEN) continue;
    if (!(n.includes(k) || k.includes(n))) continue;
    if (!best || shorter.length > best.len || (shorter.length === best.len && key < best.key)) best = { key, len: shorter.length };
  }
  return best?.key ?? null;
}

/** 닐슨 KPI 타깃 라벨 → IPTV 타깃 */
export function iptvTargetKindOf(kpiTargetLabel: string): "household" | "p2049" | null {
  if (/2049/.test(kpiTargetLabel)) return "p2049";
  if (/유료/.test(kpiTargetLabel) || /가구/.test(kpiTargetLabel)) return "household";
  return null;
}

const hhmmss = (startMinute: number) => {
  const m = startMinute % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
};

/**
 * 채널·KPI 타깃·기준일에 대해 IPTV 엔진 판정을 계산하고, 주어진 닐슨 프로그램(정규화 이름)별 교차 확인을 돌려준다.
 * programNames: 닐슨 programId → 정식 이름(canonical_name). 결과는 IPTV_CROSS_CHECK_TAGS 판정을 받은 프로그램에만 붙이면 된다.
 */
export async function loadIptvCrossCheck(
  db: Db,
  args: { channelCode: string; kpiTargetLabel: string; asOf: string; programNames: Map<string, string> }
): Promise<{ meta: IptvCrossCheckMeta; byProgramId: Map<string, IptvCrossCheck> }> {
  const byProgramId = new Map<string, IptvCrossCheck>();
  const targetKind = iptvTargetKindOf(args.kpiTargetLabel);
  const empty = (reason: string, last: string | null = null) => ({
    meta: { iptvAsOf: null, iptvLastDate: last, targetKind, skippedReason: reason },
    byProgramId,
  });
  if (!targetKind) return empty("IPTV에 대응하는 타깃이 없음");

  const { data: map } = await db.from("iptv_channel_map").select("iptv_channel_name").eq("nielsen_channel_code", args.channelCode).maybeSingle();
  const channelName = (map?.iptv_channel_name as string | undefined) ?? null;
  if (!channelName) return empty("IPTV 자료에 없는 채널");

  const { data: last } = await db
    .from("iptv_tvindex_airings")
    .select("broadcast_date")
    .eq("channel_name", channelName)
    .eq("target_kind", targetKind)
    .lte("broadcast_date", args.asOf)
    .order("broadcast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastDate = (last?.broadcast_date as string | undefined) ?? null;
  if (!lastDate) return empty("IPTV 자료 없음");
  if (lastDate < addDaysStr(args.asOf, -IPTV_CROSS_CHECK_STALE_DAYS)) return empty(`IPTV 자료가 ${lastDate}까지라 비교하지 않음`, lastDate);

  const iptvAsOf = lastDate < args.asOf ? lastDate : args.asOf;
  const from = addDaysStr(iptvAsOf, -(CONTENT_FIT_CONFIG.windowDays - 1));
  const airings: ContentFitAiring[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("iptv_tvindex_airings")
      .select("broadcast_date, start_minute, program_key, is_rerun_tag, rating")
      .eq("channel_name", channelName)
      .eq("target_kind", targetKind)
      .gte("broadcast_date", from)
      .lte("broadcast_date", iptvAsOf)
      .order("broadcast_date", { ascending: true })
      .order("start_minute", { ascending: true })
      .order("program_key", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`IPTV 방영 행 조회 실패: ${error.message}`);
    const rows = (data ?? []) as { broadcast_date: string; start_minute: number; program_key: string; is_rerun_tag: boolean; rating: number | null }[];
    for (const r of rows) {
      if (r.rating === null || r.rating === undefined) continue;
      airings.push({ programId: r.program_key, date: r.broadcast_date, startTime: hhmmss(r.start_minute), rating: Number(r.rating), reach: null, timeSpentShare: null, firstRun: !r.is_rerun_tag });
    }
    if (rows.length < 1000) break;
  }
  const result = computeContentFit(airings, iptvAsOf);
  const byKey = new Map(result.items.map((it) => [it.programId, it]));
  for (const [programId, name] of args.programNames) {
    const key = matchIptvProgramKey(name, byKey.keys());
    byProgramId.set(programId, { ...classifyIptvCrossCheck(key ? byKey.get(key) ?? null : null), iptvProgramKey: key });
  }
  return { meta: { iptvAsOf, iptvLastDate: lastDate, targetKind, skippedReason: null }, byProgramId };
}
