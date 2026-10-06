// 시간대별 패턴 조회(서버 전용, 단계 03) — get_hourly_rating_pattern RPC와 같은 모집단(채널·타깃·소스·기간·동요일)의 프로그램 행을 읽어
// hourly.ts의 겹침 배분으로 24개 시간대(2~25시)를 만든다. 반환 모양은 기존 RPC 행 + 추가 필드라 기존 호출부가 그대로 쓴다.
// 기존 RPC는 시작 시각의 시로만 묶어 07:54:58 시작 방송이 8시 칸에는 "없음"으로 남았다 — 여기서는 방송 구간이 실제로 겹친 시간대 전부에 배분한다.
import { supabase } from "@/lib/supabase";
import { estimateHourlyPattern, type HourlyAiring } from "./hourly";

export interface HourlyPatternRow {
  broadcast_hour: number;
  /** 시간대 추정 시청률(겹침 시간 가중). 겹친 방송이 없으면 null — 0이 아니다 */
  avg_rating: number | null;
  avg_share: number | null;
  /** Reach·시청시간은 시간 배분이 의미 없는 지표라 그 시간대에 시작한 방송의 평균을 그대로 쓴다 */
  avg_reach: number | null;
  avg_time_spent_seconds: number | null;
  /** 이 시간대에 시작한 방송 수(기존 집계와 같은 정의, 심층 분석 교차 검산용) */
  program_count: number;
  /** 별도 metric: 이 시간대에 시작한 방송의 평균 시청률(기존 정의) */
  start_avg_rating: number | null;
  overlapping_count: number;
  observed_seconds: number;
  coverage_ratio: number;
  estimated: true;
}

export type HourlyPatternResult = { data: HourlyPatternRow[]; error: null } | { data: null; error: { message: string } };

const PAGE = 1000;

/** Postgres extract(dow)(0=일~6=토) 기준 asOf 이전(포함) 같은 요일 최근 N개 날짜 — same_dow_dates()와 같은 규칙. */
export function sameDowDates(asOf: string, dow: number, weeks: number): string[] {
  const n = Math.max(weeks, 1);
  const out: string[] = [];
  const base = Date.parse(`${asOf}T00:00:00Z`);
  for (let i = n * 7; i >= 0; i--) {
    const d = new Date(base - i * 86400000);
    if (d.getUTCDay() === dow) out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse().slice(0, n);
}

export async function fetchHourlyPattern(args: { channelCode: string; targetLabel: string; dateFrom: string; dateTo: string; targetDow?: number | null; targetWeeks?: number | null }): Promise<HourlyPatternResult> {
  try {
    const { data: ch } = await supabase.from("channels").select("id").eq("code", args.channelCode).maybeSingle();
    if (!ch) return { data: [], error: null };
    const { data: tg } = await supabase.from("targets").select("id").eq("label", args.targetLabel).maybeSingle();
    const useDow = args.targetDow !== null && args.targetDow !== undefined && args.targetWeeks !== null && args.targetWeeks !== undefined;
    const dates = useDow ? sameDowDates(args.dateTo, args.targetDow as number, args.targetWeeks as number) : null;

    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from("ratings")
        .select("id, broadcast_date, start_time, end_time, rating, share, reach, time_spent_seconds")
        .eq("channel_id", ch.id)
        .in("source_type", ["nielsen_daily", "skyuhd"])
        .not("program_id", "is", null)
        .not("start_time", "is", null);
      q = tg ? q.or(`target_id.eq.${tg.id},target_id.is.null`) : q.is("target_id", null);
      q = dates ? q.in("broadcast_date", dates) : q.gte("broadcast_date", args.dateFrom).lte("broadcast_date", args.dateTo);
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) return { data: null, error: { message: error.message } };
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < PAGE) break;
    }

    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const airings: HourlyAiring[] = rows.map((r) => ({
      date: r.broadcast_date as string,
      startClock: r.start_time as string | null,
      endClock: (r.end_time as string | null) ?? null,
      rating: num(r.rating),
      share: num(r.share),
      reach: num(r.reach),
      timeSpentSeconds: num(r.time_spent_seconds),
    }));
    const est = estimateHourlyPattern(airings);
    return {
      data: est.rows.map((h) => ({
        broadcast_hour: h.broadcastHour,
        avg_rating: h.estimatedRating,
        avg_share: h.estimatedShare,
        avg_reach: h.avgReach,
        avg_time_spent_seconds: h.avgTimeSpentSeconds,
        program_count: h.programCount,
        start_avg_rating: h.startAvgRating,
        overlapping_count: h.overlappingCount,
        observed_seconds: h.observedSeconds,
        coverage_ratio: h.coverageRatio,
        estimated: true as const,
      })),
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
