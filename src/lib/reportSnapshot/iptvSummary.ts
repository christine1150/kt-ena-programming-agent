// 주간·월간 채널 보고서의 "IPTV 셋톱 요약" 조회(서버 전용) — 스냅샷 생성 시점에 한 번 읽어 extras 에 저장한다.
// 계산은 DB 함수 iptv_report_summary(원칙 1)가 한다. 읽기만 하며, IPTV 자료 밖의 기간이면 null(섹션을 두지 않는다).
import { IPTV_NAME_BY_CODE, slotMapKindOf } from "@/lib/iptvSlotMapText";
import type { IptvReportSummary } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export interface IptvSummaryPeriod {
  dateFrom: string;
  dateTo: string;
  priorDateFrom?: string | null;
  priorDateTo?: string | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
/** 비교 기간이 없을 때 쓰는 빈 구간(자료가 없어 "직전 기간 자료 없음"으로 나온다) */
const EMPTY_FROM = "1900-01-01";
const EMPTY_TO = "1900-01-02";

export async function loadIptvReportSummary(db: Db, args: { channelCode: string; period: IptvSummaryPeriod }): Promise<IptvReportSummary | null> {
  const channelName = IPTV_NAME_BY_CODE[args.channelCode];
  if (!channelName) return null;
  const kind = slotMapKindOf(args.channelCode);
  const { period } = args;
  const prevFrom = period.priorDateFrom ?? EMPTY_FROM;
  const prevTo = period.priorDateTo ?? EMPTY_TO;
  const { data, error } = await db.rpc("iptv_report_summary", { p_channel: channelName, p_target: kind, p_from: period.dateFrom, p_to: period.dateTo, p_prev_from: prevFrom, p_prev_to: prevTo });
  if (error) throw new Error(`IPTV 보고서 요약 계산 실패: ${error.message}`);
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row || Number(row.airings ?? 0) === 0) return null;
  const lastDate = (row.last_date as string | null) ?? null;
  const partial = lastDate !== null && lastDate < period.dateTo;
  const tops = Array.isArray(row.top_programs) ? (row.top_programs as Record<string, unknown>[]) : [];
  return {
    channelName,
    targetKind: kind,
    from: period.dateFrom,
    to: partial && lastDate ? lastDate : period.dateTo,
    prevFrom,
    prevTo,
    lastDate,
    partial,
    airings: Number(row.airings ?? 0),
    avgRating: num(row.avg_rating),
    prevAirings: Number(row.prev_airings ?? 0),
    prevAvgRating: num(row.prev_avg_rating),
    avgReachRate: num(row.avg_reach_rate),
    minutesPerReacher: num(row.minutes_per_reacher),
    observedChannels: Number(row.observed_channels ?? 0),
    ratingRank: num(row.rating_rank),
    topPrograms: tops.map((t) => ({ name: String(t.name ?? ""), airings: Number(t.airings ?? 0), rating: num(t.rating), minutesPerReacher: num(t.minutes_per_reacher) })),
  };
}
