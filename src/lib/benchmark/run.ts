// 격차 자리 적재 실행(고도화 B2) — 크론과 수동 실행이 같이 쓴다. 서버 전용(DB 읽기·쓰기).
// 자사 6채널마다: 벤치마크 선정(C1 규칙) → 자사·벤치마크의 최근 52주 방영 읽기 → 자리별 통계 → 격차 자리 → benchmark_slot_gaps upsert.
// 안전장치: 자사 방영을 읽지 못했거나 벤치마크가 2곳 미만이면 그 채널의 기존 행을 지우지 않고 건너뛴다. 한 채널의 실패가 다른 채널을 막지 않는다.
import { supabase } from "@/lib/supabase";
import { isoDow, addDays } from "@/lib/idealSchedule/time";
import { loadChannelAirings } from "@/lib/reportSnapshot/evidenceLoaders";
import { BENCH_OWN, type BenchTarget } from "@/lib/purchaseSim/benchmark";
import { loadBenchmark } from "@/lib/purchaseSim/benchmarkLoader";
import { computeGaps, computeSlotStats, MIN_BENCH_CHANNELS, type BenchmarkGapsSummary, type SlotAiring, type SlotStats } from "./slotGaps";

export const GAP_WINDOW_DAYS = 364;
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const COMP_LABEL: Record<BenchTarget, string> = { p2049: "개인2049", household: "유료방송가구" };
const broadcastMin = (t: string) => {
  const [h, m] = t.split(":").map((v) => Number.parseInt(v, 10));
  return (h < 2 ? h + 24 : h) * 60 + (m || 0);
};

export interface GapRunResult {
  key: string;
  status: "ok" | "skipped" | "failed";
  gaps: number;
  benchmarks: string[];
  error?: string;
}

async function loadCompAirings(competitor: string, tk: BenchTarget, from: string, to: string): Promise<SlotAiring[] | null> {
  const out: SlotAiring[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from("competitor_program_target_ratings")
      .select("broadcast_date, start_time, end_time, program_name, rating")
      .eq("competitor_name", competitor)
      .eq("target_label", COMP_LABEL[tk])
      .gte("broadcast_date", from)
      .lte("broadcast_date", to)
      .not("rating", "is", null)
      .order("broadcast_date")
      .order("start_time")
      .range(off, off + 999);
    if (error) return null;
    const rows = (data ?? []) as { broadcast_date: string; start_time: string | null; end_time: string | null; program_name: string; rating: number | string }[];
    for (const r of rows) {
      if (!r.start_time || NOT_PROG.test(r.program_name)) continue;
      const sm = broadcastMin(r.start_time);
      const em = r.end_time ? broadcastMin(r.end_time) : sm + 30;
      out.push({
        dow: isoDow(r.broadcast_date),
        startMin: sm,
        dur: Math.max(1, em - sm),
        rating: Number(r.rating),
        name: r.program_name.replace(/<[^>]*>/g, "").trim(),
        tag: /<본>/.test(r.program_name) ? "본" : /<재>/.test(r.program_name) ? "재" : null,
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

/** 자사 6채널(또는 only 한 채널)의 격차 자리를 계산해 저장한다. 벤치마크 채널의 통계는 채널끼리 공유해 한 번만 읽는다. */
export async function runBenchmarkGaps(args: { asOf: string; only?: string | null }): Promise<GapRunResult[]> {
  const from = addDays(args.asOf, -GAP_WINDOW_DAYS);
  const compCache = new Map<string, SlotStats | null>();
  const compStats = async (name: string, tk: BenchTarget): Promise<SlotStats | null> => {
    const key = `${name}|${tk}`;
    if (!compCache.has(key)) {
      const rows = await loadCompAirings(name, tk, from, args.asOf);
      compCache.set(key, rows && rows.length > 0 ? computeSlotStats(rows) : null);
    }
    return compCache.get(key) ?? null;
  };
  const results: GapRunResult[] = [];
  for (const [code, cfg] of Object.entries(BENCH_OWN)) {
    if (args.only && args.only !== code) continue;
    try {
      const selection = await loadBenchmark(supabase, code);
      const own = await loadChannelAirings(code, from, args.asOf);
      if (!own || own.length === 0) {
        results.push({ key: code, status: "failed", gaps: 0, benchmarks: [], error: "자사 방영을 읽지 못해 건너뜀(기존 행 유지)" });
        continue;
      }
      const ownStats = computeSlotStats(own.map((r) => ({ dow: isoDow(r.date), startMin: r.startMin, dur: Math.max(1, (r.endMin ?? r.startMin + 30) - r.startMin), rating: r.rating, name: r.name, tag: null })));
      const benches: { snap: string; stats: SlotStats }[] = [];
      for (const c of selection.channels) {
        const st = await compStats(c.competitor, cfg.tk);
        if (st) benches.push({ snap: c.snap, stats: st });
      }
      if (benches.length < MIN_BENCH_CHANNELS) {
        results.push({ key: code, status: "skipped", gaps: 0, benchmarks: benches.map((b) => b.snap), error: "벤치마크가 2곳 미만이라 건너뜀(기존 행 유지)" });
        continue;
      }
      const summary: BenchmarkGapsSummary = { asOf: args.asOf, benchmarks: benches.map((b) => b.snap), windowDays: GAP_WINDOW_DAYS, gaps: computeGaps(ownStats, benches) };
      const { error } = await supabase.from("benchmark_slot_gaps").upsert({ own_channel_code: code, as_of: args.asOf, payload: summary, computed_at: new Date().toISOString() }, { onConflict: "own_channel_code" });
      if (error) {
        results.push({ key: code, status: "failed", gaps: 0, benchmarks: summary.benchmarks, error: `저장 실패: ${error.message}` });
        continue;
      }
      results.push({ key: code, status: "ok", gaps: summary.gaps.length, benchmarks: summary.benchmarks });
    } catch (e) {
      results.push({ key: code, status: "failed", gaps: 0, benchmarks: [], error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
